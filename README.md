# Thopter Swarm

CLI for managing Runloop.ai devboxes as autonomous Claude Code development environments.

Each "thopter" is a cloud microVM pre-configured with Claude Code, git credentials, developer tools (neovim, starship, tmux), and monitoring hooks that report status to Redis. Create one, point it at a repo and a task, and let Claude work autonomously while you monitor from your laptop.

## Quick Start

### Prerequisites

- Node.js 18+
- A [Runloop.ai](https://runloop.ai) account and API key
- An [Upstash](https://upstash.com) Redis instance (for status monitoring)
- The `rli` CLI: `npm install -g @runloop/rl-cli`

### Install

```bash
git clone <this-repo>
cd thopter-swarm
npm install
npm link    # installs the 'thopter' command globally
```

### First-time Setup

```bash
thopter setup
```

This walks you through:
1. Runloop API key
2. Redis URL
3. GitHub token (`GH_TOKEN`) and other env vars
4. ntfy.sh push notifications (optional)

All config is saved to `~/.thopter.json`.

### Your First Thopter

```bash
# Create a fresh devbox (installs Claude, neovim, tmux, etc.)
thopter create my-first --fresh

# SSH in, look around, authenticate Claude, set things up
thopter ssh my-first

# Once you're happy, snapshot it as your golden image
thopter snapshot create my-first golden
thopter snapshot default golden

# Now all future creates use your golden snapshot (fast boot)
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
thopter attach worker-1     # attach to tmux (iTerm2 -CC mode)
thopter ssh worker-1        # SSH in to poke around
```

### Day-to-day Workflow

```bash
thopter status              # overview of all thopters
thopter status my-thopter   # detailed status + logs for one

thopter suspend my-thopter  # pause (preserves disk, stops billing)
thopter resume my-thopter   # wake up later

thopter destroy my-thopter  # done for good
```

## CLI Reference

### Dispatching Work

| Command | Description |
|---------|-------------|
| `thopter run "<prompt>"` | Create a thopter and run Claude with a task |
| `thopter run --repo owner/repo "<prompt>"` | Clone a repo first, then run Claude |
| `thopter run --branch feature "<prompt>"` | Specify a branch to work on |
| `thopter run --name my-worker "<prompt>"` | Name the thopter (auto-generated otherwise) |

### Lifecycle

| Command | Description |
|---------|-------------|
| `thopter create [name]` | Create a devbox (auto-names if omitted) |
| `thopter create --snapshot <id>` | Create from a specific snapshot |
| `thopter create --fresh` | Create without using default snapshot |
| `thopter create -a` | Create and immediately SSH in |
| `thopter create --idle-timeout <min>` | Set idle timeout in minutes (default: 720) |
| `thopter suspend <name>` | Suspend (preserves disk, can resume later) |
| `thopter resume <name>` | Resume a suspended devbox |
| `thopter keepalive <name>` | Reset the idle timer |
| `thopter destroy <name>` | Permanently shut down a devbox |

### Connecting

| Command | Description |
|---------|-------------|
| `thopter ssh <name>` | SSH into a devbox (via `rli`) |
| `thopter attach <name>` | Attach to tmux in iTerm2 control mode (`-CC`) |
| `thopter exec <name> -- <cmd...>` | Run a command and print output |

### Monitoring

| Command | Description |
|---------|-------------|
| `thopter status` | Unified view of all thopters (Runloop + Redis) |
| `thopter status <name>` | Detailed status + logs for one thopter |

`thopter status` (aliased as `thopter list` / `thopter ls`) shows a combined view with devbox state from Runloop and agent state from Redis: task description, whether Claude is running, last heartbeat time.

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
| `thopter env list` | List configured env vars (values masked) |
| `thopter env set <KEY> [VALUE]` | Set a devbox env var (prompts if value omitted) |
| `thopter env delete <KEY>` | Remove a devbox env var |

Env vars are stored in `~/.thopter.json` and written to `~/.thopter-env` inside each devbox at create time.

### Configuration

| Command | Description |
|---------|-------------|
| `thopter setup` | Interactive first-time setup wizard |
| `thopter config get [key]` | View config (omit key to show all) |
| `thopter config set <key> <value>` | Set a config value |

## Configuration

### `~/.thopter.json`

All configuration lives in this file. Managed via `thopter setup`, `thopter config`, `thopter env`, and `thopter snapshot default`.

| Key | Description |
|-----|-------------|
| `runloopApiKey` | Runloop API key (required) |
| `redisUrl` | Upstash Redis URL for status monitoring (required) |
| `defaultSnapshotId` | Default snapshot for `create` (set via `snapshot default`) |
| `ntfyChannel` | ntfy.sh channel for push notifications |
| `stopNotifications` | Enable notifications on Claude stop events (`true`/`false`) |
| `claudeMdPath` | Path to a custom CLAUDE.md to deploy to devboxes |
| `uploads` | Array of `{local, remote}` file upload entries (see below) |
| `envVars` | Key-value map of env vars injected into devboxes |

### Devbox Environment Variables

Env vars in the `envVars` section are written to `~/.thopter-env` inside each devbox at create time.

| Variable | Purpose |
|----------|---------|
| `GH_TOKEN` | GitHub token for git clone/push and `gh` CLI (required) |
| `ANTHROPIC_API_KEY` | Claude Code authentication |
| `OPENAI_API_KEY` | Codex CLI authentication |
| `REDIS_URL` | Status reporting from inside devboxes |

`GH_TOKEN` is also used to configure git credentials (HTTPS credential store) after the devbox boots.

**Tip:** Use `thopter env set GH_TOKEN` (without the value) to enter it interactively, keeping it out of shell history.

### GitHub Token and Branch Rules

Thopter devboxes use a GitHub personal access token (`GH_TOKEN`) for all git operations. The git user is **ThopterBot**.

Thopters are configured to only push to branches prefixed with `thopter/` (e.g. `thopter/fix-login-bug`). They can create pull requests but cannot merge them or push to `main`/`master` directly. This is enforced by convention in the devbox CLAUDE.md, and can be enforced at the GitHub level with branch protection rules.

To create a fine-grained token:
1. Go to GitHub Settings > Developer Settings > Fine-grained tokens
2. Select the repositories you want thopters to access
3. Grant: Contents (read/write), Pull requests (read/write), Issues (read)
4. Set with: `thopter env set GH_TOKEN`

### Notifications (ntfy.sh)

Thopters push notifications to your phone or desktop via [ntfy.sh](https://ntfy.sh) when Claude sends a notification (permission requests, errors, etc.).

1. Pick a unique channel name (e.g. `my-thopters-abc123`)
2. Subscribe on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) or desktop
3. Configure:

```bash
thopter config set ntfyChannel my-thopters-abc123
```

Stop notifications (when Claude finishes a response) are off by default since they're noisy during interactive sessions. Enable them with:

```bash
thopter config set stopNotifications true
```

New thopters created after configuring these will send notifications. Existing thopters need to be re-created or have `THOPTER_NTFY_CHANNEL` (and optionally `THOPTER_STOP_NOTIFY=1`) added to their `~/.thopter-env` manually.

### Custom CLAUDE.md

By default, thopters get a standard CLAUDE.md with devbox environment info and branch conventions. To deploy your own custom CLAUDE.md (e.g. with project-specific instructions), set the path in your config:

```json
{
  "claudeMdPath": "/path/to/my-custom-claude.md"
}
```

The file at that path will be deployed to `~/.claude/CLAUDE.md` on each new devbox, replacing the default.

### File Uploads

You can have files from your local machine automatically uploaded to new devboxes at create time:

```json
{
  "uploads": [
    { "local": "/path/to/local/file", "remote": "/home/user/destination" }
  ]
}
```

Each entry copies the local file to the specified remote path on the devbox. This runs after all other provisioning, so it can override default configs if needed.

## Architecture

### Stack

- **CLI**: TypeScript + Commander.js, run via `tsx`
- **Cloud provider**: [Runloop.ai](https://runloop.ai) devboxes (KVM microVMs)
- **SDK**: `@runloop/api-client` for devbox lifecycle, exec, snapshots
- **Monitoring**: Upstash Redis for heartbeats, status, and last messages
- **SSH**: `rli` CLI (`@runloop/rl-cli`)

### How It Works

1. `thopter create` provisions a Runloop devbox with metadata tags (`managed_by=runloop-thopters`, `thopter_name=<name>`, `thopter_owner=<git-user>`)
2. On fresh creates (no snapshot), an init script installs Claude Code, Codex, neovim, starship, tmux, and developer tools
3. After the devbox is running, env vars from `~/.thopter.json` are written to `~/.thopter-env`, git credentials are configured via the credential store, and thopter scripts (hooks, heartbeat, status) are uploaded
4. Claude Code hooks fire on session events (start, stop, notification, prompt, tool use) and report to Redis via `thopter-status`
5. A cron job runs a heartbeat every ~10 seconds, setting an `alive` key with 30s TTL as a dead-man's switch
6. Devboxes auto-suspend after 12 hours idle (configurable via `--idle-timeout`)

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

### Project Structure

```
src/           TypeScript source
  cli.ts       CLI entrypoint (Commander.js commands)
  devbox.ts    Devbox lifecycle (create, list, destroy, ssh, exec, snapshot)
  run.ts       thopter run (create + clone + launch Claude)
  status.ts    Redis status queries
  config.ts    Local config (~/.thopter.json) management
  client.ts    Runloop SDK singleton
  setup.ts     Interactive setup wizard
  names.ts     Random name generator
  output.ts    Table formatting helper

scripts/       Devbox-side scripts (uploaded on create)
  thopter-status.sh            Redis status reporter
  thopter-heartbeat.sh         Heartbeat cron loop
  thopter-cron-install.sh      Installs heartbeat cron job
  thopter-last-message.mjs     Extracts last assistant message from transcript
  thopter-claude-md.md         CLAUDE.md deployed to devboxes
  install-claude-hooks.mjs     Merges hook config into Claude settings.json
  claude-hook-*.sh             Individual Claude Code event hooks
  starship.toml                Starship prompt config
  tmux.conf                    tmux config (Ctrl-a prefix)
  nvim-options.lua             Neovim options (OSC 52 clipboard)

docs/          Design docs and brainstorms (not authoritative)
```

### Naming Convention

Thopter names are free-form strings. A useful team convention is `initials/purpose`:

```bash
thopter create jw/auth-fix
thopter create jw/golden        # for your golden snapshot
```

If you omit the name, a random friendly name is generated (e.g. `curious-lighthouse`).

## Clipboard (Neovim + tmux + iTerm2)

Yanking text in Neovim on a remote thopter and pasting on your local Mac works via OSC 52 escape sequences. The chain is:

```
Neovim → tmux → SSH → iTerm2 → macOS clipboard
```

This is pre-configured on thopter devboxes. The one manual step on your Mac:

**iTerm2 > Preferences > General > Selection > "Applications in terminal may access clipboard"** must be enabled.

See `docs/clipboard.md` for troubleshooting.

## Build

```bash
npm install          # install dependencies
npm run build        # compile TypeScript (tsc)
./thopter --help     # see CLI commands
```

The `thopter` wrapper script runs `src/cli.ts` via `tsx` so you don't need to compile during development, but always run `npm run build` before committing to verify TypeScript compiles cleanly.
