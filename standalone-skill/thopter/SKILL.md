---
name: thopter
description: Provision a remote Linux host as a fully-configured "thopter" — an autonomous Claude Code dev environment that reports status to a Redis dashboard, fires ntfy.sh notifications, and runs Claude/Codex with HTTPS+PAT git credentials. Self-contained skill; carries its own runtime scripts and dotfiles. Works from any starting point with SSH access (DigitalOcean droplet, Hetzner box, bare metal, anything). Use when the user says "set up a new thopter", "thopterize this box", or hands you an IP and asks you to make it a thopter.
---

# Thopter skill

You are setting up a remote Linux machine to be a fully-functional **thopter**: a remote dev environment that runs Claude Code (and Codex) autonomously, reports status into Redis, fires `ntfy.sh` notifications, and is reachable from operator-side dashboards.

This skill is **self-contained**. Everything needed to provision a thopter — runtime scripts, dotfiles, hook handlers, the canonical CLAUDE.md — lives under `assets/` in this skill directory. You do not depend on any other repo.

## How to use this skill

Work the phases in order. Each phase has its own doc in `phases/`. **Read the phase doc when you reach it** — don't try to hold all eight in your head. After each phase, verify it succeeded before moving to the next; failures cascade and are much easier to diagnose at the boundary.

Most of the work is SSH'd into the target running shell commands and observing output. Use a single persistent SSH session where practical — it's faster than `ssh host -- cmd` per step, and lets you eyeball intermediate state.

## Phase order

1. **[Intake](#intake)** — gather inputs (this doc).
2. **[01-acquire-host](phases/01-acquire-host.md)** — get to "I have an IP and SSH access."
3. **[02-user-and-ssh](phases/02-user-and-ssh.md)** — ensure a `user` account with passwordless sudo and the operator's SSH key.
4. **[03-base-packages](phases/03-base-packages.md)** — apt installs (git, tmux, jq, redis-tools, gh, ripgrep, etc.).
5. **[04-runtimes](phases/04-runtimes.md)** — neovim, Node 22 via nvm, Claude Code, Codex, git-delta, starship.
6. **[05-dotfiles](phases/05-dotfiles.md)** — tmux/nvim/starship configs, CLAUDE.md, ~/.bashrc thopter block.
7. **[06-identity-and-creds](phases/06-identity-and-creds.md)** — hostname, `~/.thopter-env`, git credentials.
8. **[07-thopter-plumbing](phases/07-thopter-plumbing.md)** — install runtime scripts, register Claude hooks, install heartbeat cron.
9. **[08-verify](phases/08-verify.md)** — round-trip checks (redis ping, status line, hook firing).

---

## Intake

Before touching anything, collect inputs from the user. Try to ask in one batch — don't drip-feed.

### Step 1: Look for `~/.thopter.json`

If the operator has used the swarm CLI (or this skill) before, they may have a `~/.thopter.json` on their machine. Read it opportunistically:

```bash
test -f ~/.thopter.json && cat ~/.thopter.json
```

Schema (all optional):

```jsonc
{
  "envVars": {
    "GH_TOKEN": "...",
    "THOPTER_REDIS_URL": "rediss://...:port",
    "THOPTER_NTFY_CHANNEL": "...",
    "ANTHROPIC_API_KEY": "..."
  },
  "claudeMdPath": "/path/to/custom/CLAUDE.md",
  "uploads": [
    { "local": "/path/on/operator", "remote": "/home/user/foo" }
  ],
  "stopNotifications": true,
  "stopNotificationQuietPeriod": 3600
}
```

If present, pre-fill from it and **show the user** what was pulled in before continuing. Confirm + collect anything missing.

If absent, prompt the user directly. At the end, **offer to write a `~/.thopter.json`** so subsequent runs skip the prompts.

### Step 2: Required inputs

Whether from the file or direct prompts, you need:

| Input | Notes |
|-------|-------|
| **Thopter name** | Short kebab-case. Used for hostname + Redis keys. ≤48 chars, `[a-z0-9-]` only. |
| **Owner name** | From `git config --get user.name` on the operator's machine. Required. |
| **Starting point** | One of: `digitalocean` (run doctl), `existing-host-root` (IP + root SSH), `existing-host-user` (IP + non-root sudo user). |
| **Target IP / SSH details** | IP, SSH user, local private-key path. |
| **`GH_TOKEN`** | GitHub PAT. Required for thopter to clone/push. |
| **`THOPTER_REDIS_URL`** | `rediss://...` URL. Required — without it the dashboard is blind. |
| **`THOPTER_NTFY_CHANNEL`** | Optional. Enables ntfy.sh notifications from hooks. |
| **`claudeMdPath`** | Optional path to operator's preferred CLAUDE.md. Falls back to `assets/dotfiles/CLAUDE.md`. |
| **`uploads`** | Optional extra file copies. |

### Step 3: Notebook

Capture the resolved facts in a TaskCreate task list or a scratch note — you'll reference them throughout:

```
THOPTER_NAME=<name>
THOPTER_OWNER=<owner>
START=<digitalocean|existing-host-root|existing-host-user>
HOST_IP=<ip>
SSH_USER=<root|user|...>
SSH_KEY=<local private-key path>
ENV_VARS={GH_TOKEN, THOPTER_REDIS_URL, ...}
CLAUDE_MD=<path or "<skill>/assets/dotfiles/CLAUDE.md">
UPLOADS=[...]
SKILL_DIR=<path to this skill on operator's machine>
```

`SKILL_DIR` matters: phase docs reference `${SKILL_DIR}/assets/...` for scp commands. Resolve it once (the directory containing this `SKILL.md`) and reuse.

---

## Redis schema (runtime contract)

The runtime scripts in `assets/runtime/` define a contract with the dashboard. If you understand the keys, you can debug without diving into the scripts.

All keys are namespaced `thopter:${THOPTER_NAME}:*`. Most are short-TTL string keys written by `thopter-status`, the heartbeat, or the Claude hooks.

| Key | Writer | Meaning |
|-----|--------|---------|
| `thopter:<name>:status` | `thopter-status {running,waiting,done,inactive}` | High-level state: `running` / `waiting` / `done` / `inactive` |
| `thopter:<name>:status_line` | `thopter-status statusline "<msg>"` | One-line description of current goal |
| `thopter:<name>:notes` | `thopter-status log "<msg>"` | Appended log entries (LIST, capped) |
| `thopter:<name>:heartbeat` | `thopter-heartbeat` (cron, every 10s) | ISO-8601 timestamp; absent → thopter is dead |
| `thopter:<name>:screen_dump` | `thopter-heartbeat` | `tmux capture-pane` output, refreshed every 10s, TTL 120s |
| `thopter:<name>:transcript:*` | `thopter-transcript-push` (Claude hook) | Streamed Claude transcript JSONL |
| `thopter:<name>:last_message` | `thopter-transcript-push` | Most recent assistant message |
| `thopter:<name>:create:{stage,message,timestamp,logs}` | (cloud-init, only during fresh provisioning) | Setup progress reporting; not relevant for skill-driven setup |

When something looks broken at verification (phase 08), check whether the relevant key is present and recent. The keys are the source of truth for what the dashboard sees.

---

## Known divergences from the swarm CLI

This skill produces a working thopter that shows up in Redis-backed dashboards. It does **not** integrate with the swarm CLI's host-management features:

- **No droplet tagging.** Swarm CLI tags DO droplets with `thopter-managed`, `owner:*`, `thopter-name:*`. This skill doesn't, so swarm CLI commands like `./thopter list`, `destroy`, `snapshot` won't see skill-provisioned hosts. Operators can still SSH directly.
- **No snapshot workflow.** Swarm has "configure golden once, stamp clones." This skill is fresh-install only. Fine for one-off boxes.
- **GUI dashboard partially works.** The Electron GUI's read-only views (status, terminal screen via `screen_dump`, transcript) work because they key on `THOPTER_NAME` in Redis. Mutating actions that shell out to `./thopter` won't.

These are intentional. The skill exists to provision boxes the swarm CLI can't reach (Hetzner, bare metal, anything outside DigitalOcean).

---

## Working principles

- **Idempotent where possible.** Every step should be safe to re-run. Shell snippets in phase docs use `grep -q` guards, `|| true`, `install -m` over blind `cp`.
- **Verify after each phase.** Phase 8 is a final round-trip; each phase has its own quick check.
- **`bash -lc` for anything needing PATH from `~/.bashrc`** (after phase 05). Cron and other non-interactive shells must source `~/.thopter-env` explicitly.
- **Never log secrets.** `GH_TOKEN`, `THOPTER_REDIS_URL` etc. live in `~/.thopter-env` (mode 600) on the box. Don't echo them.
- **Copy `assets/` files verbatim — don't paraphrase.** The runtime scripts implement the Redis schema above; even small drifts break the dashboard.

## When something fails

apt mirrors flake. `claude.ai/install.sh` occasionally drops a half-broken binary. Network blips happen. Retry the failing step; if it fails twice the same way, **stop and report to the user** rather than fighting it.

For "the box is in a weird state" recovery: most state lives in `~/`. `rm -rf ~/.nvm ~/.local/bin/claude ~/.claude/downloads` then re-run the relevant phase is usually enough.
