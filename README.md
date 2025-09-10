# Thopter Swarm

Autonomous Claude Code development agents for GitHub issues running on Fly.io.

## Overview

Monitors GitHub issues for `/thopter` commands and automatically provisions Fly machines with Claude Code agents to work on issues. Features:

- **Autonomous agents**: Claude Code instances work on issues in tmux sessions (attachable)  
- **Web dashboard**: Team visibility and control via Fly's Wireguard VPN
- **Lifecycle management**: Activity tracking and resource management

## Current Limitations

This is v0.1 for internal testing with several constraints:

- **Unstable provisioning**: expect thopters not to launch sometimes. Be ready to look at hub machine logs (`fly logs --machine NNN`)
- **Weird DNS names**: like the dashboard lives at 1.hub.kv._metadata.{appname}.internal
- **Manual lifecycle**: Agents must be killed manually; idle agents block new ones at MAX_AGENTS
- **No PR workflow**: Agents push to `thopter/*` branches but don't create PRs
- **Auth fragility**: Claude Code credentials expire frequently, requiring re-authentication
- **GitHub polling scale**: Not suitable for large repositories with hundreds of active issues.
- **Guides/docs needed**: Lots of details warrant further documentation and explanation.

## Quick Start of a new swarm setup

### 1. Fork and clone the repo

Assuming you will want to commit changes, like new prompt templates, and collab on this project as a dev team. But you don't *have* to fork, you can just clone locally.

### 2. Setup Fly.io

Authenticate the fly CLI, create an app to contain your swarm, issue certs:
```bash
fly auth login
fly apps create --org <your-org> --name <app-name> --save
fly ssh issue             # for console access (tbh not sure if this is needed)
fly wireguard create      # for private networking
fly tokens create deploy  # save for .env
```

### 3. Configure

```bash
cp .env.example .env
```
Set APP_NAME, REGION, GITHUB_INTEGRATION_JSON, FLY_DEPLOY_KEY

### 4. Deploy

```bash
./fly/preflight.sh         # validate setup
./fly/ensure-metadata.sh   # deploy metadata server
./fly/recreate-gc.sh       # deploy a golden claude
./fly/recreate-hub.sh      # deploy the central hub
./fly/status.sh            # check deployment
```

### 5. Setup auth in golden claude

Access the golden claude web terminal (in the output of `recreate-gc.sh`) and run `yolo-claude` (an alias for `claude --dangerously-skip-permissions`). Authenticate, accept all the initial trust questions until you're at the interactive chat prompt, and then quit claude code.

**IMPORTANT:** don't leave Claude Code running in a golden claude instance. It's background operations sometimes write to the filesystem during new thopter provisioning which can break the data transfer.

### 6. Use: Comment "/thopter" on GitHub issues

`/thopter` (on a line by itself) in a comment will provision a thopter with the default golden claude machine and default prompt. See "Comment Syntax" for more controls. The thopter gets the issue context and the default prompt tells Claude what's going on and how to get to work (see `fly/thopter-swarm/hub/templates/prompts/default.md`)

## Adding team members

First invite them to your fly.io org, then they can:
```bash
fly auth login
fly ssh issue
fly wireguard create
```

This gives them access to the dashboard, the ability to ssh and see logs on machines, etc.

But to do admin stuff like (re)creating golden claudes or recreating the hub with new prompt templates, they need all the same `.env` config contents in their local clone.

TODO: make this easier. Sharing complex `.env` files with credentials in them is a pain.

## GitHub Issue Comment Syntax

Use `/thopter (params)` on its own line in an issue comment or the initial body.

Parameters:
`--gc name` (`-g`) will use a named golden claude `gc-{name}` if present, otherwise falls back to `gc-default`

`--prompt name` (`-p`) will use a named prompt file `{name}.md` in the `hub/templates/prompts/` dir if found, otherwise uses `default.md` -- see "Custom Prompts" below.

You can put these instructions all together: `/thopter -g josh-maxplan -p architect` runs a thopter with homedirs cloned from the `gc-josh-maxplan` golden claude, using the `hub/templates/prompts/architect.md` initial prompt content.

You can create multiple thopters by issuing multiple comments with /thopter commands, like to compare multiple parallel attempts at the same task. Note it won't handle multiple slash commands in a single comment: use a new comment for each command.

## Architecture

### Components

**Hub** - Central TypeScript/Express server
- `http://1.hub.kv._metadata.{your fly app name}.internal:8080` on wireguard network
- Dashboard (port 8080), status collector (port 8081)  
- GitHub issue monitoring and thopter provisioning
- In-memory state management, bootstrapped from inspecting fly machines list

**Golden Claudes** - Authentication template
- Persistent instances with authenticated homedir
- Homedir contents copied to new thopters
- Tmux sessions with web terminal access for auth setup
- **IMPORTANT:** don't leave Claude Code running in these machines. The filesystem needs to be static during copy to new thopters, and Claude Code runs background stuff that breaks that.

**Thopters** - Autonomous agents
- Copies of a golden claude plus issue context, a prompt, the git repo and access token.
- Tmux sessions with web terminal access also
- HTTP monitoring to hub, egress firewall also

**Metadata (redis) server** - simple k/v tracking

- Mainly needed to track the current docker image name for new thopters

### Project Structure

```
├── .env.example/.env    # Configuration
├── fly/                 # Deployment scripts
├── hub/                 # Central server (TypeScript)
│   └── templates/
│       └── prompts/     # Agent prompt templates
│           └── default.md
└── thopter/            # Agent containers
```

## Authentication and security

### GitHub Authentication

You need two PATs for security isolation:

- **`GITHUB_ISSUES_PAT`**: For the hub's issue monitoring (read/write issues)
- **`GITHUB_AGENT_CODER_PAT`**: Thopter agent repository access (read repo, write optional)

Sorry but we need to dive into github integration and access control patterns for a bit here. Bare with me and follow along.

Since the coder PAT has full read/write on whatever repos it's been issued for, they could accidentally or deliberately check out other branches and mess with or completely rewrite their history, or push to special branches you're trying to keep constrained, etc. There are three strategies to constrain the scope of a bot user's write access:
- Strategy 1: fork your repo(s) and have the bots work on forks without constraints, then issue PRs manually from the fork in a way you know is safe. This means more manual work to integrate code, and that have to sync the fork with origin often so the thopters are working off current code. Thopters don't know they're in a fork and don't know they have to sync anything. Since I'm not using the forking strategy, this needs more work to be fleshed out. For example, the issue scanner isn't designed to read issues from a main repo but contribute on a fork, you will have to open thopter work requests as issues on the fork.
- Strategy 2 (what I use): use the main repo, but constrain bot activity to only `thopter/*` branches using rulesets that target everything except `thopter/*` branches and blocking writes, but this comes with a major overhead/admin cost - rulesets can't target just a specific user or team, they always target everyone and can only allow a bypass list. So, you also have to define a bypass list of people who are exempted from the blank restriction. I created a team called "non-thopters" and exempted them. GitHub genuinely lacks a means to target a specific user and apply constrained permissed, the convention is generally "untrusted users should fork and submit PRs."
- Strategy 3: YOLO. Skip this stuff and allow autonomous, unsupervised Claude Code instances full read/write on your GitHub repo without branch constraints. Not recommended, but it will work until one day it decides to push to a branch you didn't ask it to and that's on you TBH.

Pick your strategy and set up a user with PATs:
- Create a dedicated GitHub bot user (e.g. mythopterbot) via GitHub web signup, with a valid email (e.g. thopterbot@yourdomain.com). Issue comments and commits will come from this user.
- For repos managed by an org, invite this user to the org, and accept the invite as the user. You'll need two browsers with your github admin and bot user logged in respectively for this workflow.
- For forking strategy, create a fork of the repos you want to work with just for this use case. As repo admin, add the bot user directly as a collaborator with write access on the forks via repo settings -> collaborators (the bot just being in the org is not enough).
- For main repo access strategy, you must also add the bot as a writer contributor to the main repos, and then define the branch ruleset. The ruleset should "exclude by pattern" `thopter/*` branches and deny creation, update, deletion, and force pushes, then you must add a bypass list of human contributers which you unfortunately have to maintain yourself to ensure normal contributors don't get blocked by this new blanket deny rule outside of thopter branches.
- As the bot user, create two fine grained personal access tokens. Name them clearly and with a date, like thopter-issues-YYMMDD and thopter-coder-YYMMDD, as you'll need to recreate them later most likely. The first needs read/write on issues in the repos (or forks, and you'll have to open the issues on the forks) you are integrating with, the second needs read/write on those repos' contents. For an org, it should be set to owned by the org and the org admin will need to approve the tokens in that case. I don't recommend using "all repos," be specific to the forks.
- Save the values in a vault for future use in the .env files, GitHub only shows the values once.
- Add the tokens, the owners/names of the repos, and your bot user's name+email to the .env file. This must be done deploying the hub and if the values change, recreate the hub.
- Note: I have found that these tokens can be brittle. Create entirely new ones if things stop working.

### Handling dev env secrets

If Claude Code or your dev environment needs secrets, the only way is to manually set them up in a file in /data/thopter on your golden claude(s). The full contents of /data/thopter on your golden claude are copied to each thopter upon provisioning it. You can also modify the thopter base image or init script to do things you want to have happen each time.

Note: env vars are NOT copied from golden claudes, only the /data/thopter folder tree contents.

TODO: support a `.env.thopters` var that is sent to the hub and automatically copied to thopters for secrets.

TODO: add a file `post-checkout.sh` in the thopter base image you can modify, it gets run after the provisioner has done all its git setup, cloning, right before it launches claude. Changes to that file require a rebuild of the thopter image (`rebuild-thopter.sh`) and after that rebuild will affect new thopters.

### Thopter firewall

Thopters run inside an egress firewall to prevent secrets and code exfil. This means Claude Code cannot do web searches, read docs for libraries etc. A whitelist of common package repos (e.g. npm, pypy, etc) are whitelisted by default, just like the [official Anthropic devcontainer example](https://github.com/anthropics/claude-code/tree/main/.devcontainer).

Adjust `ALLOWED_DOMAINS` in `.env` to add holes in it. You can also disable it, but you risk code and secrets exfil from prompt injection attacks or just Claude making mistakes.

TODO: integrate Context7 MCP documentation MCP server under a flag and enable that one additional domain, this is a good way to have docs without having to disable the firewall. But it does expose higher risk as this server could well contain prompt injection attacks, if I were a black hat I'd be sneaking prompt injection attacks into Context7.

## Adding prompts and golden claude options

### Custom Prompts

Create new prompt templates in `hub/templates/prompts/`

**Note**: Prompt changes require a hub recreate: `./fly/recreate-hub.sh` which does change the machine ID of the hub, so don't use {machineid}.vm.{appname}.internal addresses. You should use the 1.hub.kv._metadata.{appname}.internal URL for hub bookmarks which repoints to the new machine on recreate.

#### Add a new prompt template

```bash
echo "Your custom prompt here..." > hub/templates/prompts/architect.md
```

Prompt templates support these variables:
- `{{repository}}` - Full repository name (e.g., "owner/repo")
- `{{repoName}}` - Repository name only (e.g., "repo")
- `{{issueNumber}}` - GitHub issue number
- `{{branchName}}` - Generated branch name for this thopter

Have a look at the default prompt to get a feel.

#### Use in GitHub issues with --prompt / -p

/thopter --prompt architect

### Golden Claude Instances

Create specialized golden claude machines with pre-configured environments:

```bash
# Create a named golden claude
./fly/recreate-gc.sh josh-maxplan

#### Use in GitHub issues
/thopter --gc josh-maxplan
```

## More on how things work

### Fly Wireguard Network

Thopter Swarm uses Fly's private networking for secure access:
- Hub and thopters communicate via internal domains on IPv6 interfaces
- Team accesses dashboard and terminals, as well as build+deploy scripting, relies on Wireguard VPN
- No public internet exposure of agent instances or dashboard

### Local Build+Deploy Scripts

The `fly/` directory contains deployment automation:
- **`preflight.sh`**: Validates environment and prerequisites
- **`recreate-*.sh`**: Builds and deploys components (hub, golden claude, metadata)
- **`destroy-*.sh`**: Clean teardown of resources
- **`status.sh`**: Shows deployment status and access URLs

### Thopter Lifecycle

1. **Provisioning**: Fly machine created with Ubuntu + dev tools + Claude Code using base image in `thopter/Dockerfile`, with a volume mounted to `/data/thopter` for claude configs and dev workspace.
2. **Setup**: Golden Claude homedir copied for authentication
3. **Repository**: Git repo cloned, issue files (prompt.md, issue.json) created  
4. **Launch**: Claude Code started in tmux session with web terminal access, pointed to `prompt.md` as first instruction
5. **Monitoring**: Status reported to hub's HTTP collector via observer script
6. **Code committed + pushed**: presumably Claude finishes its task and commits code per its prompting, then goes idle.
7. **Cleanup**: Manual review of status and termination via dashboard

### Hub Operations

- **State management**: Tracks Fly machines and thopter status
- **GitHub monitoring**: Polls issues for `/thopter` commands
- **Provisioning**: Creates/destroys thopters via Fly API
- **Dashboard**: Web interface for team visibility and control


