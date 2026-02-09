# CLI Reference

Full command reference for the `thopter` CLI. See the [README](../README.md) for a quick start guide.

## Dispatching Work

| Command | Description |
|---------|-------------|
| `thopter run "<prompt>"` | Create a thopter and run Claude with a task |
| `thopter run --repo owner/repo "<prompt>"` | Clone a repo first, then run Claude |
| `thopter run --branch feature "<prompt>"` | Specify a branch to work on |
| `thopter run --name my-worker "<prompt>"` | Name the thopter (auto-generated otherwise) |

## Lifecycle

| Command | Description |
|---------|-------------|
| `thopter create [name]` | Create a devbox (auto-names if omitted) |
| `thopter create --snapshot <id>` | Create from a specific snapshot |
| `thopter create --fresh` | Create without using default snapshot |
| `thopter create -a` | Create and immediately SSH in |
| `thopter create --keep-alive <min>` | Set keep-alive time in minutes (default: 720) |
| `thopter suspend <name>` | Suspend (preserves disk, can resume later) |
| `thopter resume <name>` | Resume a suspended devbox |
| `thopter keepalive <name>` | Reset the keep-alive timer |
| `thopter destroy <name>` | Permanently shut down a devbox |

## Connecting

| Command | Description |
|---------|-------------|
| `thopter ssh <name>` | SSH into a devbox (via `rli`) |
| `thopter attach <name>` | Attach to tmux in iTerm2 control mode (`-CC`) |
| `thopter exec <name> -- <cmd...>` | Run a command and print output |

## Monitoring

| Command | Description |
|---------|-------------|
| `thopter status` | Unified view of all thopters (Runloop + Redis) |
| `thopter status <name>` | Detailed status + logs for one thopter |
| `thopter tail <name>` | Show last 20 transcript entries |
| `thopter tail <name> -f` | Follow transcript in real time |
| `thopter tail <name> -n 50` | Show last 50 entries |

`thopter status` (aliased as `thopter list` / `thopter ls`) shows a combined view with devbox state from Runloop and agent state from Redis: task description, whether Claude is running, last heartbeat time.

`thopter tail` streams Claude's transcript from Redis, showing a condensed view of each conversation turn (user messages, assistant responses, tool calls). Use `-f` to follow in real time — like `tail -f` for your thopter's Claude session.

## Snapshots

| Command | Description |
|---------|-------------|
| `thopter snapshot list` | List all snapshots |
| `thopter snapshot create <devbox> [name]` | Snapshot a devbox |
| `thopter snapshot replace <devbox> <name>` | Replace an existing snapshot |
| `thopter snapshot destroy <name>` | Delete a snapshot |
| `thopter snapshot default [name]` | View or set default snapshot |
| `thopter snapshot default --clear` | Clear default snapshot |

## Environment Variables

| Command | Description |
|---------|-------------|
| `thopter env list` | List configured env vars (values masked) |
| `thopter env set <KEY> [VALUE]` | Set a devbox env var (prompts if value omitted) |
| `thopter env delete <KEY>` | Remove a devbox env var |

Env vars are stored in `~/.thopter.json` and written to `~/.thopter-env` inside each devbox at create time.

## Configuration

| Command | Description |
|---------|-------------|
| `thopter setup` | Interactive first-time setup wizard |
| `thopter config get [key]` | View config (omit key to show all) |
| `thopter config set <key> <value>` | Set a config value |
