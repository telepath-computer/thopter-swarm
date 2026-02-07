# Sprite Thopters: Persistent Dev Environments on Fly Sprites

## Goal

Long-lived, pausable development environments for autonomous Claude Code agents
(and interactive dev work), powered by [Fly Sprites](https://sprites.dev). A
single CLI manages the full lifecycle: create, pause, resume, shell in, port
forward, checkpoint, restore, destroy.

Unlike Modal sandboxes (which have a 24-hour hard limit and must be
snapshotted/cloned for persistence), Sprites are **persistent microVMs** that
hibernate when idle and wake instantly. This means each sprite is set up once
and lives as long as you need it — no golden-image workflow required.

## Why Sprites Over Modal Sandboxes

| | Modal Sandbox | Fly Sprite |
|---|---|---|
| **Max lifetime** | 24 hours (hard limit) | Unlimited |
| **Idle behavior** | Must set idle timeout, then dies | Hibernates automatically, free when idle |
| **Resume** | Must fork from snapshot | Just wake it up (~100-500ms warm, 1-2s cold) |
| **Clone/fork** | Yes (snapshot → new sandbox) | No (but not needed — sprites are long-lived) |
| **Checkpoint** | Filesystem snapshots | Full checkpoint + restore (same sprite) |
| **Base image** | Custom (you build it) | Ubuntu 24.04 LTS, batteries included |
| **Preinstalled** | Whatever you bake in | Node, Python, Go, Rust, Git, Claude CLI, etc. |
| **Storage** | Ephemeral (lost on timeout) | 100GB persistent ext4 |
| **Networking** | Limited | Public URLs, TCP proxy, port forwarding |
| **Isolation** | Container | Firecracker microVM (hardware-level) |

The key tradeoff: Sprites can't clone, but they don't need to because they
never expire. Set up a sprite once, pause it when you're done, resume it
whenever. The checkpoint/restore system lets you save known-good states within
each sprite.

## Architecture Overview

A Python CLI (`sprite-thopters/cli.py`) that wraps both the Sprites Python SDK
(`sprites-py`) for programmatic operations and the `sprite` CLI for interactive
operations (console, proxy). Local config stores secrets and preferences.

```
Developer laptop
  └── cli.py  (commands: create, list, pause, resume, shell, exec, proxy,
        │               checkpoint, restore, rename, destroy, setup)
        ├── sprites-py SDK → Sprites REST API (https://api.sprites.dev)
        └── sprite CLI     → interactive console, port forwarding
```

No hub, no dashboard, no GitHub polling. Just a local CLI that talks directly
to the Sprites API.

## Sprite Environment

### Base Image (Provided by Sprites)

Sprites ship with Ubuntu 24.04 LTS and an extensive set of preinstalled tools:

- **Languages**: Node.js, Python, Go, Ruby, Rust, Elixir, Java, Bun, Deno
- **Dev tools**: Git, curl, wget, vim, ripgrep, common build tools
- **AI tools**: Claude CLI, Gemini CLI, OpenAI Codex
- **Storage**: 100GB persistent ext4 filesystem at `/home/sprite/`

This means we do **not** need to build a custom image. The init script only
configures credentials and personal preferences on top of what's already there.

### Secrets & Environment Variables

Stored locally in `~/.sprite-thopters/config.json` and injected into each
sprite during creation via the init script. Written to `/home/sprite/.bashrc`
so they persist across hibernation cycles.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access (for Claude Code) |
| `OPENAI_API_KEY` | OpenAI API access (optional) |
| `GITHUB_PAT` | GitHub personal access token for clone/push |

Additional user-defined variables can be added to the config and will be
injected alongside the above.

### Init Script

Runs inside the sprite on first `create` to configure the environment. Since
the base image already has most tools, this is lightweight:

```bash
set -e

# Configure git credentials using PAT
if [ -n "$GITHUB_PAT" ]; then
    git config --global credential.helper store
    echo "https://${GITHUB_USER:-thopterbot}:${GITHUB_PAT}@github.com" > ~/.git-credentials
    git config --global user.name "${GITHUB_USER:-ThopterBot}"
    git config --global user.email "${GITHUB_EMAIL:-thopterbot@telepath.computer}"
    echo "Git configured with PAT credentials"
else
    echo "WARNING: GITHUB_PAT not set, git push/pull to private repos won't work"
fi

# Write API keys to .bashrc for persistence across hibernation
cat >> ~/.bashrc << 'ENVBLOCK'
# --- sprite-thopters environment ---
export ANTHROPIC_API_KEY="__ANTHROPIC_API_KEY__"
export OPENAI_API_KEY="__OPENAI_API_KEY__"
export GITHUB_PAT="__GITHUB_PAT__"
# --- end sprite-thopters ---
ENVBLOCK

# Ensure locale is good
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

echo "Sprite init complete"
```

The `__PLACEHOLDER__` values are replaced with actual secrets from the local
config before the script is executed.

## CLI Commands

All commands are run as `python cli.py <command>` from the `sprite-thopters/`
directory (or via a shell alias / entry point).

### `setup` — First-time configuration

```bash
python cli.py setup
```

- Checks that the `sprite` CLI is installed and authenticated
- Interactively prompts for API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY,
  GITHUB_PAT) and optional git identity
- Saves to `~/.sprite-thopters/config.json`
- Validates credentials where possible (e.g. test GitHub PAT)

### `create` — Spin up a new sprite

```bash
python cli.py create <name>
python cli.py create dev-main
python cli.py create issue-42 --no-init    # skip init script (for advanced use)
```

- Creates a sprite via the Sprites API with the given name
- Runs the init script to configure git credentials and inject API keys
- Sprite is immediately ready for `shell` or `exec`

### `list` / `ls` — Show all sprites with status

```bash
python cli.py list
python cli.py ls
python cli.py list --prefix dev-
```

Output:
```
Name              Status      Updated
────────────────  ──────────  ────────────────────
dev-main          running     2 minutes ago
issue-42          hibernating 3 hours ago
experiment-1      hibernating 2 days ago
```

- Queries the Sprites API for all sprites in the org
- Shows name, current status (running / hibernating), and last updated time
- Optional `--prefix` filter to narrow the list

### `pause` — Hibernate a sprite

```bash
python cli.py pause <name>
python cli.py pause dev-main
```

- Sprites hibernate automatically on idle, but this forces immediate
  hibernation
- All filesystem state is preserved
- No compute charges while hibernated
- Implementation: exec a no-op or simply let the idle timeout trigger; if the
  API supports explicit hibernate, use that. Otherwise, document that sprites
  auto-hibernate and this command is a convenience/no-op reminder.

Note: The Sprites platform auto-hibernates idle sprites. This command exists
for explicit "I'm done for now" intent. If the API doesn't expose a direct
hibernate call, this will simply confirm the sprite exists and inform the user
it will hibernate on its own shortly.

### `resume` / `wake` — Wake a hibernated sprite

```bash
python cli.py resume <name>
python cli.py wake dev-main
```

- Sends any command (e.g. `true`) to wake the sprite from hibernation
- Reports wake time (warm: ~100-500ms, cold: 1-2s)
- Sprite is then ready for `shell`, `exec`, etc.

### `shell` / `console` — Interactive terminal session

```bash
python cli.py shell <name>
python cli.py console dev-main
```

- Opens an interactive bash session inside the sprite
- Uses the `sprite console` CLI command for proper PTY support
- `Ctrl-D` or `exit` to detach (sprite keeps running)

### `exec` — Run a command in a sprite

```bash
python cli.py exec <name> -- <command...>
python cli.py exec dev-main -- uname -a
python cli.py exec dev-main -- claude --dangerously-skip-permissions
python cli.py exec dev-main -- git clone https://github.com/user/repo
```

- Runs a one-off command and streams stdout/stderr
- Exits with the command's exit code
- Uses the Python SDK for programmatic execution

### `proxy` — Port forwarding

```bash
python cli.py proxy <name> <ports...>
python cli.py proxy dev-main 8080
python cli.py proxy dev-main 3001:3000    # local:remote
python cli.py proxy dev-main 3000 8080    # multiple ports
```

- Forwards TCP ports from the sprite to localhost
- Uses the `sprite proxy` CLI command under the hood
- Enables accessing dev servers, databases, etc. running in the sprite

### `url` — Get or manage the sprite's public URL

```bash
python cli.py url <name>
python cli.py url dev-main --public       # make URL publicly accessible
python cli.py url dev-main --private      # require auth (default)
```

- Each sprite gets a `https://<name>.sprites.app` URL routing to port 8080
- Useful for webhooks, sharing preview URLs, etc.

### `checkpoint` — Save a restore point

```bash
python cli.py checkpoint <name> [--comment COMMENT]
python cli.py checkpoint dev-main --comment "before refactor"
```

- Captures the full filesystem state as a named checkpoint
- Checkpoints are scoped to the individual sprite (not transferable)
- Use before risky operations so you can roll back

### `restore` — Roll back to a checkpoint

```bash
python cli.py restore <name> <checkpoint-id>
python cli.py restore dev-main chk_abc123
```

- Restores the sprite's filesystem to a previous checkpoint
- Lists available checkpoints if no ID given

### `checkpoints` — List checkpoints for a sprite

```bash
python cli.py checkpoints <name>
```

- Shows all checkpoints for the sprite with IDs, comments, and timestamps

### `rename` — Rename a sprite

```bash
python cli.py rename <old-name> <new-name>
```

- Renames the sprite via the API's PATCH endpoint (if supported)
- If the API doesn't support renaming, this will error with a clear message
  explaining the limitation

### `destroy` — Permanently delete a sprite

```bash
python cli.py destroy <name>
python cli.py destroy experiment-1
```

- Deletes the sprite and ALL its data (filesystem, checkpoints, everything)
- Requires confirmation (or `--yes` to skip)
- **Irreversible**

## Configuration

### Local Config File

`~/.sprite-thopters/config.json`:
```json
{
  "secrets": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-...",
    "GITHUB_PAT": "ghp_..."
  },
  "git": {
    "user": "ThopterBot",
    "email": "thopterbot@telepath.computer"
  },
  "defaults": {
    "prefix": ""
  }
}
```

### Sprite CLI Auth

The `sprite` CLI handles its own authentication via `sprite org auth` (opens
browser for Fly.io login). The Python SDK uses a token from the CLI's config
or via the `SPRITE_TOKEN` environment variable.

Token location: `~/.sprites/sprites.json` (or system keyring).

## Lifecycle

```
setup → create → shell/exec → (pause) → resume → shell/exec → ...
                     │                                │
                     └── checkpoint ──── restore ──────┘
                                                      │
                                                   destroy
```

The key difference from modal-thopters: there's no snapshot → fork cycle.
Each sprite is a persistent entity. You create it once, pause/resume it as
needed, and use checkpoints as internal save points within that single sprite.

## Typical Workflows

### First-time setup
```bash
# 1. Install the sprite CLI
brew install superfly/tap/sprite   # or: curl -fsSL https://sprites.dev/install | bash

# 2. Authenticate
sprite org auth                     # opens browser

# 3. Configure sprite-thopters
python cli.py setup                 # enter API keys, git config
```

### Create a new dev environment
```bash
python cli.py create dev-main
python cli.py shell dev-main
# Inside the sprite:
#   git clone https://github.com/your-org/your-repo
#   cd your-repo
#   npm install  (or whatever)
#   claude --dangerously-skip-permissions
# When done, Ctrl-D to exit shell. Sprite auto-hibernates.
```

### Resume work next day
```bash
python cli.py list                  # see what's available
python cli.py shell dev-main       # auto-wakes from hibernation
# Everything is exactly as you left it
```

### Safe experimentation
```bash
python cli.py checkpoint dev-main --comment "known good state"
python cli.py shell dev-main
# ... try risky refactor ...
# Didn't work out:
python cli.py restore dev-main <checkpoint-id>
```

### Multiple parallel environments
```bash
python cli.py create issue-42
python cli.py create issue-55
python cli.py create experiment-llm-context
python cli.py list
# Pause ones you're not using (or let them auto-hibernate)
python cli.py pause issue-55
```

## File Layout

```
sprite-thopters/
├── SPEC.md           # this file
├── cli.py            # CLI entrypoint (argparse)
├── sprites.py        # Sprite management logic (SDK wrapper)
├── config.py         # Config/secrets management (~/.sprite-thopters/)
├── pyproject.toml    # Python project config + dependencies
└── README.md         # usage examples
```

## Dependencies

```toml
[project]
requires-python = ">=3.11"
dependencies = [
    "sprites-py",      # Sprites Python SDK
    "httpx",           # HTTP client (SDK dependency, also useful directly)
]
```

The `sprite` CLI (installed separately via brew or curl) is required for
interactive operations (console, proxy). The Python SDK handles all
programmatic API calls.

## What We're NOT Doing

- No hub/dashboard — just CLI
- No GitHub issue polling — manual sprite creation
- No egress firewall management (Sprites has network policy API if needed
  later)
- No automatic Claude Code launch — user launches it manually in shell
- No multi-repo orchestration
- No cloning between sprites (Sprites doesn't support this)
- No custom base image (the default Ubuntu 24.04 image is sufficient)
- No tmux/gotty web terminal — use `cli.py shell` or `sprite console`
- No status observer or session log HTML

## Open Questions

1. **Explicit hibernate API**: Does the Sprites API expose a direct
   "hibernate now" endpoint, or do sprites only hibernate via idle timeout?
   The `pause` command's implementation depends on this.

2. **Rename support**: The `PATCH /v1/sprites/{name}` endpoint exists but it's
   unclear if the name field is mutable. Need to test.

3. **Network policy for egress firewall**: Sprites has a network policy API
   (`GET/POST /v1/sprites/{name}/policy/network`). Worth using later if we
   want to lock down sprite network access like thopter-swarm's firewall.

4. **Services**: Sprites has a "services" concept (persistent background
   processes). Could be useful for running dev servers that survive
   disconnection. Investigate later.

5. **Filesystem API**: Sprites exposes file read/write via REST
   (`GET/PUT /v1/sprites/{name}/files/*`). Could enable file transfer without
   needing SSH/SCP. Worth exploring for `upload`/`download` commands.
