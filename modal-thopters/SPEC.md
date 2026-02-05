# Modal Thopters: Minimal Sandbox Spec

## Goal

Get to a fast, repeatable workflow where a single bash command spins up a Modal
Sandbox with Claude Code pre-installed, pre-authorized, and ready to work on
our repos. No hub, no dashboard, no polling — just sandboxes on demand.

## Architecture Overview

A single Python CLI script (`modal-thopters/cli.py`) that wraps the Modal
Python SDK to manage sandboxes. All state (snapshot IDs, sandbox IDs) stored in
a local JSON file (`~/.modal-thopters/state.json`).

```
Developer laptop
  └── cli.py  (commands: create, shell, exec, snapshot, fork, list, destroy)
        └── Modal SDK → Modal cloud sandboxes
```

## Sandbox Environment

### Base Image

Built via `modal.Image.debian_slim()` with layered installs to maximize cache
hits. Mirrors the critical parts of `thopter/Dockerfile`:

```python
image = (
    modal.Image.debian_slim(python_version="3.12")
    # System packages (mirrors Dockerfile)
    .apt_install(
        # core tools
        "git", "curl", "wget", "jq", "vim", "tmux", "htop",
        # build tools
        "build-essential", "cmake", "pkg-config",
        # python extras
        "python3-venv",
        # search tools
        "ripgrep",
        # locale
        "locales",
        # browser support (for Playwright)
        "xvfb",
    )
    # Generate locale
    .run_commands("locale-gen en_US.UTF-8")
    # Node.js 20
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    # Playwright browser deps (browsers installed on demand)
    .run_commands("npx playwright install-deps")
    # Claude Code CLI
    .run_commands("npm install -g @anthropic-ai/claude-code")
    # uv package manager
    .run_commands("curl -LsSf https://astral.sh/uv/install.sh | sh")
    # Environment variables
    .env({
        "LANG": "en_US.UTF-8",
        "LC_ALL": "en_US.UTF-8",
        "TERM": "xterm-256color",
        "FORCE_COLOR": "1",
    })
)
```

### Secrets (injected as environment variables)

Stored as a Modal Secret called `"thopter-secrets"`, created via the Modal
dashboard or `modal secret create`. Contains:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access |
| `OPENAI_API_KEY` | OpenAI API access (used by some tools) |
| `GITHUB_PAT` | GitHub personal access token for clone/push |
| `FIRECRAWL_API_KEY` | Firecrawl access (if needed) |

These get injected into every sandbox automatically. The git config is set up
in the sandbox init so `GITHUB_PAT` is used for HTTPS clone/push.

### Sandbox Init Script

On first `create`, a setup script runs inside the sandbox to configure the
environment:

```bash
# Configure git to use PAT for HTTPS
git config --global credential.helper store
echo "https://thopterbot:${GITHUB_PAT}@github.com" > ~/.git-credentials
git config --global user.name "ThopterBot"
git config --global user.email "thopterbot@telepath.computer"

# Ensure Claude Code can find the API key
# (ANTHROPIC_API_KEY is already in env from Modal secrets)
```

## CLI Commands

All commands are run from the `modal-thopters/` directory.

### `create` — Spin up a new sandbox

```bash
# From base image (first time, or fresh)
python cli.py create [--name NAME]

# From a snapshot (fast, pre-configured)
python cli.py create --from-snapshot SNAPSHOT_ID [--name NAME]
```

- Creates a sandbox with the base image (or snapshot image)
- Injects `thopter-secrets`
- Runs the init script (git config, etc.)
- Prints the sandbox ID
- Sandbox timeout: 24 hours (max), idle timeout: 1 hour

### `shell` — Get an interactive bash session

```bash
python cli.py shell SANDBOX_ID
```

- Attaches an interactive PTY shell to the sandbox via `sb.exec("bash")`
  with stdin/stdout/stderr piped to the local terminal
- This is the primary way to interact — run Claude Code, inspect files, etc.

### `exec` — Run a command in a sandbox

```bash
python cli.py exec SANDBOX_ID -- echo hello
python cli.py exec SANDBOX_ID -- claude --dangerously-skip-permissions
```

- Runs a one-off command and streams stdout/stderr

### `snapshot` — Snapshot a sandbox's filesystem

```bash
python cli.py snapshot SANDBOX_ID [--label LABEL]
```

- Calls `sb.snapshot_filesystem()` to capture the current state
- Saves the resulting image ID to local state file with optional label
- This is how you "bake" a sandbox after authorizing Claude Code, installing
  Playwright browsers, cloning repos, etc.

**Key workflow**: Create a sandbox, authorize Claude Code interactively in a
shell session, then snapshot. All future sandboxes forked from that snapshot
start pre-authorized.

### `fork` — Create a new sandbox from a snapshot

```bash
python cli.py fork SNAPSHOT_LABEL_OR_ID [--name NAME]
```

Alias for `create --from-snapshot`. This is the fast path — the primary
day-to-day command once you have a good snapshot.

### `list` — Show sandboxes and snapshots

```bash
python cli.py list [--sandboxes] [--snapshots]
```

- Lists running sandboxes with IDs, names, and status
- Lists saved snapshots with labels and IDs

### `destroy` — Terminate a sandbox

```bash
python cli.py destroy SANDBOX_ID
```

- Calls `sb.terminate()` on the sandbox

## Snapshot Workflow (The Main Trick)

This is the key to fast iteration:

1. **Bootstrap once**:
   ```bash
   python cli.py create --name base-setup
   python cli.py shell <sandbox-id>
   # Inside the sandbox:
   #   - Run `claude` and complete the OAuth/auth flow
   #   - `npx playwright install` (install browsers)
   #   - Clone your target repo(s)
   #   - Any other one-time setup
   #   exit
   python cli.py snapshot <sandbox-id> --label golden
   ```

2. **Daily use** — fork from the golden snapshot:
   ```bash
   python cli.py fork golden --name issue-123
   python cli.py shell <new-sandbox-id>
   # Claude is already authorized, deps installed, repo cloned
   # Just start working
   ```

3. **Re-snapshot** as needed when the golden image gets stale (new deps, etc.)

## State File

`~/.modal-thopters/state.json`:
```json
{
  "app_name": "modal-thopters",
  "snapshots": {
    "golden": "im-abc123...",
    "with-playwright": "im-def456..."
  },
  "sandboxes": {
    "my-sandbox": "sb-xyz789..."
  }
}
```

## Configuration

### Modal App

Uses `modal.App.lookup("modal-thopters", create_if_missing=True)` — no
deployment needed, runs as ephemeral scripts.

### Sandbox Defaults

| Setting | Value | Rationale |
|---|---|---|
| `timeout` | 24 hours | Max allowed; for long Claude sessions |
| `idle_timeout` | 1 hour | Auto-cleanup forgotten sandboxes |
| `cpu` | 4 cores | Reasonable for Claude Code + builds |
| `memory` | 8192 MB | Enough for Node, Playwright, builds |
| `workdir` | `/root` | Simplicity |

## File Layout

```
modal-thopters/
├── SPEC.md           # this file
├── cli.py            # CLI entrypoint (click or argparse)
├── sandbox.py        # Sandbox creation/management logic
├── image.py          # Image definition (the base image builder)
├── config.py         # Constants, defaults, state file management
├── pyproject.toml    # existing, add click dependency
├── llms-full.txt     # Modal docs reference (53k lines)
└── README.md         # usage examples
```

## What We're NOT Doing (yet)

- No hub/dashboard — just CLI
- No GitHub issue polling — manual sandbox creation
- No tmux/gotty web terminal — use `cli.py shell` for interactive access
- No egress firewall — Modal's `block_network` / `cidr_allowlist` available
  if needed later
- No status observer or session log HTML
- No PM2 process management
- No automatic Claude Code launch — user launches it manually in shell
- No multi-repo orchestration

## llms-full.txt Table of Contents

The Modal documentation reference file is 53,779 lines. A full auto-generated
TOC is at `llms-toc.txt` (run `uv run python gen-toc.py` to regenerate).

Key sections for this project:

| Line | Section |
|---|---|
| 2848 | **Sandboxes overview** |
| 2967 | Sandbox lifecycle & timeouts |
| 3015 | Sandbox configuration |
| 3065 | Environment variables in sandboxes |
| 3116 | Custom images for sandboxes |
| 3319 | Named sandboxes |
| 3529 | **Running commands in sandboxes** |
| 3681 | Networking and security |
| 3806 | Filesystem access |
| 3986 | **Snapshots overview** |
| 4005 | Filesystem snapshots |
| 4076 | Memory snapshots (Alpha) |
| 4160 | Persisting sandbox state |
| 4429 | Secrets |
