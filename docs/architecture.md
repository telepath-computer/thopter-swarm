# Architecture

## Stack

- **CLI**: TypeScript + Commander.js, run via `tsx`
- **Cloud provider**: [Runloop.ai](https://runloop.ai) devboxes (KVM microVMs)
- **SDK**: `@runloop/api-client` for devbox lifecycle, exec, snapshots
- **Monitoring**: Upstash Redis for heartbeats, status, and last messages
- **SSH**: `rli` CLI (`@runloop/rl-cli`)

## How It Works

1. `thopter create` provisions a Runloop devbox with metadata tags (`managed_by=runloop-thopters`, `thopter_name=<name>`, `thopter_owner=<git-user>`)
2. On fresh creates (no snapshot), an init script installs Claude Code, Codex, neovim, starship, tmux, and developer tools
3. After the devbox is running, env vars from `~/.thopter.json` are written to `~/.thopter-env`, git credentials are configured via the credential store, and thopter scripts (hooks, heartbeat, status) are uploaded
4. Claude Code hooks fire on session events (start, stop, notification, prompt, tool use) and report to Redis via `thopter-status`
5. A cron job runs a heartbeat every ~10 seconds, setting an `alive` key with 30s TTL as a dead-man's switch
6. Devboxes shut down after 12 hours (configurable via `--keep-alive`); reset with `thopter keepalive`

## Devbox Contents

Each thopter devbox gets:

- Claude Code (`claude` CLI)
- OpenAI Codex (`codex` CLI)
- Neovim + NvChad with OSC 52 clipboard support
- Starship prompt showing thopter name
- tmux with Ctrl-a prefix
- Git configured with GH_TOKEN credentials from `~/.thopter-env`
- Heartbeat cron reporting to Redis
- Claude Code hooks for status reporting

## Project Structure

```
src/           TypeScript source
  cli.ts       CLI entrypoint (Commander.js commands)
  devbox.ts    Devbox lifecycle (create, list, destroy, ssh, exec, snapshot)
  run.ts       thopter run (create + clone + launch Claude)
  tail.ts      thopter tail (stream transcript from Redis)
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
  thopter-transcript-push.mjs  Streams transcript entries to Redis (for thopter tail + last_message)
  thopter-claude-md.md         CLAUDE.md deployed to devboxes
  install-claude-hooks.mjs     Merges hook config into Claude settings.json
  claude-hook-*.sh             Individual Claude Code event hooks
  starship.toml                Starship prompt config
  tmux.conf                    tmux config (Ctrl-a prefix)
  nvim-options.lua             Neovim options (OSC 52 clipboard)

docs/          Design docs and brainstorms (not authoritative)
```

## Naming Convention

Thopter names are free-form strings. A useful team convention is `initials/purpose`:

```bash
thopter create jw/auth-fix
thopter create jw/golden        # for your golden snapshot
```

If you omit the name, a random friendly name is generated (e.g. `curious-lighthouse`).
