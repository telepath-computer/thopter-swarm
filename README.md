# Thopter Swarm

CLI for managing Runloop.ai devboxes as autonomous Claude Code development environments.

Each "thopter" is a cloud microVM pre-configured with Claude Code, git credentials, developer tools (neovim, starship, tmux), and monitoring hooks that report status to Redis. Create one, point it at a repo and a task, and let Claude work autonomously while you monitor from your laptop.

This is an internal dev tool for Telepath, but we've made it open as it's probably useful to others, and welcome feedback and contributions. Message josh@telepath.computer to chat about it.

## Quick Start

### Prerequisites

- Node.js 18+
- A [Runloop.ai](https://runloop.ai) account and API key
- A public Redis instance with a password-protected access URL, we recommend [Upstash](https://upstash.com) (for status monitoring and tailing activity on thopters)
- The `rli` CLI: `npm install -g @runloop/rl-cli`
- Iterm2 is the recommended terminal app for detachable tmux sessions on thopters (thanks to its support for tmux control mode)
- [ntfy.sh](https://ntfy.sh/) account and mac os desktop app. desktop app provides most reliable notifications. define a personal topic id (e.g. `randomstring_thopternotifss` or anything globally unique) and ensure you get pushes for it on your desktop (can also setup iOS)

### Install

```bash
git clone <this-repo>
cd thopter-swarm
npm install
npm link    # installs the 'thopter' command globally
```

### First-time Setup

**Telepath team:** see our "~/.thopter.json starter" in our 1password vault, put that in your homedir that first and then you can run setup.

```bash
thopter setup
```

This walks you through:
1. Runloop API key
2. Redis URL
3. GitHub token (`GH_TOKEN`) and other env vars
4. ntfy.sh push notifications (optional but highly recommended)

All config is saved to `~/.thopter.json`.

### Your First Thopter

```bash
# Create a fresh devbox (installs Claude, neovim, tmux, etc.)
thopter create --fresh

# The thopter got a random name, grab that and SSH in, look around, authenticate Claude, set things up
thopter ssh random-name-here

# Once you're happy, snapshot it as your golden image with your initials
thopter snapshot create random-name-here myinitials-golden
thopter snapshot default myinitials-golden

# Now all future creates use your golden snapshot (fast boot, ready to go)
thopter create worker-1
thopter create worker-2
```

### Dispatch Work

Once you have a golden snapshot, you can dispatch Claude to work on tasks with a single command:

```bash
thopter run --repo owner/repo "fix the login bug described in issue #42"
```

This creates a thopter, clones the repo, and launches Claude with your prompt in a tmux session. You can then:

```bash
thopter status              # see all your thopters and what they're doing
thopter tail worker-1 -f    # follow Claude's transcript in real time
thopter attach worker-1     # attach to tmux (iTerm2 -CC mode)
thopter ssh worker-1        # SSH in to poke around
```

**Highly recommended: use iterm2 for your terminal to enable a nice tmux experience for detachable thopter sessions.** `thopter attach` expects that. you can also just use `thopter ssh` and your own terminal, your own terminal multiplexer, or not, as you like. it's just a linux VM.

### Day-to-day Workflow

```bash
thopter status              # overview of all thopters
thopter status my-thopter   # detailed status + logs for one
thopter tail my-thopter -f  # follow Claude's transcript in real time

thopter suspend my-thopter  # pause (preserves disk, stops billing)
thopter resume my-thopter   # wake up later

thopter destroy my-thopter  # done for good
```

## CLI Reference

The CLI has commands for dispatching work (`run`), managing lifecycle (`create`, `suspend`, `resume`, `destroy`), connecting (`ssh`, `attach`, `exec`), monitoring (`status`, `tail`), snapshots, env vars, and configuration.

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
