# Thopter Swarm

CLI for managing Runloop.ai devboxes as autonomous Claude Code development environments.

Each "thopter" is a cloud microVM pre-configured with Claude Code, git credentials, developer tools, and Claude Code hooks that report status to Redis. Create one, point it at a repo and a task, and let Claude work autonomously while you monitor it from your laptop.

This is just an internal dev tool we use at [Telepath](https://telepath.computer), but we've made it open as a conversation starter, for feedback, and contributions. Message josh@telepath.computer to chat about it.

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
npm run build   # not strictly necessary, but does a typescript validation
npm link        # installs the 'thopter' command globally
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
4. ntfy.sh push notifications (optional but highly recommended) *

\* For push notifications: before setup, go to [ntfy.sh](https://ntfy.sh/), sign-up for a free account, click "Subscribe to topic," click "Generate name," note the topic name provided, and then enter that topic name during Thopterswarm setup process.   

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

This creates a thopter, clones the repo, and launches Claude with your prompt in a tmux session. Set up predefined repos with `thopter repos add` to get a numbered chooser when running without `--repo`. You can then:

```bash
thopter status              # see all your thopters and what they're doing
thopter tail worker-1 -f    # follow Claude's transcript in real time
thopter tell worker-1 "also fix the tests"  # send a follow-up message
thopter attach worker-1     # attach to tmux (iTerm2 -CC mode)
thopter ssh worker-1        # SSH in to poke around
```

**Highly recommended: use iterm2 for your terminal to enable a nice tmux experience for detachable thopter sessions.** `thopter attach` expects that. you can also just use `thopter ssh` and your own terminal, your own terminal multiplexer, or not, as you like. It's just a runloop-managed linux VM, we're just adding devex conveniences over that.

### Day-to-day Workflow

```bash
thopter status                # overview of all thopters
thopter status my-thopter     # detailed status + logs for one
thopter tail my-thopter -f    # follow Claude's transcript in real time
thopter tell my-thopter "also fix the tests"      # send a follow-up
thopter tell my-thopter -i "stop, work on X now"  # interrupt and redirect

thopter suspend my-thopter    # pause (preserves disk, stops billing)
thopter resume my-thopter     # wake up later
thopter keepalive my-thopter  # reset 12 hour auto-suspend countdown timer

thopter destroy my-thopter    # done for good
```

### File Sync (SyncThing)

Sync a folder in real-time between your laptop and all your devboxes. Agents write files, they appear on your machine instantly. You edit a file, the agent sees it immediately. Uses [SyncThing](https://syncthing.net) — peer-to-peer, encrypted, no cloud accounts.

**How it works:** Your laptop is the hub. Each devbox syncs with your laptop. If your laptop is offline, agents keep working — changes sync when you reconnect. No port forwarding needed; SyncThing handles NAT traversal automatically.

**Setup (one-time, on your laptop):**

```bash
# 1. Install SyncThing
brew install syncthing          # macOS
# or: sudo apt install syncthing  # Linux

# 2. Start it (runs on login after this)
brew services start syncthing   # macOS
# or: sudo systemctl enable --now syncthing@$USER  # Linux

# 3. Create your sync folder
mkdir -p ~/my-sync-folder       # or any name you want

# 4. Configure thopter (auto-detects your SyncThing device ID)
thopter sync init
# You'll be prompted for:
#   Device ID    — auto-detected if SyncThing is running
#   Folder name  — e.g. "my-sync-folder" (becomes ~/my-sync-folder everywhere)
```

That's it. From now on, `thopter create` automatically installs SyncThing on each new devbox and pairs it with your laptop. The sync folder can be anything — a git repo, a plain directory, whatever you want.

```bash
# Pair an existing devbox manually
thopter sync pair my-thopter

# Skip sync on create
thopter create my-thopter --no-sync

# Check what's configured
thopter sync show
```

**For multiple developers:** Each person runs `thopter sync init` with their own folder name and paths. The config lives in `~/.thopter.json` — per-developer, no conflicts.

See [docs/syncthing-artifact-sync.md](docs/syncthing-artifact-sync.md) for the full design doc.

## CLI Reference

The CLI has commands for dispatching work (`run`, `tell`), managing lifecycle (`create`, `suspend`, `resume`, `keepalive`, `destroy`), connecting (`ssh`, `attach`, `exec`), monitoring (`status`, `tail`), snapshots, env vars, and configuration.

See [docs/cli-reference.md](docs/cli-reference.md) for the full command reference.

## Configuration

All config lives in `~/.thopter.json`, managed via `thopter setup`, `thopter config`, and `thopter env`. The key env vars are `GH_TOKEN` (GitHub access) and `THOPTER_REDIS_URL` (status monitoring). Optional: `THOPTER_NTFY_CHANNEL` for push notifications via ntfy.sh.

See [docs/configuration.md](docs/configuration.md) for detailed setup (GitHub tokens, notifications, custom CLAUDE.md, file uploads) and [thopter-json-reference.md](thopter-json-reference.md) for the complete config key reference.

## Architecture

TypeScript CLI built on Commander.js, using the Runloop.ai SDK for devbox lifecycle and Upstash Redis for monitoring. Devboxes are KVM microVMs provisioned with Claude Code, developer tools, and hooks that report status back to Redis.

See [docs/architecture.md](docs/architecture.md) for details on the stack, how provisioning works, devbox contents, and project structure.

## More

- [Clipboard setup](docs/clipboard.md) (Neovim + tmux + iTerm2 OSC 52)
- [SyncThing file sync design](docs/syncthing-artifact-sync.md)
- [Design docs and ideas](docs/)

## Electron GUI (Experimental)

A desktop GUI for managing thopters, built with Electron + React. Dashboard view, live transcript streaming, tmux screen captures, and interactive SSH terminals (xterm.js + node-pty).

**This is highly experimental.** It works for day-to-day use but expect rough edges.

- **Dashboard**: live overview of all thopters with status, task, and action buttons
- **Transcript view**: streaming Claude conversation from Redis
- **Screen view**: tmux screen capture with send-message form
- **Live terminal**: interactive SSH session via xterm.js (persists across tab switches)
- **Run modal**: create new thopters with repo/branch/prompt selection
- **Notifications**: ntfy.sh integration with sidebar

Note: `node-pty` requires native compilation, so requires `build-essential` on Linux, Xcode Command Line Tools on macOS

```bash
cd electron-gui
npm install
npm run rebuild      # rebuild node-pty for Electron's Node ABI
npm run dev          # launch in dev mode (connects to real Redis)
```

The GUI shells out to the `thopter` CLI for mutations (run, destroy, suspend, etc.) and reads directly from Redis for live data (status, transcripts, screen dumps). Make sure the CLI is installed and configured first (`thopter setup`).

