# Thopter Swarm

CLI for managing Runloop.ai devboxes as autonomous Claude Code development environments.

Each "thopter" is a cloud microVM pre-configured with Claude Code, git credentials, developer tools (neovim, starship, tmux), and monitoring hooks that report status to Redis. Create one, SSH in, and let Claude work. Snapshot your setup and stamp out new thopters instantly.

## Quick Start

### Prerequisites

- Node.js 18+
- A [Runloop.ai](https://runloop.ai) account and API key
- An [Upstash](https://upstash.com) Redis instance (for status monitoring)
- The `rli` CLI: `npm install -g @runloop/rl-cli`

### Setup

```bash
npm install

# Install the 'thopter' command globally
npm link

# Interactive setup — walks you through API keys, env vars, notifications
thopter setup
```

### Basic Workflow

```bash
# Create a devbox (fresh, with full init)
thopter create my-thopter

# Or create from a snapshot (fast, pre-configured)
thopter create my-thopter --snapshot golden

# SSH in
thopter ssh my-thopter

# Check status from Redis
thopter status

# Suspend when done (preserves disk, stops billing)
thopter suspend my-thopter

# Resume later
thopter resume my-thopter

# Done for good
thopter destroy my-thopter
```

### Snapshot Workflow

Set up a devbox once, snapshot it, and use that as the base for all future thopters:

```bash
thopter create golden-setup
thopter ssh golden-setup
# ... configure everything how you want it ...

thopter snapshot create golden-setup golden
# sets your preferred snapshot in your homedir thopter config
thopter snapshot default golden

# Now all new creates use the golden snapshot automatically
thopter create worker-1
thopter create worker-2
```

## CLI Reference

### Lifecycle

| Command | Description |
|---------|-------------|
| `thopter create [name]` | Create a devbox (auto-names if omitted) |
| `thopter create --snapshot <id>` | Create from a snapshot |
| `thopter create -a` | Create and immediately SSH in |
| `thopter list` | List managed devboxes |
| `thopter suspend <name>` | Suspend a devbox (preserves disk) |
| `thopter resume <name>` | Resume a suspended devbox |
| `thopter destroy <name>` | Permanently shut down a devbox |

### Connecting

| Command | Description |
|---------|-------------|
| `thopter ssh <name>` | SSH into a devbox (via `rli`) |
| `thopter exec <name> <cmd...>` | Run a command and print output |

### Status

| Command | Description |
|---------|-------------|
| `thopter status` | Overview of all thopters from Redis |
| `thopter status <name>` | Detailed status + logs for one thopter |

### Snapshots

| Command | Description |
|---------|-------------|
| `thopter snapshot list` | List all snapshots |
| `thopter snapshot create <devbox> [name]` | Snapshot a devbox |
| `thopter snapshot replace <devbox> <name>` | Replace an existing snapshot |
| `thopter snapshot destroy <name>` | Delete a snapshot |
| `thopter snapshot default [name]` | View or set default snapshot |
| `thopter snapshot default --clear` | Clear default snapshot |

### Environment Variables

| Command | Description |
|---------|-------------|
| `thopter setup` | Interactive first-time setup |
| `thopter env list` | List configured env vars (values masked) |
| `thopter env set <key> <value>` | Set a devbox env var |
| `thopter env delete <key>` | Remove a devbox env var |

## Architecture

### Stack

- **CLI**: TypeScript + Commander.js, run via `tsx`
- **Cloud provider**: [Runloop.ai](https://runloop.ai) devboxes (KVM microVMs)
- **SDK**: `@runloop/api-client` for devbox lifecycle, exec, snapshots
- **Monitoring**: Upstash Redis for heartbeats, status, and last messages
- **SSH**: `rli` CLI (`@runloop/rl-cli`)

### How It Works

1. `thopter create` provisions a Runloop devbox with metadata tags (`managed_by=runloop-thopters`, `thopter_name=<name>`)
2. On fresh creates (no snapshot), an init script installs Claude Code, neovim, starship, tmux, and developer tools
3. After the devbox is running, env vars from `~/.thopter.json` are written to `~/.thopter-env`, git credentials are configured, and thopter scripts are uploaded
4. Claude Code hooks fire on session events (start, stop, notification, prompt) and report to Redis via `thopter-status`
5. A cron job runs a heartbeat every ~10 seconds, setting an `alive` key with 30s TTL as a dead-man's switch
6. Devboxes auto-suspend after 1 hour idle (configurable via `--idle-timeout`)

### Devbox Contents

Each thopter devbox gets:

- Claude Code (`claude` CLI)
- OpenAI Codex (`codex` CLI)
- Neovim + NvChad with OSC 52 clipboard support
- Starship prompt showing thopter name
- tmux with Ctrl-a prefix
- Git configured with GH_TOKEN credentials from `~/.thopter-env`
- Heartbeat cron reporting to Redis
- Claude Code hooks for status reporting

### Scripts

| Script | Purpose |
|--------|---------|
| `thopter-status.sh` | Reports key/value status updates to Redis |
| `thopter-claude-md.md` | CLAUDE.md deployed to devboxes (environment + branch conventions) |
| `thopter-heartbeat.sh` | Heartbeat loop (runs via cron, reports alive + Claude process status) |
| `thopter-cron-install.sh` | Installs the heartbeat cron job |
| `thopter-last-message.mjs` | Extracts last assistant message from Claude transcript |
| `install-claude-hooks.mjs` | Merges Claude Code hook config into settings.json |
| `claude-hook-*.sh` | Individual Claude Code event hooks |
| `starship.toml` | Starship prompt config (shows thopter name) |
| `tmux.conf` | tmux config (Ctrl-a prefix) |
| `nvim-options.lua` | Neovim options (OSC 52 clipboard) |

## Configuration

### Local Config (`~/.thopter.json`)

All configuration lives in `~/.thopter.json`. Managed via `thopter config`, `thopter env`, and `thopter snapshot default`.

| Key | Description |
|-----|-------------|
| `runloopApiKey` | Runloop API key (required) |
| `redisUrl` | Upstash Redis URL for operator-side status display (required) |
| `defaultSnapshotId` | Default snapshot for `create` (set via `snapshot default`) |
| `ntfyChannel` | ntfy.sh channel for push notifications (set via `config set`) |
| `envVars` | Key-value map of env vars injected into devboxes |

### Devbox Environment Variables

Environment variables in the `envVars` section of `~/.thopter.json` are written to `~/.thopter-env` inside each devbox at create time. Manage them with `thopter env set <KEY> <VALUE>`.

Common env vars:

- `GH_TOKEN` — GitHub token for git clone/push and the `gh` CLI (required)
- `ANTHROPIC_API_KEY` — Claude Code authentication
- `OPENAI_API_KEY` — Codex CLI authentication
- `REDIS_URL` — Status reporting from inside devboxes

`GH_TOKEN` is used to configure git credentials (HTTPS credential store) after the devbox boots. The `thopter setup` wizard walks you through configuring these.

### Notifications (ntfy.sh)

Thopters can push notifications to your phone or desktop via [ntfy.sh](https://ntfy.sh) when Claude stops working or sends a notification.

1. Pick a unique channel name (e.g. `my-thopters-abc123`)
2. Subscribe on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) or desktop
3. Configure the channel:

```bash
thopter config set ntfyChannel my-thopters-abc123
```

New thopters created after this will send notifications. Existing thopters need to be re-created or have `THOPTER_NTFY_CHANNEL` added to their `~/.thopter-env` manually.

**What triggers notifications:**
- **Claude stops** — includes the last assistant message so you can see what happened
- **Claude Code notifications** — permission requests, errors, etc.
