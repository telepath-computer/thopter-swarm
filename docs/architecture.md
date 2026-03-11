# Architecture

## Stack

- **CLI**: TypeScript + Commander.js, run via `tsx`
- **Active cloud provider**: DigitalOcean droplets
- **Provider state**: selected in code today, via [`src/provider.ts`](../src/provider.ts)
- **Monitoring**: Redis for heartbeats, status lines, transcripts, and last-message state
- **Remote access**: SSH/SCP to droplets
- **Legacy compatibility**: some RunLoop SDK/config code still exists behind provider checks

## Current Provider Model

The current active provider is `digitalocean`:

```ts
const ACTIVE_PROVIDER: Provider = "digitalocean";
```

The project started as a RunLoop-backed tool. The codebase is mid-migration:

- DigitalOcean is the authoritative runtime path today
- provider selection is not fully generalized yet
- some config keys, package names, CLI descriptions, and helper code still refer to RunLoop
- the intent is to keep converging on a cleaner provider abstraction, potentially with multi-provider support later

## How It Works

1. `thopter create` creates a tagged DigitalOcean droplet, either fresh or from a snapshot
2. Cloud-init/bootstrap gets the machine to a usable state with a non-root `user` account
3. Thopter connects over SSH, writes `~/.thopter-env`, configures git credentials, and uploads thopter scripts/hooks
4. Claude Code hooks report session events to Redis
5. A heartbeat process updates Redis regularly so the CLI can detect live workers
6. `thopter status` combines provider-side machine state with Redis-side agent state
7. `thopter tail` streams transcript entries from Redis

## DigitalOcean-Specific Constraints

DigitalOcean is not a drop-in replacement for RunLoop, so a few semantics differ:

- no thopter-specific suspend/resume lifecycle equivalent
- no keep-alive timer reset behavior equivalent to the old model
- droplets are regular VMs accessed over SSH rather than provider-proxied devboxes

The CLI keeps some old commands for compatibility, but in DigitalOcean mode unsupported operations fail fast with explicit messages.

## Machine Contents

Each thopter machine is intended to include:

- Claude Code (`claude`)
- OpenAI Codex (`codex`)
- git + GitHub token credentials from `~/.thopter-env`
- tmux
- Neovim and shell customizations
- thopter status/heartbeat/transcript scripts
- optional project- or user-specific uploads from local config

Exact contents depend on whether the machine was created fresh or restored from your snapshot.

## Project Structure

```text
src/
  cli.ts         CLI entrypoint
  provider.ts    Active provider selector
  devbox.ts      Provider-backed lifecycle, SSH, snapshots, uploads
  run.ts         create + clone + launch Claude workflow
  tell.ts        Send follow-up messages to Claude
  tail.ts        Transcript streaming from Redis
  status.ts      Unified provider + Redis status
  setup.ts       Interactive local setup wizard
  config.ts      ~/.thopter.json management

scripts/
  thopter-status.sh
  thopter-heartbeat.sh
  thopter-transcript-push.mjs
  install-claude-hooks.mjs
  thopter-claude-md.md
  ...

docs/
  architecture.md
  configuration.md
  cli-reference.md
  digitalocean-migration-proposal.md
  ...
```

## Naming

Thopter names are free-form at the CLI layer. A team-friendly convention is `initials/purpose`:

```bash
thopter create jw/auth-fix
thopter create jw/golden
```

Provider-side resource names may be normalized to fit provider constraints.
