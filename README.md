# Thopter Swarm

Autonomous Claude Code development agents for GitHub issues running on Fly.io.

## Overview

Monitors GitHub issues for `/thopter` commands and automatically provisions Fly machines with Claude Code agents to work on issues. Features:

- **Autonomous agents**: Claude Code instances work on issues in tmux sessions (attachable)  
- **Web dashboard**: Team visibility and control via Fly's Wireguard VPN
- **Lifecycle management**: Activity tracking and resource management

## Current limitations

This is v0.1 for internal testing with many constraints:

- **Unstable provisioning**: expect thopters to fail to launch or to get stuck sometimes. Be ready to look at hub and thopter machine logs (`fly logs --machine NNN`). Use `fly/status.sh` and the fly.io admin console's machines page for help.(*)
- **Weird DNS names**: the dashboard lives at 1.hub.kv._metadata.{appname}.internal (but at least it's persistent across hub server redeployment)
- **Manual lifecycle**: Agents must be killed manually; idle agents block new ones at MAX_AGENTS
- **No PR workflow**: Agents push to `thopter/*` branches but don't create PRs yet
- **Auth fragility**: Claude Code credentials expire frequently, requiring re-authentication
- **GitHub polling scale**: Not suitable for large repositories with hundreds of active issues.
- **Awkward GitHub integration**: tricky rulesets required to protect against rogue agents
- **Guides/docs needed**: Lots of details warrant further documentation and explanation.
- **Immature workflow for daily use**: e.g. thopters can't report completion status to GitHub ("idle" state on the dashboard is the signal for completion), can't comment on issues, can't read/write PRs yet, etc.
- Expect bugs and broken edge cases. PRs welcome :)

(*) For example I have seen thopters fail to finish initialization due to the initial `rm -rf /data/*` command that cleans up state from prior thopters on the volume hanging forever once in a while. So maybe I shouldn't be using a shared volume pool. Lots of kinks like this are getting worked out.

## Quick start of a new swarm setup

### 1. Fork and clone the repo

Assuming you will want to commit changes, like new prompt templates, and collab on this project as a dev team. But you don't *have* to fork, you can just clone locally.

### 2. Setup Fly.io

Authenticate the fly CLI, create an app to contain your swarm, issue certs:
```bash

# install flyctl if you haven't:
curl -L https://fly.io/install.sh
# or
brew install flyctl

fly auth login
fly apps create --org <your-org> --name <app-name> --save
fly ssh issue             # for console access (tbh not sure if this is needed)
fly wireguard create      # for private networking. be sure to use a .conf extension, e.g. swarm.conf (see "Setting up Wireguard desktop app")
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

### 6. Make "/thopter" comments on GitHub issues

`/thopter` (on a line by itself) in a comment will provision a thopter with the default golden claude machine and default prompt. See "Comment Syntax" for more controls. The thopter gets the issue context and the default prompt tells Claude what's going on and how to get to work (see `fly/thopter-swarm/hub/templates/prompts/default.md`)

## Adding team members

First invite them to your fly.io org, then they can:
```bash
brew install flyctl
fly auth login
fly wireguard create # be sure to use a .conf extension e.g. swarm.conf (see "Setting up Wireguard desktop app")
```

This gives them access to the dashboard, the ability to ssh and see logs on machines, etc.

But to do admin stuff like (re)creating golden claudes or recreating the hub with new prompt templates, they need all the same `.env` config contents in their local clone.

TODO: make this easier. Sharing complex `.env` files with credentials in them is a pain.

## GitHub issue comment syntax

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
- Homedir contents copied to new thopters (except `.bashrc` as thopter initialization depends on it)
- Tmux sessions with web terminal access for auth setup
- The Claude credentials time out. You have to hop back in, run claude, and `/login` every couple of days, then quit claude.
- **IMPORTANT:** don't leave Claude Code running in these machines. The filesystem needs to be static during copy to new thopters, and Claude Code runs background stuff that breaks that.

**Thopters** - Autonomous agents
- Copies of a golden claude plus issue context, a prompt, the git repo and access token.
- Tmux session with web terminal access, auto-launches claude in yolo mode
- Session log html generator and a mini webserver to serve it (port 9971)
- Egress firewall, configurable
- Posts status via HTTP to hub

**Metadata (redis) server** - simple k/v tracking

- Mainly to track the current docker image tag for new thopters

### Project layout

```
├── .env                 # Thopter swarm configuration (fly app and tokens, github details and tokens)
├── .env.thopters        # Custom env vars to have in your thopter environment
├── fly/                 # Deployment scripts
├── hub/                 # Central server (TypeScript)
│   └── templates/
│       └── prompts/     # Prompt templates
│           └── default.md
└── thopter/             # Thopter docker image and resources
```

Inside a thopter, you have:
```
├── /data/thopter        # thopter user homedir
│   ├── .claude/         # copied from golden claude, session log html is here too
│   ├── .env.thopters    # copied in and sourced in .bashrc for thopter user
│   └── workspace/
│       ├── issue.json   # generated from github issue details
│       ├── prompt.md    # copied in and given to claude as initial task
│       └── {repodir}/   # the git repo
└── /thopter/log         # initialization and provisioning log for debugging

processes:
- tmux
- gotty web terminal server
- claude
- pm2 -> supervises html session log generator and static file server, and status reporter
```

## Session logs

Each thopter automatically generates HTML session logs and launches a basic static file server to view them. This provides a convenient way to review the entire interactive session without scrolling through terminal history. The logs include a full, timestamped transcript (including all the gory tool call i/o inside folding divs) and are rebuilt every 30 seconds.

They are generated using [daaain/claude-code-log](https://github.com/daaain/claude-code-log)

The webserver for them is available at `http://{machine-id}.vm.{app-name}.internal:7791` for each running thopter, and there's a button from the dashboard to open that quickly.

## Authentication and security

### GitHub

For each repo (or possibly shared among multiple repos), you need two PATs for security isolation:

- **Issues PAT**: For the hub's GitHub issue polling and updates (read/write issues)
- **Agent PAT**: For the thopter machines' autonomous repository access (read repo, write optional)

Sorry but we need to dive into GitHub integration and access control patterns for a bit here. Bear with me and follow along. This guide is also based on my experience doing this in a GitHub org account, not in personal repos. It may change depending on that context. Let's work together and get this right. I'm still figuring out what the best authentication and constraints system is for GitHub here. Help/advice needed! Maybe GitHub apps is the right way?

Since the coder PAT has full read/write on whatever repos it's been issued for, they could accidentally or deliberately check out other branches and mess with or completely rewrite their history, or push to special branches you're trying to keep constrained, etc. There are three strategies to constrain the scope of a bot user's PAT write access:
- Strategy 1: fork your repo(s) and have the bots work on forks without constraints, then issue PRs manually from the fork in a way you know is safe. 
  - This means more manual work to integrate code, and you have to sync the fork with origin often so the thopters are working off current code.
  - Thopters don't know they're in a fork and don't know they have to sync anything. 
  - Since I'm not using the forking strategy, this needs more work to be fleshed out.
  - For example, the issue scanner isn't designed to read issues from a main repo but contribute on a fork, thopter work requests must be issues on the fork.
- Strategy 2 (what I use, which is not great): use the main repo, but constrain bot activity to only `thopter/*` branches using branch rulesets that target everything except `thopter/*` branches and block writes, but exempt your humans on the team.
  - Rulesets can't target just a specific bot user, they always target everyone and can only allow a bypass list. Create a team called "non-thopters" and exempt them.
  - Be sure to exempt them with the complete "exempt from rules" setting. By default the exemption status requires a manual bypass step, which makes normal day-to-day operations feel broken.
  - GitHub genuinely lacks a means to target a specific user and apply constrained permissions. The convention is generally "untrusted users should fork and submit PRs" (see strategy 1)
- Strategy 3: YOLO. Skip this stuff and allow autonomous, unsupervised Claude Code instances full read/write on your GitHub repo without branch constraints. Not recommended, but it will work until one day it decides to push to a branch you didn't ask it to and that's on you TBH.

TODO: Maybe have a separate root-owned process in the thopter with the write-access PAT, and allow Claude Code to only say "okay push my changes" via some kind of message system or MCP server, and then trusted code is what issues the push commands using PATs. In other words, give Claude Code an opaque way to trigger a pre-authenticated `git push origin thopter/my-preconfigured-branch` command. This could be both secure and simple?

Pick your strategy and set up a user with PATs:
- Create a dedicated GitHub bot user (e.g. mythopterbot) via GitHub web signup, with a valid email (e.g. thopterbot@yourdomain.com). Issue comments and commits will come from this user.
- For repos managed by an org, invite this user to the org, and accept the invite as the user. You'll need two browsers with your GitHub admin and bot user logged in respectively for this workflow.
- For forking strategy, create a fork of the repos you want to work with just for this use case. As repo admin, add the bot user directly as a collaborator with write access on the forks via repo settings -> collaborators (the bot just being in the org is not enough).
- For main repo access strategy, you must also add the bot as a contributor ('write' role) to the main repos, and then define the branch ruleset. The ruleset should "exclude by pattern" `thopter/*` branches and deny creation, update, deletion, and force pushes, then you must add a bypass list of human contributors which you unfortunately have to maintain yourself to ensure normal contributors don't get blocked by this new blanket deny rule outside of thopter branches. Ensure the bypass is set to "exempt from rules" so nobody gets prompted about it.
- As the bot user, create two fine-grained personal access tokens. Name them clearly and with a date, like thopter-issues-YYMMDD and thopter-coder-YYMMDD, as you'll need to recreate them later most likely. The first needs read/write on issues in the repos (or forks, and you'll have to open the issues on the forks) you are integrating with, the second needs read/write on those repos' contents. For an org, it should be set to owned by the org and the org admin will need to approve the tokens in that case.
- (For tokens I don't recommend using "all repos" type access patterns. Be specific to the repos. Although it's a slight comfort that even with PAT targeting all repos, it seems to only work with the ones on which the bot user is explicitly a write-access collaborator.)
- Save the names and values in a vault for future use in the `.env` files, GitHub only shows the values once.
- Add the tokens, the owners/names of the repos, and your bot user's name+email to the `GITHUB_INTEGRATION_JSON` value in the `.env` file. This must be done before deploying the hub, and if the values change, requires recreating the hub.
- (Note: I have found that these tokens can be brittle. Create entirely new ones if things stop working.)

### Handling dev env secrets

#### Developer Environment Variables (.env.thopters)

You can provide development environment variables that will be automatically
loaded in all thopter containers by creating a `.env.thopters` file in your
project root. This file is uploaded to the hub and distributed to all new
thopters during provisioning.

Example `.env.thopters`:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
MY_SERVICE_URL=https://dev.example.com
NODE_ENV=development
```

**Important notes:**
- Never include production credentials
- Only use KEY=value format (no commands)
- The file is automatically uploaded to hub during `./fly/recreate-hub.sh`
- Manually update existing hub after edits with `./fly/upload-env-thopters.sh`
- Changes apply only to new thopters and only after uploading to the hub

#### Alternative: Golden Claude Files

If Claude Code or your dev environment needs files (not just environment variables), you can manually set them up in a file in `/data/thopter` on your golden claude(s). The full contents of `/data/thopter` on your golden claude are copied to each new thopter upon provisioning it.

Note: env vars are NOT copied from golden claudes, only the `/data/thopter` folder tree contents.

### Thopter firewall

Thopters run inside an egress firewall (`thopter/scripts/firewall.sh`) to prevent secrets and code exfil. This means Claude Code cannot do web searches, read docs for libraries etc. A whitelist of common package repos (e.g. npm, pypy, etc) are whitelisted by default, just like the [official Anthropic devcontainer example](https://github.com/anthropics/claude-code/tree/main/.devcontainer) (but we do a better job than that example for github in particular, since we use github's published CIDR blocks instead of more naive IP resolution, which helps a lot with github access reliability.)

Adjust `ALLOWED_DOMAINS` in `.env` to add holes in it. You can also disable it, but you risk code and secrets exfil from prompt injection attacks or just Claude making mistakes.

([Context7 MCP server](https://context7.com/) integration is planned to help claude get access to documentation despite the firewall)

### Fly Wireguard network

Thopter Swarm uses Fly's private networking for secure access:
- Hub and thopters communicate via internal domains on IPv6 interfaces
- Team accesses dashboard and terminals, as well as build+deploy scripting, relies on Wireguard VPN
- No public internet exposure of agent instances or dashboard. No public IPs.

### Setting up Wireguard desktop app

- Install Wireguard from https://www.wireguard.com/ (on macOS get it from the Mac App Store)
- Launch it and give it system permissions if prompted
- Click the tiny "+" button in the lower left and choose "import tunnel from file"
- Select the file generated by `fly wireguard create` (make sure you saved it with a `.conf` extension)
- Select the new interface from the list on the left and click "activate"
- `preflight.sh` should now detect the tunnel is active via DNS query

## Adding prompts and golden claude options

### Custom Prompts

Create/edit prompt templates in `hub/templates/prompts/*.md`

Templates support these variables:
- `{{repository}}` - Full repository name (e.g., "owner/repo")
- `{{repoName}}` - Repository name only (e.g., "repo")
- `{{issueNumber}}` - GitHub issue number
- `{{workBranch}}` - Generated work branch name for this thopter, which take the form `thopter/{issueNumber}--{thopterId}`

Have a look at the default prompt to get a feel: `hub/templates/prompts/default.md`

Prompt changes require a hub recreate: `./fly/recreate-hub.sh`

Hub recreation does change the machine ID of the hub, which is why we use the `1.hub.kv._metadata.{appname}.internal` domain name, which uses fly's machine metadata feature to route to the hub machine.

#### Use in GitHub issue /thopter commands with --prompt / -p

Say you added a prompt `architect.md`, launch a thopter with it in a GitHub issue comment like so:
`/thopter --prompt architect`

### Adding golden Claude Instances

You can create more specialized "golden claude" machine with pre-configured environments:

```bash
./fly/recreate-gc.sh josh-maxplan
```

The use it in github issues with `/thopter --gc josh-maxplan`

We use this to maintain an authenticated max plan per team member, and each person requests thopters assigned to their own plan.

## Thopter lifecycle in detail

1. **Issue mention detected**: GitHub polling loop finds a new `/thopter` mention in an issue on an integrated repo, and fires off an internal request for provisioning.
2. **Provisioning**: Fly machine created from base image in `thopter/Dockerfile`, with a volume mounted to `/data/thopter` for claude configs and dev workspace.
3. **Initialization**: Golden Claude homedir copied over, `.env.thopters` file sourced in `.bashrc`, firewall initiated, tmux session started, web terminal (gotty) server launched, dashboard status observer and html session logs generator processes launched (via pm2)
4. **Repository**: Git repo cloned, issue files (prompt.md, issue.json) created in workspace
5. **Launch**: Claude Code started in tmux session with web terminal access, pointed to prompt file as first instruction
6. **Monitoring**: Status reported to hub's HTTP collector via observer script, dashboard shows agent details ongoing
7. **Task done / code committed / pushed**: presumably Claude finishes its task and commits code per its prompting, then goes idle.
8. **Manual review and cleanup**: Developer reviews status, issues more instructions interactively as needed, terminates thopter via dashboard when done


