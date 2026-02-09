# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

CRITICAL: Claude MUST READ, IN FULL, the entire root `README.md` file at the
start of any working session. It explains this project overall. Also, after a
conversation is compacted, do not rely on a summary: RE-READ THE ENTIRE FILE
into context. You MUST NOT do work without this ENTIRE FILE fully in context.

## What This Is

Thopter Swarm is a CLI tool (`./thopter`) for managing Runloop.ai devboxes as
autonomous Claude Code development environments. It creates cloud VMs
pre-configured with Claude Code, git credentials, monitoring hooks, and
developer tools.

## Build and Run

- `npm install` to install dependencies
- `npm run build` to compile TypeScript (always run before considering work done)
- `./thopter --help` to see CLI commands
- `./thopter` is a thin shell wrapper that runs `src/cli.ts` via `tsx`

## Project Structure

```
src/           TypeScript source (CLI commands, Runloop SDK client, Redis status)
scripts/       Devbox provisioning scripts (Claude hooks, heartbeat, starship, tmux)
docs/          Design docs and wishlists (not authoritative specs)
package.json   Dependencies: @runloop/api-client, commander, ioredis
tsconfig.json  TypeScript config (ES2022, NodeNext modules)
thopter        CLI wrapper script
todo           Current task list
```

## Key Concepts

- **Devboxes** are Runloop.ai microVMs tagged with `managed_by=runloop-thopters`
  metadata and a `thopter_name` for human-friendly naming
- **Snapshots** save devbox disk state; the "golden snapshot" pattern lets you
  configure once and stamp out ready-to-use devboxes
- **Environment variables** are configured in `~/.thopter.json` under `envVars`
  and written to `~/.thopter-env` on each devbox at create time
- **Status reporting** uses Upstash Redis: heartbeats, Claude hook events, last
  assistant messages
- **SSH** is via the `rli` CLI (`@runloop/rl-cli`)

## Configuration

- `~/.thopter.json` on developer laptop: `runloopApiKey`, `defaultSnapshotId`, `claudeMdPath`, `uploads`, `envVars`
- Devbox env vars managed via `./thopter env` or `./thopter setup`
