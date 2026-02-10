# CLAUDE.md

CLI (`./thopter`) for managing Runloop.ai devboxes as autonomous Claude Code dev environments. Creates cloud VMs with Claude Code, git creds, monitoring hooks, and dev tools pre-configured.

## Build

```
npm install && npm run build   # always build (tsc) before committing
./thopter --help               # CLI via tsx wrapper → src/cli.ts
```

No test suite exists. TypeScript compilation (`npm run build`) is the only validation step.

## Source Map

```
src/
  cli.ts        CLI entrypoint (Commander.js). All subcommands registered here.
  devbox.ts     Devbox lifecycle: create, list, destroy, ssh, exec, suspend/resume, snapshot
  run.ts        `thopter run`: create devbox + clone repo + launch Claude in tmux
  tail.ts       `thopter tail`: stream Claude transcript from Redis
  tell.ts       `thopter tell`: send messages to a running Claude session via tmux
  status.ts     Redis status queries (heartbeat, agent state, last message)
  config.ts     ~/.thopter.json read/write, env loading
  setup.ts      Interactive setup wizard
  client.ts     Runloop SDK singleton (@runloop/api-client)
  names.ts      Random name generator (friendly-words)
  output.ts     Table formatting

scripts/        Uploaded to devboxes at create time
  thopter-status.sh             Redis status reporter CLI (used by hooks)
  thopter-heartbeat.sh          Heartbeat cron (touch activity file, report to Redis)
  thopter-cron-install.sh       Installs heartbeat cron
  thopter-transcript-push.mjs   Streams transcript to Redis (for `thopter tail`)
  thopter-last-message.mjs      Extracts last assistant message for status display
  install-claude-hooks.mjs      Merges hooks into Claude settings.json
  claude-hook-*.sh              Claude Code event hooks (start, stop, prompt, tool-use, notification)
  thopter-claude-md.md          Default ~/.claude/CLAUDE.md deployed to devboxes
  starship.toml / tmux.conf / nvim-options.lua   Devbox tool configs
```

## Key Architecture

- **Devboxes**: Runloop KVM microVMs. Tagged `managed_by=runloop-thopters` + `thopter_name` + `thopter_owner`.
- **Snapshots**: "Golden snapshot" pattern — configure once, stamp out clones. `thopter snapshot default` sets the base image.
- **Status/monitoring**: Upstash Redis. Heartbeat cron (10s interval, 30s TTL dead-man switch). Claude hooks report events. `thopter status` and `thopter tail` read from Redis.
- **Env vars**: `~/.thopter.json` `envVars` → written to `~/.thopter-env` on devbox at create time.
- **SSH**: Via `rli` CLI (`@runloop/rl-cli`), not raw SSH.

## Config Reference

See `thopter-json-reference.md` for all `~/.thopter.json` keys. Key ones: `runloopApiKey`, `defaultSnapshotId`, `defaultRepo`, `defaultBranch`, `envVars` (must include `GH_TOKEN`, `THOPTER_REDIS_URL`), `claudeMdPath`, `uploads`.

## Stack

TypeScript (ES2022, NodeNext modules, strict). Deps: `@runloop/api-client`, `commander`, `ioredis`, `friendly-words`. No framework — just a CLI. Output to `dist/` but runtime uses `tsx` directly.

## Task List

`todo` file in repo root has open work items and brainstorming notes.
