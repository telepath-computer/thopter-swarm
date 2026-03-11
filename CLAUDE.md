# CLAUDE.md

CLI (`./thopter`) for managing remote thopters as autonomous Claude Code dev environments.

The active runtime path is **DigitalOcean droplets**. RunLoop support still exists in parts of the codebase for compatibility, but it is not the primary mode. Thopters are instrumented with Claude Code hooks that push status, logs, transcript activity, and notifications into Redis-backed dashboards and `ntfy.sh`.

## Build

```bash
npm install
npm run build
./thopter --help
```

There is no real automated test suite. `npm run build` is the required validation step before committing.

### Electron GUI

```bash
cd electron-gui
npm install
npm run rebuild
npm run dev
npm run dev:mock
```

The GUI shells out to the `thopter` CLI for mutations and reads Redis directly for live state, notifications, and terminal/dashboard data.

## Source Map

```text
src/
  cli.ts        CLI entrypoint. All subcommands registered here.
  devbox.ts     Thopter lifecycle: create, list, destroy, ssh, exec, snapshots
  run.ts        `thopter run`: create thopter + clone repo + launch Claude in tmux
  tail.ts       `thopter tail`: stream Claude transcript from Redis
  tell.ts       `thopter tell`: send messages to a running Claude session via tmux
  status.ts     Redis-backed status queries and detailed thopter status output
  config.ts     ~/.thopter.json read/write, env loading
  setup.ts      Interactive setup wizard
  client.ts     RunLoop SDK singleton for the legacy compatibility path
  provider.ts   Active provider selector (`digitalocean` is hard-coded today)
  do-ssh-key.ts DigitalOcean SSH key registration helpers
  names.ts      Random name generator
  output.ts     Table formatting

scripts/        Uploaded to thopters at create time
  thopter-status.sh             Redis status-line reporter CLI (used by hooks)
  thopter-heartbeat.sh          Heartbeat cron + screen dump capture
  thopter-cron-install.sh       Installs heartbeat cron
  thopter-transcript-push.mjs   Streams transcript entries to Redis
  install-claude-hooks.mjs      Merges hooks into Claude settings.json
  claude-hook-*.sh              Claude Code event hooks
  thopter-claude-md.md          Default ~/.claude/CLAUDE.md deployed to thopters
  starship.toml / tmux.conf / nvim-options.lua   Thopter tool configs

electron-gui/   Electron desktop app
  src/main/index.ts                     Electron main process
  src/renderer/App.tsx                  Root React component
  src/renderer/store/                   Zustand store
  src/renderer/services/                Real + mock service layers
  src/renderer/components/dashboard/    Dashboard + thopter cards
  src/renderer/components/detail/       Detail views, transcript, terminals, actions
  src/renderer/components/layout/       Header, tabs, notifications
  src/renderer/components/modals/       Run/reauth/modals
  src/renderer/components/ui/           UI primitives
```

## Key Architecture

- **Provider**: DigitalOcean-first. The current selector is hard-coded in [`src/provider.ts`](src/provider.ts).
- **Machines**: droplets bootstrapped over SSH, then provisioned with Claude Code, Codex, tmux, git credentials, helper scripts, and hooks.
- **Snapshots**: "golden snapshot" workflow. Configure a thopter once, then stamp out clones with `thopter snapshot default`.
- **Status/monitoring**: Redis. Heartbeat cron, Claude hooks, transcript streaming, status line reporting, and GUI/dashboard state all flow through Redis.
- **Notifications**: `THOPTER_NTFY_CHANNEL` enables `ntfy.sh` notifications driven by hook events.
- **SSH**: normal SSH in DigitalOcean mode. Some older comments/help text still reflect the RunLoop era.
- **Lifecycle caveat**: `suspend`, `resume`, and `keepalive` remain in the CLI for compatibility, but are not supported in DigitalOcean mode.

## Config Reference

See [`thopter-json-reference.md`](thopter-json-reference.md) for `~/.thopter.json`.

Important keys:

- `defaultSnapshotName`
- `defaultRepo`
- `defaultBranch`
- `defaultThopter`
- `envVars` including `GH_TOKEN` and `THOPTER_REDIS_URL`
- `claudeMdPath`
- `uploads`

Legacy/secondary:

- `runloopApiKey` exists for the older RunLoop path and is not used by the active DigitalOcean provider

## Stack

**CLI**: TypeScript (ES2022, NodeNext modules, strict). Deps include `commander`, `ioredis`, `friendly-words`, and the legacy `@runloop/api-client`.

**GUI**: Electron + React 18 + Zustand + Tailwind CSS v4 + xterm.js + node-pty.

## Notes

- Treat the repo as DigitalOcean-first when updating docs or behavior.
- Do not reintroduce SyncThing references; that experiment was removed.
- `todo` in the repo root contains open work items and notes.
