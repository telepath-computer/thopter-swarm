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

# Configure API keys
cp .env.local.example .env.local   # or create manually
# Add RUNLOOP_API_KEY and REDIS_URL to .env.local

# Interactive setup — configures secrets in Runloop platform
# you will need:
# - a Github PAT for the thopters to use for pulling/pushing code 
# - any other secrets you want deployed as env vars to thopters
./thopter setup
```

### Basic Workflow

```bash
# Create a devbox (fresh, with full init)
./thopter create my-thopter

# Or create from a snapshot (fast, pre-configured)
./thopter create my-thopter --snapshot golden

# SSH in
./thopter ssh my-thopter

# Check status from Redis
./thopter status

# Suspend when done (preserves disk, stops billing)
./thopter suspend my-thopter

# Resume later
./thopter resume my-thopter

# Done for good
./thopter destroy my-thopter
```

### Snapshot Workflow

Set up a devbox once, snapshot it, and use that as the base for all future thopters:

```bash
./thopter create golden-setup
./thopter ssh golden-setup
# ... configure everything how you want it ...

./thopter snapshot create golden-setup golden
# sets your preferred snapshot in your homedir thopter config
./thopter snapshot default golden

# Now all new creates use the golden snapshot automatically
./thopter create worker-1
./thopter create worker-2
```

## CLI Reference

### Lifecycle

| Command | Description |
|---------|-------------|
| `./thopter create [name]` | Create a devbox (auto-names if omitted) |
| `./thopter create --snapshot <id>` | Create from a snapshot |
| `./thopter create -a` | Create and immediately SSH in |
| `./thopter list` | List managed devboxes |
| `./thopter suspend <name>` | Suspend a devbox (preserves disk) |
| `./thopter resume <name>` | Resume a suspended devbox |
| `./thopter destroy <name>` | Permanently shut down a devbox |

### Connecting

| Command | Description |
|---------|-------------|
| `./thopter ssh <name>` | SSH into a devbox (via `rli`) |
| `./thopter exec <name> <cmd...>` | Run a command and print output |

### Status

| Command | Description |
|---------|-------------|
| `./thopter status` | Overview of all thopters from Redis |
| `./thopter status <name>` | Detailed status + logs for one thopter |

### Snapshots

| Command | Description |
|---------|-------------|
| `./thopter snapshot list` | List all snapshots |
| `./thopter snapshot create <devbox> [name]` | Snapshot a devbox |
| `./thopter snapshot replace <devbox> <name>` | Replace an existing snapshot |
| `./thopter snapshot destroy <name>` | Delete a snapshot |
| `./thopter snapshot default [name]` | View or set default snapshot |
| `./thopter snapshot default --clear` | Clear default snapshot |

### Secrets

| Command | Description |
|---------|-------------|
| `./thopter setup` | Interactive first-time setup |
| `./thopter secrets list` | List configured secrets |
| `./thopter secrets set <name>` | Create or update a secret |
| `./thopter secrets delete <name>` | Delete a secret |

## Architecture

### Stack

- **CLI**: TypeScript + Commander.js, run via `tsx`
- **Cloud provider**: [Runloop.ai](https://runloop.ai) devboxes (KVM microVMs)
- **SDK**: `@runloop/api-client` for devbox lifecycle, exec, snapshots, secrets
- **Monitoring**: Upstash Redis for heartbeats, status, and last messages
- **SSH**: `rli` CLI (`@runloop/rl-cli`)

### How It Works

1. `./thopter create` provisions a Runloop devbox with metadata tags (`managed_by=runloop-thopters`, `thopter_name=<name>`)
2. On fresh creates (no snapshot), an init script installs Claude Code, neovim, starship, tmux, and configures git credentials from Runloop secrets
3. After the devbox is running, thopter scripts are uploaded: heartbeat reporter, Claude Code hooks, status updater
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
- Git configured with PAT credentials from Runloop secrets
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

### Environment Variables (`.env.local`)

| Variable | Description |
|----------|-------------|
| `RUNLOOP_API_KEY` | Runloop API key (required) |
| `REDIS_URL` | Upstash Redis URL for status reporting (required for `status` command) |

### Runloop Secrets

All secrets in your Runloop account are auto-injected as environment variables into every devbox. The secret name = the env var name. Manage them with `./thopter secrets set <NAME>`.

The devbox init script specifically checks for `GITHUB_PAT` to configure git credentials. Other common secrets you might add:

- `GITHUB_PAT` — Git repo access (used by init script)
- `ANTHROPIC_API_KEY` — Claude Code authentication
- `REDIS_URL` — Status reporting from inside devboxes

**Important:** Runloop re-injects secrets on resume. If any secret that was present when a devbox was created has since been deleted from the platform, the resume will fail. Adding secrets or changing values is fine, but deleting or renaming a secret will break resume for any suspended devbox that was provisioned with it. Shut down those devboxes before deleting secrets.

### Local Config

`~/.runloop-thopters/config.json` stores the default snapshot ID. Managed via `./thopter snapshot default`.
