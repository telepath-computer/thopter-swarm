# Thopter Swarm

CLI for managing Runloop.ai devboxes as autonomous Claude Code development environments.

Each "thopter" is a cloud microVM pre-configured with Claude Code, git credentials, developer tools, and Claude Code hooks that report status to Redis. Create one, point it at a repo and a task, and let Claude work autonomously while you monitor it from your laptop.

This is just an internal dev tool we use a [Telepath](https://telepath.computer), but we've made it open as a conversation starter, for feedback, and contributions. Message josh@telepath.computer to chat about it.

## Rationale

We think the optimal way to run Claude Code (or any coding agent) is with:
- yolo mode
- push notifications (for when it's done or needs input)
- multiple instances in parallel
- remote/cloud machines (for detachable, long-running sessions attachable any device, and to not dog down your laptop's resources)
- full shell access
- "golden" bootstrap images that are ready to get to work (pre-authenticated, repos checked out, deps installed, configured how you like it)
- connected to your git repos (to interact with issues, pull/create branches, make PRs, etc)
- safely (e.g. a rogue agent can't do catastrophic damage)
- frictonless devex (launching and managing must be hesistation-free)
- Anthropic's max plan for cost savings
- mobile access and notifs for launching and monitoring workers (not implemented here yet, on the TODO list)

This is Telepath's attempt to get this developer experience by wrapping a capable VM sandbox provider with a management and monitoring layer built for day to day developer claude code use.

## Quick Start

### Prerequisites

- Node.js 18+
- A [Runloop.ai](https://runloop.ai) account and API key
- A public Redis instance with a password-protected access URL for status monitoring and tailing activity on thopters, like [Upstash](https://upstash.com)
- The runloop CLI: `npm install -g @runloop/rl-cli`
- Iterm2 is the recommended terminal app for the best experience with detachable tmux sessions on thopters (via tmux control mode)
- [ntfy.sh](https://ntfy.sh/) account and mac os desktop app so thopters can notify you from CC hooks. The desktop app provides the most reliable notifications (there's an iOS/android app too)
- A github user with access to your repo(s) and a fine-grained PAT that allows issues read/write and content read/write. It's highly recommended to lock down your important branches with rulesets so that this user cannot modify them at all (only submit PRs to them.)

### Install

```bash
git clone <this-repo>
cd thopter-swarm
npm install
npm link    # installs the 'thopter' command globally
```

### First-time Setup

**Telepath team:** see our "~/.thopter.json starter" in our 1password vault, put that in your homedir that first and then you can run setup but with our preconfigured values.

```bash
thopter setup
```

This walks you through configuring critical environment variables for:
1. Runloop API key
2. Redis URL
3. GitHub token
4. ntfy.sh push notifications (optional but highly recommended)

All config is saved to `~/.thopter.json`.

### Your First Thopter

```bash
# Create a fresh devbox (installs Claude, Codex, Neovim, tmux, etc.) with a random name like adventurous-quesadilla
thopter create --fresh

# SSH in, look around, authenticate Claude, set things up
thopter ssh adventurous-quesadilla

# Once you're happy, snapshot it as your golden image
thopter snapshot create adventurous-quesadilla josh-golden
# set this image as default for new thopters (just edits ~/.thopter.json)
thopter snapshot default josh-golden

# Now all future creates use your golden snapshot (fast boot, ready to go)
thopter create worker-1
thopter create worker-2
```

### Dispatch Work

Once you have a golden snapshot, you can dispatch Claude to work on tasks with a single command:

```bash
thopter run --repo owner/repo "fix the login bug described in issue #42 and submit a PR"
```

This creates a thopter, clones the repo, and launches Claude with your prompt in a tmux session. You can then:

```bash
thopter status              # see all your thopters and what they're doing
thopter tail worker-1 -f    # follow Claude's transcript in real time
thopter attach worker-1     # attach to tmux (iTerm2 -CC mode)
thopter ssh worker-1        # SSH in to poke around
```

**Highly recommended: use iterm2 for your terminal to enable a nice tmux experience for detachable thopter sessions.** `thopter attach` expects that. you can also just use `thopter ssh` and your own terminal, your own terminal multiplexer, or not, as you like. It's just a runloop-managed linux VM, we're just adding devex conveniences over that.

### Day-to-day Workflow

```bash
thopter status                # overview of all thopters
thopter status my-thopter     # detailed status + logs for one
thopter tail my-thopter -f    # follow Claude's transcript in real time

thopter suspend my-thopter    # pause (preserves disk, stops billing)
thopter resume my-thopter     # wake up later
thopter keepalive my-thopter  # reset 12 hour auto-suspend countdown timer

thopter destroy my-thopter    # done for good
```

## CLI Reference

The CLI has commands for dispatching work (`run`), managing lifecycle (`create`, `suspend`, `resume`, `keepalive`, `destroy`), connecting (`ssh`, `attach`, `exec`), monitoring (`status`, `tail`), snapshots, env vars, and configuration.

See [docs/cli-reference.md](docs/cli-reference.md) for the full command reference.

## Configuration

All config lives in `~/.thopter.json`, managed via `thopter setup`, `thopter config`, and `thopter env`. The key env vars are `GH_TOKEN` (GitHub access) and `THOPTER_REDIS_URL` (status monitoring). Optional: `THOPTER_NTFY_CHANNEL` for push notifications via ntfy.sh.

See [docs/configuration.md](docs/configuration.md) for detailed setup (GitHub tokens, notifications, custom CLAUDE.md, file uploads) and [thopter-json-reference.md](thopter-json-reference.md) for the complete config key reference.

## Architecture

TypeScript CLI built on Commander.js, using the Runloop.ai SDK for devbox lifecycle and Upstash Redis for monitoring. Devboxes are KVM microVMs provisioned with Claude Code, developer tools, and hooks that report status back to Redis.

See [docs/architecture.md](docs/architecture.md) for details on the stack, how provisioning works, devbox contents, and project structure.

## More

- [Clipboard setup](docs/clipboard.md) (Neovim + tmux + iTerm2 OSC 52)
- [Design docs and ideas](docs/)

## Build

```bash
npm install          # install dependencies
npm run build        # compile TypeScript (tsc)
./thopter --help     # see CLI commands
```

The `thopter` wrapper script runs `src/cli.ts` via `tsx` so you don't need to compile during development, but always run `npm run build` before committing to verify TypeScript compiles cleanly.
