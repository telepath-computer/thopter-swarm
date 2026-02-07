# Thopters: Cloud Dev Environments for Claude Code Agents

## Vision

```
$ thopter run "add blinking lights to the dashboard"

thopter abc123 now working on it.
  attach:  thopter attach abc123
  tail:    thopter tail abc123

$ thopter tail abc123
[14:32:01] Looking at the dashboard component...
[14:32:15] I'll add CSS animations for the status indicators...
[14:32:44] Writing src/components/StatusLight.tsx...
```

One command dispatches a Claude Code agent to a cloud VM. The agent runs
autonomously in a tmux session. You can attach to watch it work, tail its
messages, send it follow-up instructions, or just let it finish and get
notified. The VM persists — pause it tonight, resume it tomorrow, everything
is exactly where you left it.

## Core Concepts

**Thopter** — a cloud VM running Claude Code in a tmux session, preconfigured
with your API keys, git credentials, and repo. The VM is managed by a cloud
provider (Sprites, Modal, etc.) but the CLI and agent runtime are
provider-agnostic.

**Pool** — a set of pre-provisioned, idle thopters ready for instant
acquisition. When you `thopter run`, it grabs one from the pool (fast) rather
than creating from scratch (slower).

**Agent runtime** — a thin layer of Claude Code hooks and a state file inside
each thopter that enables monitoring, messaging, and notifications from the
outside without attaching to the tmux session.

**Provider** — the cloud VM backend (Sprites, Modal, etc.). Providers
implement a common interface for VM lifecycle (create, pause, resume, destroy,
exec, etc.) and the CLI dispatches to whichever provider is configured.

---

## CLI Commands

The CLI is invoked as `thopter <command>`. Installed via pip/pipx as a single
package.

### Dispatching Work

#### `thopter run "<prompt>" [--profile X] [--name NAME] [--thopter ID]`

The primary command. Dispatches a Claude Code agent with the given prompt.

1. Acquires a thopter: uses `--thopter ID` if specified, otherwise grabs an
   idle one from the pool, otherwise creates a new one
2. Starts Claude Code in a tmux session with `--dangerously-skip-permissions`
   and the given prompt as the initial message
3. The agent runtime hooks are active (see Agent Runtime below)
4. Returns the thopter ID and commands to interact with it

`--profile` selects a named configuration profile (repo, branch, deps, prompt
template). See Configuration.

#### `thopter restart [ID] [--prompt "<new prompt>"]`

Kills the current Claude Code process and re-launches. With `--prompt`,
starts a new task. Without it, re-runs the original prompt.

### Connecting

#### `thopter attach [ID] [--cc]`

Attaches to the tmux session where Claude Code is running.

- Default: `tmux attach-session` over SSH — standard terminal, works
  everywhere
- `--cc`: Uses `tmux -CC` mode for iTerm2 integration — native scrollback,
  copy/paste, no tmux chrome. Requires iTerm2.
- Detach with `Ctrl-B D` (standard) or just close the tab (`-CC` mode)
- The thopter keeps running after detach

#### `thopter console [ID]`

Opens a new shell session on the thopter (not the Claude tmux session). For
poking around the filesystem, running commands, debugging.

#### `thopter tail [ID] [--follow] [--lines N]`

Streams Claude's recent text messages without attaching. Reads the transcript
JSONL file on the thopter, extracts assistant text blocks, and prints them
with timestamps.

- `--follow` / `-f`: Continuous tail, prints new messages as they appear
- `--lines N`: Show last N messages (default: 20)
- Does not show tool call details — just the prose Claude writes

Implementation: reads
`~/.claude/projects/<project>/<session>.jsonl` on the thopter, filters for
`type: "assistant"` entries, extracts `content` blocks where
`type: "text"`.

### Lifecycle

#### `thopter list`

Shows all thopters with status.

```
ID        Name          Status    Agent       Prompt                         Updated
────────  ────────────  ────────  ──────────  ─────────────────────────────  ────────────
abc123    dev-main      working   claude      "add blinking lights to th…"   2 min ago
def456    issue-42      hitl      claude      "fix the auth bug in…"         5 min ago
ghi789    experiment    idle      —           —                              3 hours ago
jkl012    staging       paused    —           —                              2 days ago
```

- **Status**: `working` (agent active), `hitl` (waiting for human input),
  `idle` (agent finished, VM running), `paused` (VM hibernated/stopped)
- Agent status comes from cached metadata; VM status from the provider API
- Only wakes running VMs for metadata refresh, never hibernated ones
  (see Metadata section)

#### `thopter pause [ID]`

Stops the Claude Code process (if running) and tells the provider to
hibernate/pause the VM. Filesystem is preserved.

#### `thopter resume [ID]`

Wakes a paused thopter. Does not restart Claude — just makes the VM available
for `attach`, `console`, `exec`, or a new `run`.

#### `thopter kill [ID]`

Kills the Claude Code process but keeps the VM running. The thopter goes to
`idle` status and is available for another `run`.

#### `thopter destroy [ID] [--yes]`

Permanently deletes the thopter and all its data. Requires confirmation
unless `--yes` is passed.

### Communication

#### `thopter tell [ID] "<message>" [--interrupt]`

Sends a message to the running Claude Code agent.

- Default (polite): waits until Claude is idle (between turns), then injects
  the message via `tmux send-keys`
- `--interrupt`: sends immediately, even if Claude is mid-response. Injects
  `Ctrl-C` first to stop the current generation, then sends the message
- The message appears in Claude's conversation as if the user typed it

#### `thopter ask [ID] "<question>"`

Like `tell`, but waits for Claude's response and prints it locally.

1. Injects the question via `tmux send-keys`
2. Monitors the transcript for the next assistant text response (via `Stop`
   hook or transcript polling)
3. Prints the response and exits

#### `thopter notify [ID] [--on hitl,done,error] [--cmd "<command>"]`

Watches for events on a thopter and fires notifications.

- `--on`: event types to watch (default: `hitl,done`)
- `--cmd`: custom command to run on event (receives event JSON on stdin)
- Default notification: macOS notification via `osascript` / `terminal-notifier`
- Runs in foreground; `Ctrl-C` to stop watching

### Filesystem

#### `thopter mount [ID] [--local PATH] [--remote PATH]`

Bidirectional file sync between local and remote using Mutagen.

```bash
thopter mount abc123                              # ~/thopter-abc123 ↔ /home/sprite/workspace
thopter mount abc123 --local ./my-project         # ./my-project ↔ /home/sprite/workspace
thopter mount abc123 --remote /home/sprite/repos  # default local ↔ custom remote
```

- Creates a Mutagen sync session over SSH
- Bidirectional with `two-way-safe` mode (conflicts flagged, not silently lost)
- Ignores `.git`, `node_modules`, build artifacts by default
- Near-real-time sync (sub-second for small edits)
- Survives network interruptions
- No FUSE/kernel extensions required on macOS

#### `thopter mount [ID] --stop`

Tears down the Mutagen sync session.

#### `thopter mount --list`

Shows active Mutagen sync sessions and their status.

### Snapshots

#### `thopter snapshot [ID] [--comment "COMMENT"]`

Saves a checkpoint/snapshot of the thopter's filesystem. Provider-specific
semantics (see provider sections).

#### `thopter restore [ID] [CHECKPOINT]`

Restores a thopter to a previous snapshot. Lists available snapshots if no
checkpoint specified.

### Configuration

#### `thopter configure environment`

Interactive setup for secrets and environment:
- API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_PAT)
- Git identity (user, email)
- Default repo URL and branch
- Additional environment variables

#### `thopter configure user`

Set your identity for thopter metadata (owner name, notification preferences).

#### `thopter configure security`

Manage egress firewall rules (provider-dependent). Allowlist domains, block
everything else.

#### `thopter configure profiles`

Manage named profiles. A profile bundles: repo URL, branch, dependencies
to pre-install, prompt template, resource settings. Used with
`thopter run --profile X`.

### Context

#### `thopter use [ID]`

Sets a default thopter so you don't have to specify the ID on every command.
Like `kubectl config use-context`.

```bash
thopter use abc123
thopter tail          # implicitly targets abc123
thopter attach        # implicitly targets abc123
thopter tell "also fix the tests"
```

`thopter use --clear` unsets the default.

#### `thopter describe [ID] [--set "DESCRIPTION"]`

View or set a human-readable description of what a thopter is being used for.
Stored in the thopter's metadata file.

```bash
thopter describe abc123 --set "working on dashboard animations for issue #42"
thopter describe abc123
# → working on dashboard animations for issue #42
```

### Utility

#### `thopter proxy [ID] <ports...>`

Port forwarding from thopter to localhost.

```bash
thopter proxy abc123 8080          # remote 8080 → local 8080
thopter proxy abc123 3001:3000     # remote 3000 → local 3001
```

#### `thopter exec [ID] -- <command...>`

Run a one-off command on the thopter and stream output.

#### `thopter enable-gotty [ID]`

Starts a gotty web terminal server on the thopter, prints the URL. For
sharing access with someone who doesn't have CLI/SSH set up.

---

## Agent Runtime

The agent runtime is what runs inside each thopter to manage the Claude Code
session and enable external monitoring/control. It consists of:

1. **Claude Code hooks** (`.claude/settings.json` on the thopter)
2. **A state file** (`.thopter/state.json`)
3. **A message log** (`.thopter/messages.jsonl`)
4. **A tmux session** with Claude Code running in it

### Claude Code Hooks

Hooks are configured in the thopter's `.claude/settings.json` at the project
level. They fire shell scripts that update the state file and message log.

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "/opt/thopter/hooks/on-notification.sh" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "/opt/thopter/hooks/on-stop.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "/opt/thopter/hooks/on-tool-use.sh", "async": true }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "/opt/thopter/hooks/on-session-start.sh" }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{ "type": "command", "command": "/opt/thopter/hooks/on-session-end.sh" }]
      }
    ]
  }
}
```

#### Hook: `on-notification.sh`

Receives notification events on stdin. Key fields:
- `notification_type`: `"permission_prompt"`, `"idle_prompt"`,
  `"elicitation_dialog"`

When `notification_type` is `permission_prompt` or `idle_prompt`:
- Updates state file status to `hitl`
- Writes event to `.thopter/events.jsonl`

#### Hook: `on-stop.sh`

Fires when Claude finishes a response turn. This hook:
- Reads the transcript JSONL (path provided in `transcript_path` field)
- Extracts the latest assistant text message(s)
- Appends them to `.thopter/messages.jsonl` with timestamp
- Updates state file: `status: "idle"` if `stop_hook_active` is false

The transcript JSONL format (one JSON object per line):
```json
{"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Here's what I did..."}, {"type": "tool_use", ...}]}}
```

We extract only `content` blocks where `type: "text"` — the actual prose.

#### Hook: `on-tool-use.sh` (async)

Runs after each tool call. Updates state file with last activity timestamp
and a summary of what tool was used. Runs async so it doesn't slow down
Claude.

#### Hook: `on-session-start.sh`

Updates state to `working`, records session start time.

#### Hook: `on-session-end.sh`

Updates state to `idle`, records session end.

### State File

`.thopter/state.json` — the canonical state of the thopter, read by the CLI
for `list` and other status commands.

```json
{
  "status": "working",
  "prompt": "add blinking lights to the dashboard",
  "owner": "jwhiting",
  "description": "dashboard animations for issue #42",
  "session_id": "2d868f7f-...",
  "transcript_path": "/home/sprite/.claude/projects/.../session.jsonl",
  "started_at": "2026-02-06T21:19:58Z",
  "last_activity": "2026-02-06T21:32:44Z",
  "last_tool": "Write",
  "profile": "default"
}
```

### Message Log

`.thopter/messages.jsonl` — extracted assistant text messages, one per line.
Written by the `on-stop.sh` hook. This is what `thopter tail` reads.

```jsonl
{"ts": "2026-02-06T21:32:01Z", "text": "Looking at the dashboard component..."}
{"ts": "2026-02-06T21:32:15Z", "text": "I'll add CSS animations for the status indicators..."}
{"ts": "2026-02-06T21:32:44Z", "text": "Writing src/components/StatusLight.tsx..."}
```

### Thopter Bootstrap Script

When `thopter run` dispatches work to a thopter, it:

1. Ensures the hooks directory and scripts are present at `/opt/thopter/hooks/`
2. Ensures `.claude/settings.json` has the hook configuration
3. Creates/updates `.thopter/state.json` with the prompt, owner, profile
4. Starts Claude Code in tmux:
   ```bash
   tmux new-session -d -s claude \
     "claude --dangerously-skip-permissions -p '${PROMPT}'"
   ```

The hooks and bootstrap scripts are version-controlled in this repo and
deployed to thopters during provisioning or on first `run`.

### Idle Monitor Daemon

A lightweight daemon (`thopter-idle-monitor`) runs as a system service on
each thopter. It watches for activity and auto-pauses the VM after a
configurable idle timeout. This replaces provider-level idle detection (which
is either too aggressive, like Sprites' fixed 30-second hibernation, or
nonexistent, like Morph's TTL-only model).

**Activity signals** — any one resets the idle timer:
- Claude Code transcript JSONL file modified (agent is working)
- tmux clients attached (someone is watching)
- SSH sessions active (someone is connected)
- Activity marker file touched by CLI commands (`thopter exec`, `tell`, etc.
  touch a well-known file before their main operation)

**Behavior:**
- On startup (including after resume), the daemon sets last-activity to now
  and enters a grace period (default: 2 minutes) during which it will not
  consider pausing. This prevents the daemon from immediately re-pausing
  after a resume by seeing stale timestamps.
- After the grace period, the daemon checks activity signals every 30 seconds.
- If no activity signal has fired for longer than the idle timeout (default:
  10 minutes), the daemon tells the provider to pause the VM (e.g.
  `morphcloud instance pause $INSTANCE_ID`). This kills all processes
  including the daemon itself.
- On next resume, the system service restarts the daemon, grace period begins
  again, and the cycle continues.

**Configuration** (on the thopter at `/opt/thopter/idle-monitor.conf`):
- `idle_timeout`: seconds of inactivity before self-pause (default: 600)
- `grace_period`: seconds after startup before monitoring begins (default: 120)

**CLI integration**: every CLI command that touches a thopter (`attach`,
`exec`, `tell`, `tail`, `mount`, etc.) does a quick
`touch /tmp/thopter-activity` via exec before its main operation. This is
the mechanism by which user interaction cancels the idle timer.

The daemon is provider-agnostic — it calls the appropriate provider's pause
command, which is written to a config file during provisioning.

---

## Metadata & the List Cache

Thopters store metadata on their filesystem (`.thopter/state.json`). The CLI
caches this locally for fast `list` output.

### Cache Strategy

1. **`thopter list`** (default) — reads provider API for VM status (never
   wakes hibernated VMs) + local metadata cache. Instant.
2. **`thopter list --refresh`** — also reads `.thopter/state.json` from
   running VMs via provider exec/filesystem API. Updates local cache. Skips
   hibernated VMs.
3. **`thopter list --refresh --all`** — wakes ALL VMs and refreshes metadata.
   Expensive, for when you need ground truth.

### Cache File

`~/.config/thopter/cache.json`:
```json
{
  "thopters": {
    "abc123": {
      "name": "dev-main",
      "description": "dashboard animations for issue #42",
      "owner": "jwhiting",
      "prompt": "add blinking lights to the dashboard",
      "agent_status": "working",
      "last_refreshed": "2026-02-06T21:35:00Z"
    }
  }
}
```

The cache is updated whenever the CLI interacts with a thopter (run, attach,
tail, etc.) — any command that touches a thopter refreshes its cached metadata
as a side effect.

---

## Filesystem Mounting

Uses [Mutagen](https://mutagen.io/) for bidirectional file sync over SSH.

### Why Mutagen

- No kernel extensions (unlike sshfs which needs macFUSE + Reduced Security
  on Apple Silicon Macs)
- Auto-deploys agent binary to remote via SCP — nothing to install on thopter
- Bidirectional with conflict detection (`two-way-safe` mode)
- Sub-second propagation for small edits
- Survives network disconnects, queues and syncs on reconnect
- `brew install mutagen-io/mutagen/mutagen`

### Prerequisites

- SSH access to the thopter (see provider sections for SSH setup)
- Mutagen installed locally

### Default Ignore Patterns

```
.git
node_modules
__pycache__
.venv
*.pyc
dist
build
.next
```

Configurable via `thopter configure profiles` or `~/.config/thopter/mutagen-ignore`.

---

## SSH

SSH is the transport layer for `attach`, `console`, `mount`, and `proxy`.
Each provider handles SSH setup differently (see provider sections), but the
thopter CLI abstracts this away — you never need to manage SSH config
manually.

The CLI maintains SSH config entries in `~/.ssh/config.d/thopter` (or
appends to `~/.ssh/config`) so that `ssh thopter-abc123` works, which in
turn makes Mutagen, scp, and other SSH-based tools work transparently.

### tmux -CC (iTerm2 Integration)

For `thopter attach --cc`, the CLI runs:
```bash
ssh -t thopter-abc123 tmux -CC attach-session -t claude
```

This gives iTerm2 native tabs, scrollback, copy/paste — no tmux UI chrome.
Requires iTerm2 on macOS. Falls back to regular tmux if not available.

---

## Notifications

`thopter notify` monitors a thopter for events and fires local notifications.

### Event Detection

The agent runtime hooks write events to `.thopter/events.jsonl`. The `notify`
command either:
- Polls the events file via provider exec/filesystem API, or
- Tails it over SSH

### Notification Methods

1. **macOS native** (default): `osascript -e 'display notification ...'`
2. **terminal-notifier**: richer macOS notifications with click actions
3. **Custom command**: `--cmd "curl -X POST https://slack.webhook/..."` —
   receives event JSON on stdin
4. **Terminal bell**: `--bell` — just ring the bell, useful in tmux

### Events

| Event | Meaning |
|---|---|
| `hitl` | Claude needs human input (permission prompt or question) |
| `done` | Claude finished responding and is idle |
| `error` | Claude session crashed or errored |
| `session_end` | Claude session terminated |

---

## Inter-Agent Communication

#### `thopter tell` / `thopter ask`

**Input** (sending messages to Claude): `tmux send-keys` over SSH.

```bash
# Polite mode: wait for idle, then type
ssh thopter-abc123 tmux send-keys -t claude "also fix the tests" Enter

# Interrupt mode: Ctrl-C first
ssh thopter-abc123 tmux send-keys -t claude C-c
ssh thopter-abc123 tmux send-keys -t claude "stop, also fix the tests" Enter
```

**Output** (reading Claude's response): the `Stop` hook writes the response
to `.thopter/messages.jsonl`. For `thopter ask`, the CLI:
1. Notes the current message count in messages.jsonl
2. Injects the question via tmux send-keys
3. Polls messages.jsonl until a new entry appears after the injection
4. Prints the new message(s) and exits

**Polite mode** detection: the CLI reads `.thopter/state.json` — if status is
`idle` (Claude is between turns), it's safe to send. If status is `working`,
polite mode waits until the next `idle` transition.

---

## Configuration

### Config Directory

`~/.config/thopter/` contains:

```
~/.config/thopter/
├── config.toml          # main configuration
├── cache.json           # metadata cache for list
├── profiles/
│   ├── default.toml     # default profile
│   └── my-project.toml  # named profiles
└── mutagen-ignore       # default mutagen ignore patterns
```

### config.toml

```toml
[provider]
type = "sprites"                    # or "modal"

[secrets]
ANTHROPIC_API_KEY = "sk-ant-..."
OPENAI_API_KEY = "sk-..."
GITHUB_PAT = "ghp_..."

[git]
user = "ThopterBot"
email = "thopterbot@telepath.computer"

[user]
name = "jwhiting"
notify = "macos"                    # macos | terminal-notifier | bell | none

[pool]
min_idle = 2                        # keep 2 idle thopters ready
max_total = 10                      # never exceed 10 total

[defaults]
profile = "default"
```

### Profile Files

```toml
# profiles/my-project.toml
[repo]
url = "https://github.com/myorg/myproject"
branch = "main"

[environment]
NODE_ENV = "development"
DATABASE_URL = "postgres://..."

[resources]
cpu = 4
memory = 8192                       # MB

[security]
egress_allowlist = [
    "github.com",
    "registry.npmjs.org",
    "pypi.org",
]
```

---

## Project Layout

```
thopters/
├── new-thopters-spec.md      # this file
├── src/
│   ├── cli.py                # CLI entrypoint (argparse or click)
│   ├── commands/              # one module per command group
│   │   ├── run.py
│   │   ├── connect.py        # attach, console, tail
│   │   ├── lifecycle.py      # list, pause, resume, kill, destroy
│   │   ├── communicate.py    # tell, ask, notify
│   │   ├── filesystem.py     # mount, snapshot, restore
│   │   └── configure.py      # configure, use, describe
│   ├── providers/
│   │   ├── base.py           # abstract provider interface
│   │   ├── sprites.py        # Fly Sprites implementation
│   │   └── modal.py          # Modal implementation
│   ├── agent/
│   │   ├── bootstrap.sh      # thopter init/provisioning script
│   │   ├── hooks/            # Claude Code hook scripts
│   │   │   ├── on-notification.sh
│   │   │   ├── on-stop.sh
│   │   │   ├── on-tool-use.sh
│   │   │   ├── on-session-start.sh
│   │   │   └── on-session-end.sh
│   │   └── claude-settings.json  # hook configuration template
│   ├── config.py             # config/profile management
│   ├── cache.py              # metadata cache
│   ├── ssh.py                # SSH config management
│   └── mutagen.py            # Mutagen sync session management
├── pyproject.toml
└── README.md
```

---

## Provider Interface

Each provider implements:

```python
class Provider(ABC):
    # Lifecycle
    def create(self, name: str, config: ResourceConfig) -> str: ...
    def destroy(self, id: str) -> None: ...
    def pause(self, id: str) -> None: ...
    def resume(self, id: str) -> None: ...

    # Execution
    def exec(self, id: str, command: list[str], timeout: int) -> ExecResult: ...
    def shell(self, id: str) -> None: ...  # interactive, takes over terminal

    # State
    def list(self) -> list[ThopterInfo]: ...  # id, name, provider_status
    def status(self, id: str) -> ThopterInfo: ...

    # Files
    def read_file(self, id: str, path: str) -> bytes: ...
    def write_file(self, id: str, path: str, content: bytes) -> None: ...

    # SSH
    def ssh_config(self, id: str) -> SSHConfig: ...  # host, port, user, key
    def ensure_ssh(self, id: str) -> None: ...  # provision SSH if needed

    # Snapshots
    def snapshot(self, id: str, comment: str) -> str: ...
    def restore(self, id: str, snapshot_id: str) -> None: ...
    def list_snapshots(self, id: str) -> list[SnapshotInfo]: ...

    # Networking
    def proxy(self, id: str, port_mappings: list[PortMapping]) -> None: ...
    def set_egress_policy(self, id: str, rules: list[EgressRule]) -> None: ...

    # Provider-specific
    def init_environment(self, id: str, secrets: dict, git_config: dict) -> None: ...
```

---

## Provider: Fly Sprites

### Overview

Sprites are Firecracker microVMs on Fly.io. They hibernate automatically when
idle (~30 seconds) and wake instantly on any API call.

| Property | Value |
|---|---|
| Max lifetime | Unlimited |
| Idle → hibernate | ~30 seconds |
| Wake time | 100-500ms (warm), 1-2s (cold) |
| Storage | 100GB persistent ext4 |
| Base image | Ubuntu 24.04, Node/Python/Go/Rust/Git/Claude CLI preinstalled |
| Isolation | Hardware-level (Firecracker microVM) |
| Cost when idle | Free |

### SDK & CLI

- Python SDK: `sprites-py` (via pip)
- CLI: `sprite` (via brew or curl)
- API base: `https://api.sprites.dev`
- Auth: Fly.io account via `sprite org auth`

### Lifecycle Mapping

| Thopter command | Sprites implementation |
|---|---|
| `create` | `client.create_sprite(name, config)` |
| `destroy` | `sprite.delete()` |
| `pause` | No explicit API; sprites auto-hibernate after ~30s idle. CLI confirms and informs user. |
| `resume` | `sprite.command("true").run()` — any exec wakes it |
| `list` | `client.list_sprites()` — returns status without waking |
| `exec` | `sprite.command(*args).run()` |
| `shell` | `sprite console <name>` CLI for PTY |

### SSH Setup

Sprites don't expose SSH by default. Provisioning script must:

1. Install openssh-server: `apt install -y openssh-server`
2. Configure sshd (allow key auth, set port)
3. Write authorized_keys from user's public key
4. Create a Sprites "service" for sshd so it survives hibernation:
   `sprite-env services create sshd --cmd /usr/sbin/sshd`
5. SSH access via `sprite proxy 2222:22` for tunneling, or if Sprites
   supports direct TCP, via the sprite's address

The CLI manages this transparently — `thopter create` provisions SSH as part
of init.

### Secrets Injection

No built-in secrets manager. The init script writes API keys to
`~/.bashrc` inside the sprite so they persist across hibernation. Written
during `create`, updateable via `thopter configure environment` (re-runs
the secrets portion of the init script).

### Snapshots

- `sprite.create_checkpoint(comment)` — checkpoint within the same sprite
- `sprite.restore_checkpoint(id)` — restore to a checkpoint
- `sprite.list_checkpoints()` — list available checkpoints
- Checkpoints are scoped to individual sprites (not transferable/clonable)

### Networking

- Public URL: `https://<name>.sprites.app` → port 8080 (toggleable
  public/private)
- Port forwarding: `sprite proxy <ports>` — TCP tunnel to localhost
- Egress firewall: `sprite.update_network_policy(policy)` with domain-level
  allow/deny rules

### Limitations

- No cloning (can't create a new sprite from another's filesystem)
- SSH requires manual setup during provisioning
- ~30s idle timeout before hibernation is not configurable
- Hibernation kills all running processes (including Claude Code) — agent
  must be re-launched after resume. Filesystem and installed packages persist.
- Public URL only routes to one port (8080)

### Hibernation Implications for Agent

When a sprite hibernates (after ~30s idle), all processes die. This means:
- Claude Code stops. The tmux session dies.
- `.thopter/state.json` persists (it's on disk)
- The transcript JSONL persists
- On `resume`, Claude Code must be re-launched if you want to continue work

This is fine for the "pause overnight, resume tomorrow" workflow. For active
agent work, the sprite stays awake because Claude Code is running (it counts
as activity). The 30s timeout only matters when Claude finishes and goes idle.

---

## Provider: Modal

### Overview

Modal provides container-based sandboxes with a powerful snapshotting system.
The tradeoff vs Sprites: 24-hour hard timeout, but excellent clone/fork
workflow.

| Property | Value |
|---|---|
| Max lifetime | 24 hours (hard limit) |
| Idle timeout | Configurable (default: 1 hour) |
| Storage | Ephemeral (lost when sandbox terminates) |
| Base image | Custom-built via Modal Image API |
| Isolation | Container |
| Clone/fork | Yes (snapshot → new sandbox) |
| Cost when idle | Per-second while sandbox exists |

### SDK & CLI

- Python SDK: `modal` (via pip)
- CLI: `modal` (via pip, same package)
- Auth: `modal setup`

### Lifecycle Mapping

| Thopter command | Modal implementation |
|---|---|
| `create` | `modal.Sandbox.create(image, name, secrets, ...)` |
| `destroy` | `sb.terminate()` |
| `pause` | Not supported directly. Snapshot + destroy, restore via fork. |
| `resume` | Fork from most recent snapshot. |
| `list` | `modal.Sandbox.list(app_id=...)` |
| `exec` | `sb.exec(*command, timeout=...)` |
| `shell` | `modal shell <sandbox-id>` CLI for PTY |

### Base Image

Must be custom-built since Modal uses slim Debian containers:

```python
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "vim", "tmux", "ripgrep", "build-essential", ...)
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
                  "apt-get install -y nodejs")
    .run_commands("npm install -g @anthropic-ai/claude-code")
    .run_commands("curl -LsSf https://astral.sh/uv/install.sh | sh")
    .env({"LANG": "en_US.UTF-8", "TERM": "xterm-256color", ...})
)
```

### Secrets Injection

Modal has built-in secrets: `modal.Secret.from_name("thopter-secrets")`.
Secrets are injected as environment variables at sandbox creation time.
Managed via `modal secret create` or the Modal dashboard.

### SSH Setup

Modal doesn't natively support SSH into sandboxes. Options:
1. Install and start sshd as part of the base image, expose a port via
   Modal's networking (if supported)
2. Use `modal shell` for interactive access (websocket-based, not real SSH)
3. For tmux -CC, may need a creative solution (pipe tmux -CC protocol over
   Modal's exec websocket)

This is Modal's biggest limitation for the attach/mount workflow.

### Snapshots

- `sb.snapshot_filesystem()` — capture filesystem as a Modal Image
- `modal.Image.from_id(image_id)` — use snapshot as base for new sandbox
- Snapshots are transferable — create a new sandbox from any snapshot
- This enables the "golden image" workflow: set up once, snapshot, fork many

### The Fork Workflow

Since Modal sandboxes expire after 24 hours and can't be paused:

1. Create sandbox, set everything up, snapshot → "golden image"
2. Daily: fork from golden → instant sandbox with everything pre-configured
3. When golden gets stale, create a new one and re-snapshot

`thopter pause` on Modal would: snapshot, record the image ID, destroy the
sandbox. `thopter resume` would: fork from that snapshot.

### Networking

- `block_network` / `cidr_allowlist` for egress control
- Limited port exposure compared to Sprites
- No public URLs by default

### Limitations

- 24-hour hard timeout — sandboxes die after 24 hours no matter what
- No true pause/resume — must snapshot + destroy + fork
- Idle timeout destroys the sandbox (configurable but can't be disabled)
- No SSH (websocket-based exec only) — limits tmux -CC and Mutagen
- Custom image build required (slower first-time setup)
- Pay for idle time (sandbox exists = billing)

---

## Provider: Morph Cloud

### Overview

Morph Cloud provides microVMs with Infinibranch — instant snapshotting,
branching, and restore in under 250ms. The standout capability is
`instance.branch()`: create N copies of a running instance with full process
state preserved, near-zero storage overhead. This is the best primitive for
the thopter pool model.

| Property | Value |
|---|---|
| Max lifetime | Unlimited (no TTL required) |
| Pause/resume | Native (`instance.pause()` / `instance.resume()`) |
| Resume latency | <250ms (claimed) |
| Storage | Configurable disk size (MB), persistent while instance exists |
| Base image | `morphvm-minimal` + snapshot chaining to build up |
| Isolation | MicroVM (likely Firecracker-based) |
| Clone/fork | Yes — `instance.branch(count=N)`, instant, preserves process state |
| Cost when idle | Usage-based; paused instances cost only storage |

### SDK & CLI

- Python SDK: `morphcloud` (via pip)
- CLI: `morphcloud` (via pip, same package)
- Auth: API key via `MORPH_API_KEY` env var, obtained at `cloud.morph.so/web/keys`

### Lifecycle Mapping

| Thopter command | Morph implementation |
|---|---|
| `create` | `client.instances.start(snapshot_id, ...)` from a base snapshot |
| `destroy` | `instance.stop()` |
| `pause` | `instance.pause()` |
| `resume` | `instance.resume()` |
| `list` | `client.instances.list(metadata={"thopter": "true"})` |
| `exec` | `instance.exec(command)` or `ssh.run(command)` |
| `shell` | `morphcloud instance ssh INSTANCE_ID` for PTY |

### SSH Setup

SSH is native and first-class. No manual sshd provisioning needed.

- `morphcloud instance ssh INSTANCE_ID` — interactive shell
- `morphcloud instance ssh INSTANCE_ID command` — one-off exec
- SSH key management built in: `GET /instance/{id}/ssh/key`
- Port tunneling: `ssh.tunnel(local_port, remote_port)` in SDK
- File copy: `ssh.copy_to()` / `ssh.copy_from()` in SDK
- CLI: `morphcloud instance port-forward INSTANCE_ID REMOTE [LOCAL]`
- CLI: `morphcloud instance copy SOURCE DEST [-r]`

This means tmux -CC, Mutagen, and all SSH-dependent features work out of the
box. No provider-specific workarounds needed.

### Secrets Injection

Morph has a secrets API (`/user/secret`). Secrets can be stored at the
account level and retrieved by instances. Additionally, environment variables
can be set during snapshot chaining or written to the filesystem during init.

### Snapshots & Branching

This is Morph's killer feature for thopters.

**Snapshot chaining** — build up environments incrementally:
```python
base = client.snapshots.create(image_id="morphvm-minimal", vcpus=4, memory=8192, disk_size=32768)
with_tools = base.exec("apt install -y nodejs npm && npm install -g @anthropic-ai/claude-code")
with_repo = with_tools.exec("git clone https://github.com/org/repo /home/user/repo")
golden = with_repo.exec("/opt/thopter/init.sh")  # configure git, API keys, hooks
```

Each step produces a new snapshot. Only the delta is stored.

**Branching** — stamp out workers from a running instance:
```python
instance = client.instances.start(snapshot_id=golden.id)
branches = instance.branch(count=5)  # 5 copies, instant, full process state
```

Each branch is an independent instance with its own filesystem, running
processes, and lifecycle. This enables the pool model: maintain one golden
instance, branch on demand when `thopter run` needs a worker.

**Checkpoint within an instance:**
```python
checkpoint = instance.snapshot()  # save current state
# ... do risky work ...
# To restore: stop instance, start new one from checkpoint
```

### Metadata

Morph has native key-value metadata on both instances and snapshots:
```python
instance.set_metadata(
    thopter="true",
    name="dev-main",
    owner="jwhiting",
    description="dashboard animations for issue #42",
    prompt="add blinking lights to the dashboard",
    agent_status="working"
)

# Queryable in list:
client.instances.list(metadata={"owner": "jwhiting"})
```

This solves the metadata/annotation problem natively — no local cache
needed for descriptions, ownership, or tagging. The `thopter list` command
can read metadata directly from the API without waking instances (metadata
is stored at the API level, not on the VM filesystem).

### Networking

- Public URLs: `instance.expose_http_service(name, port, auth_mode)`
  with `"none"` or `"api_key"` auth
- Port forwarding: `morphcloud instance port-forward INSTANCE_ID REMOTE LOCAL`
- SDK tunneling: `ssh.tunnel(local_port, remote_port)`

### Idle Management

Morph has no automatic idle detection. Instances run until explicitly paused
or stopped (or until an optional TTL expires). This is handled by the
thopter idle monitor daemon (see Agent Runtime), which monitors activity
signals and calls `morphcloud instance pause` when the thopter has been
idle for a configurable timeout.

Optional TTL can be set as a safety net:
```python
client.instances.start(
    snapshot_id=golden.id,
    ttl_seconds=86400,       # 24 hour hard cap as safety valve
    ttl_action="pause"       # pause, don't destroy
)
```

### Limitations

- **No egress firewall** — no documented network policy API. Would need to
  implement iptables-based firewall in the init script (like existing
  thopter-swarm's `firewall.sh`). This is a significant security gap for
  yolo-mode agents.
- **Base image is minimal** — `morphvm-minimal` likely needs substantial
  setup. But snapshot chaining makes this a one-time cost, and the golden
  snapshot pattern means subsequent instances start fully configured.
- **Newer platform** — less battle-tested than Modal or Fly.io. Stability
  and support maturity are unknowns.
- **Pricing unclear** — only browser product pricing is public ($0.07/hr).
  VM instance pricing not documented.
- **Wake-on-request** — mentioned in docs but not detailed. If paused
  instances auto-resume on API calls (like Sprites), the pool workflow is
  smoother. Needs testing.
- **Process survival through pause** — unclear if `instance.pause()` +
  `instance.resume()` preserves running processes (like VM suspend) or
  kills them (like Sprites' hibernation). Critical for the agent workflow.
  If processes die on pause, Claude must be re-launched on resume.

---

## Provider: Runloop

### Overview

Runloop provides microVM-based "devboxes" purpose-built for AI coding agents.
It has the most comprehensive operational feature set of any provider
evaluated: built-in egress firewall, encrypted secrets, async exec with SSE
streaming, keep-alive API, blueprint templates, and log tailing. The runtime
is KVM-based microVMs (not containers), despite using Dockerfiles as the build
format for blueprints.

| Property | Value |
|---|---|
| Max lifetime | Unlimited (TTL optional) |
| Pause/resume | Native (`suspend` / `resume`). Disk state preserved, processes do not survive. |
| Resume latency | Not documented |
| Storage | Persistent disk, configurable size via blueprints |
| Base image | Custom via Dockerfiles in blueprint system, or repo inspection |
| Isolation | MicroVM (KVM-based, hardware-level) |
| Clone/fork | Via snapshots (snapshot → new devbox). Not instant like Morph's branch. |
| Cost when idle | Suspended devboxes: storage only (disk persists during suspend) |

### SDK & CLI

- Python SDK: `runloop_api_client` (via pip)
- CLI: `rl-cli` (mentioned in docs for debugging via SSH)
- Auth: API key via `RUNLOOP_API_KEY` env var, obtained from dashboard

### Lifecycle Mapping

| Thopter command | Runloop implementation |
|---|---|
| `create` | `client.devboxes.create(blueprint_id=..., metadata=...)` |
| `destroy` | `devbox.shutdown()` (permanent) |
| `pause` | `POST /v1/devboxes/{id}/suspend` |
| `resume` | `POST /v1/devboxes/{id}/resume` |
| `list` | `client.devboxes.list(metadata=...)` |
| `exec` | `devbox.execute_async(command)` with SSE streaming |
| `shell` | Via SSH (see below) or dashboard |

### SSH Setup

SSH access exists but the documentation is notably thin on how it actually
works in practice.

**What the API provides:**
- `POST /v1/devboxes/{id}/create_ssh_key` returns:
  - `url` — "The host url of the Devbox that can be used for SSH"
  - `ssh_private_key` — PEM format private key
  - `ssh_user` — Linux user for SSH connections
- The `rl-cli` tool is described as enabling "debugging via SSH"
- Docs mention "SSH sharing without API keys" and "reverse SSH tunneling"
  as available features

**What's unclear:**
- Whether `url` is a direct hostname:port or goes through tunnel
  infrastructure
- No quickstart or guide shows an actual `ssh -i key user@host` command
- The Python SDK doesn't document SSH methods in its README
- No documented examples of SSH-based port forwarding or tmux attach

**Assessment:** The API surface for SSH is there (key generation, URL, user),
but the "how do I actually get a terminal over SSH" story has documentation
gaps. The tunnel system (`https://{port}-{tunnel_key}.tunnel.runloop.ai`)
may be the actual transport, with SSH tunneled through it. Needs hands-on
testing before relying on it for tmux -CC and Mutagen.

### Secrets Management

Best-in-class. First-class encrypted secrets auto-injected as env vars:

```
POST /v1/secrets          — create (encrypted at rest)
GET  /v1/secrets          — list (values excluded)
POST /v1/secrets/{name}   — update
POST /v1/secrets/{name}/delete
```

Secrets are globally unique by name and automatically available in all
devboxes. No manual `.bashrc` injection, no provider-specific secret
objects — just create a secret and it appears as an env var everywhere.

### Egress Firewall (Network Policies)

Best-in-class. Full CRUD API for network policies with egress rules:

```
POST /v1/network-policies            — create policy with egress rules
GET  /v1/network-policies            — list all policies
GET  /v1/network-policies/{id}       — get policy
POST /v1/network-policies/{id}       — update policy
POST /v1/network-policies/{id}/delete
```

Policies can be applied to blueprints, devboxes, or snapshot resumes. This
is the critical security feature for yolo-mode Claude Code agents — lock
down egress to only GitHub, npm, PyPI, and the Anthropic API. Morph has no
equivalent. Sprites has a network policy API but less documented.

### Exec API

Most comprehensive of any provider:

- **Async execution**: `POST /v1/devboxes/{id}/execute_async` — returns
  execution ID for tracking
- **Stdin support**: `POST /v1/devboxes/{id}/executions/{eid}/send_std_in`
- **SSE streaming**: `GET /v1/devboxes/{id}/executions/{eid}/stream_stdout_updates`
  and `stream_stderr_updates` — real-time output via Server-Sent Events
- **Status polling**: `POST /v1/devboxes/{id}/executions/{eid}/wait_for_status`
  (max 25s timeout)
- **Process kill**: `POST /v1/devboxes/{id}/executions/{eid}/kill` — kill
  individual process or entire process group
- **Execution tracking**: each execution gets an ID, queryable status

### Blueprints

Template system for golden images:

- Custom Dockerfiles (Docker is the build tool, microVM is the runtime)
- Repo inspection: auto-discovers deps, build commands, project structure
  from a GitHub repo and generates a blueprint
- Composable: layer blueprints
- Public blueprints available
- Dockerfile preview: test locally before building

### Idle Management

Devboxes can be configured to "shutdown on idle" with an explicit keep-alive
API:

```
POST /v1/devboxes/{id}/keep_alive    — reset idle timer
```

This integrates well with the idle monitor daemon: the daemon can call
keep-alive to prevent provider-level idle shutdown while using its own
activity detection logic to decide when to self-pause. Alternatively, set
the provider idle timeout high and let the daemon handle everything.

### Snapshots

- Sync: `POST /v1/devboxes/{id}/snapshot_disk` — blocks until complete
- Async: `POST /v1/devboxes/{id}/snapshot_disk_async` — returns immediately,
  poll for status
- Named snapshots with metadata, queryable via list
- Launch new devbox from any snapshot
- Public snapshots for sharing

### Metadata

Native key-value metadata on devboxes, snapshots, and blueprints:
- `POST /v1/devboxes/{id}` — update metadata
- `GET /v1/devboxes/metadata/keys` — enumerate all keys in use
- `GET /v1/devboxes/metadata/keys/{key}/values` — enumerate values for a key
- Filterable in list operations

Solves the annotation/description problem natively.

### Networking

- **Tunnels**: `https://{port}-{tunnel_key}.tunnel.runloop.ai` — encrypted
  per-port URLs, one tunnel per devbox, supports HTTP, WebSocket, and SSE.
  Auth modes: open or API key bearer token.
- **Tunnels survive suspend/resume** — config persists
- **Services must bind to 0.0.0.0** (not localhost) to be accessible

### Additional Features

- **Log tailing**: `GET /v1/devboxes/{id}/logs/tail` — built-in SSE
  streaming of devbox logs. Could supplement transcript-based `thopter tail`.
- **Resource monitoring**: `GET /v1/devboxes/{id}/usage` — CPU, memory, disk
  metrics excluding suspended periods
- **File API**: read/write text files, upload/download binaries (>100MB
  supported)
- **Docker-in-Docker**: works because it's a real VM, not a container
- **Architecture options**: x86_64 (default) or arm64
- **Deploy to VPC**: run Runloop infra in your own AWS (enterprise)
- **Benchmarking framework**: scenarios and scoring for agent evaluation

### Limitations

- **SSH documentation gaps** — the API for SSH keys exists but practical
  connection workflow is poorly documented. This is critical for tmux -CC
  and Mutagen. Needs hands-on testing.
- **No instant branching** — must snapshot → create new devbox. Slower than
  Morph's `instance.branch()` and doesn't preserve process state. For the
  pool model, you'd pre-provision from snapshots.
- **Processes don't survive suspend** — same as Sprites. Claude must be
  re-launched after resume.
- **Resume latency unknown** — not documented. Could be fast or slow.
- **Naming via metadata only** — no native name field.
- **Pricing not public** — not documented.
- **Blueprint build time** — custom Dockerfiles need to build, which takes
  time on first use (cached thereafter via snapshots).
- **Newer platform** — $7M seed, less battle-tested than Fly.io or Modal.

### Runloop vs Other Providers: Summary

Runloop has the most complete operational feature set. Its egress firewall,
secrets management, exec API, keep-alive, and log tailing are all best-in-
class. The KVM/microVM isolation puts it on par with Sprites. The main
things it lacks relative to competitors are Morph's instant branching and
clear SSH documentation. If the SSH story checks out in practice, Runloop
is a strong primary provider candidate.

---

## Implementation Phases

### Phase 0: SSH-Ready Thopter Provisioning
- Bootstrap script that creates a sprite/sandbox with SSH configured
- API keys injected, git configured, repo cloned
- Verify `ssh thopter-<name>` works
- Verify tmux session can be created and attached

### Phase 1: Core Loop
- `thopter run`, `attach`, `console`, `list`, `kill`, `destroy`
- Basic agent bootstrap (start Claude in tmux with prompt)
- State file written on run (no hooks yet — just initial state)
- Provider: pick one to start (Morph has best primitives; Sprites has
  simplest SSH story; evaluate both in Phase 0)

### Phase 2: Agent Runtime
- Claude Code hooks deployed to thopters
- `.thopter/messages.jsonl` populated by hooks
- `thopter tail` reads message log
- `thopter notify` polls state file
- State file updated in real-time (working/hitl/idle)

### Phase 3: Communication & Mounting
- `thopter tell`, `thopter ask` via tmux send-keys + message log
- `thopter mount` via Mutagen over SSH
- `thopter use` for default targeting
- `thopter describe` for metadata

### Phase 4: Pool Management
- Pre-provisioned pool of idle thopters
- `thopter run` acquires from pool
- Auto-replenishment when pool drops below minimum
- Profile-based provisioning (different pools per profile)

### Phase 5: Additional Providers
- Implement provider interface for Morph or Sprites (whichever wasn't Phase 1)
- Implement provider interface for Modal
- Handle Modal's snapshot-as-pause/fork-as-resume pattern
- Solve or work around Modal's SSH gap

### Phase 6: Git Proxy & GitHub App
- Controlled git access (thopters push through a proxy that enforces
  branch naming, prevents force-push, etc.)
- GitHub App for issue integration, PR creation, status updates
- Replace PAT-based auth with app-scoped tokens

---

## Open Questions

1. **Sprites SSH reliability**: Does sshd survive hibernation via Sprites
   services? How reliable is the `sprite proxy` TCP tunnel for sustained
   SSH connections?

2. **Sprites hibernation + running agents**: If Claude Code goes idle between
   turns for >30 seconds (e.g., waiting for a slow build), does the sprite
   hibernate and kill the process? May need a keepalive mechanism.

3. **Modal SSH**: Is there any way to get real SSH into a Modal sandbox? This
   is critical for tmux -CC and Mutagen. Without it, Modal's UX will be
   significantly worse than Sprites for interactive use.

4. **Mutagen over non-SSH transports**: Can Mutagen work over a custom
   transport (e.g., Modal's websocket exec)? There's a `--transport` flag
   but it may not be flexible enough.

5. **Agent state after hibernation**: When a sprite wakes up and Claude is no
   longer running, should `thopter attach` auto-detect this and offer to
   re-run? Or should it just show the dead tmux session?

6. **Pool sizing**: How many idle thopters should be kept warm? Depends on
   usage patterns and cost. Needs experimentation.

7. **Morph process survival**: Does `instance.pause()` + `instance.resume()`
   preserve running processes (true VM suspend/resume), or does it kill them
   like Sprites' hibernation? If processes survive, branching a running
   Claude Code session would be extraordinary — instant parallel agents all
   mid-task. If not, it's still excellent but requires re-launch on resume.

8. **Morph wake-on-request**: Do paused instances auto-resume when an API
   call targets them? This would make the pool model seamless — `thopter run`
   just branches or resumes without an explicit wake step.

9. **Morph egress control**: Is there an undocumented network policy feature,
   or do we need to roll our own iptables firewall? The existing
   thopter-swarm `firewall.sh` is a starting point.

10. **Morph pricing**: What do VM instances cost? Need to understand
    per-second compute + storage costs to evaluate pool economics.

11. **Morph base image contents**: What's actually on `morphvm-minimal`?
    Does it have Node, Python, Git, or do we need to install everything
    via snapshot chaining?

12. **Multi-user**: This spec assumes single-user. Multi-user (team sharing
    thopter pools) would need: shared config, access control, thopter
   ownership, conflict avoidance. Out of scope for now.
