# CLI Reference

Reference for the `thopter` CLI. The active provider is currently `digitalocean` (`thopter provider`), but some command descriptions still carry RunLoop-era wording.

See the [README](../README.md) for the practical workflow.

## Provider

| Command | Description |
|---------|-------------|
| `thopter provider` | Print the active infrastructure provider |

## Dispatching Work

| Command | Description |
|---------|-------------|
| `thopter run "<prompt>"` | Create a thopter and run Claude with a prompt |
| `thopter run --repo owner/repo "<prompt>"` | Clone a repo first, then run Claude |
| `thopter run --branch feature "<prompt>"` | Specify a branch to work on |
| `thopter run --name my-worker "<prompt>"` | Name the thopter explicitly |
| `thopter tell <name> "<message>"` | Send a message to a running Claude session |
| `thopter tell <name> -i "<message>"` | Interrupt Claude first, then send the message |

## Lifecycle

| Command | Description |
|---------|-------------|
| `thopter create [name]` | Create a thopter |
| `thopter create --snapshot <name-or-id>` | Restore from a specific snapshot |
| `thopter create --fresh` | Ignore the default snapshot and create fresh |
| `thopter create -a` | Create and immediately SSH in |
| `thopter destroy <name>` | Permanently delete a thopter |
| `thopter snapshot list` | List snapshots |
| `thopter snapshot create <thopter> [name]` | Snapshot a thopter |
| `thopter snapshot replace <thopter> <name>` | Replace an existing snapshot |
| `thopter snapshot destroy <name>` | Delete a snapshot |
| `thopter snapshot default [name]` | View or set the default snapshot |
| `thopter snapshot default --clear` | Clear the default snapshot |

### Lifecycle Caveats In DigitalOcean Mode

These commands are present for compatibility, but are not supported by the active provider:

| Command | Current behavior |
|---------|------------------|
| `thopter suspend <name>` | Fails with an explicit unsupported message |
| `thopter resume <name>` | Fails with an explicit unsupported message |
| `thopter keepalive <name>` | Fails with an explicit unsupported message |

## Connecting

| Command | Description |
|---------|-------------|
| `thopter ssh <name>` | SSH into a thopter |
| `thopter attach <name>` | Attach to tmux in iTerm2 control mode (`-CC`) |
| `thopter exec <name> -- <cmd...>` | Run a one-off command remotely |

## Monitoring

| Command | Description |
|---------|-------------|
| `thopter status` | Unified provider + Redis view of all thopters |
| `thopter status <name>` | Detailed status for one thopter |
| `thopter tail <name>` | Show recent transcript entries |
| `thopter tail <name> -f` | Follow transcript in real time |
| `thopter tail <name> -n 50` | Show more transcript entries |
| `thopter check <name>` | Check whether tmux and Claude are running |

`thopter status` combines provider-side machine state with Redis-side agent state such as the status line, heartbeat freshness, and recent activity.

`thopter tail` streams the Claude transcript from Redis.

## Convenience Commands

| Command | Description |
|---------|-------------|
| `thopter use <name>` | Set the default thopter |
| `thopter use` | Show the default thopter |
| `thopter use --clear` | Clear the default thopter |

When a command accepts a thopter name, `.` can be used to refer to the default thopter.

## Repositories

| Command | Description |
|---------|-------------|
| `thopter repos list` | List predefined repositories |
| `thopter repos add` | Add a predefined repository |
| `thopter repos remove` | Remove a predefined repository |
| `thopter repos edit` | Edit a predefined repository |

These repos appear as a chooser when `thopter run` is used without `--repo`.

## Environment Variables

| Command | Description |
|---------|-------------|
| `thopter env list` | List configured env vars (masked) |
| `thopter env set <KEY> [VALUE]` | Set a devbox env var |
| `thopter env delete <KEY>` | Delete a devbox env var |

Env vars are stored locally in `~/.thopter.json` and written into new thopters as `~/.thopter-env`.

## Configuration

| Command | Description |
|---------|-------------|
| `thopter setup` | Interactive first-time setup |
| `thopter config get [key]` | Show config |
| `thopter config set <key> <value>` | Set a config value |
