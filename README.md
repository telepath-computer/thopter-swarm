# Thopter Swarm

CLI for managing cloud thopters as autonomous Claude Code development environments.

Today, the active backend is **DigitalOcean droplets**. The project started on RunLoop, and some names, config keys, and command semantics still reflect that history for compatibility while the codebase is being cleaned up. Longer term, this likely becomes a small **multi-provider** layer rather than a DigitalOcean-only tool.

Each thopter is a remote Linux machine pre-configured with Claude Code, Codex, git credentials, developer tools, and Claude Code hooks. Those hooks collect status and message activity, push it into Redis for dashboards/transcript views, and can fan out notifications through `ntfy.sh`. Create one, point it at a repo and prompt, and let it work while you monitor or interrupt it from your laptop.

This is an internal Telepath tool published mainly as a reference implementation and conversation starter. If someone else finds it useful, the README should at least describe the real current state.

## Current State

- Active provider: `digitalocean` (`thopter provider`)
- Runtime model: DigitalOcean droplets accessed over normal SSH
- Status/monitoring: Redis-backed heartbeats, transcript tailing, status line reporting, and hook-driven message collection
- Compatibility: some RunLoop-era names remain in code and config, including `runloopApiKey`
- Direction: provider abstraction exists in embryo; multi-provider support is plausible but not finished

## Rationale

The target developer experience is:

- long-running remote agents instead of tying up your laptop
- multiple workers in parallel
- detachable sessions you can reconnect to from anywhere
- full shell access
- golden machine snapshots that are ready to work
- git/GitHub integration
- status visibility, transcript tailing, and push notifications
- hook-driven dashboards and notifications rather than blind SSH-only sessions
- enough safety rails and conventions to use this day to day

Thopter Swarm is the thin management layer around that workflow, not the sandbox product itself.

## Quick Start

### Prerequisites

- Node.js 18+
- A DigitalOcean account
- `doctl` installed and authenticated
- `~/.ssh/id_rsa` and `~/.ssh/id_rsa.pub` on your machine
- A Redis instance reachable from both your laptop and droplets, such as Upstash
- Optional but recommended: an `ntfy.sh` topic for push notifications
- A GitHub user/token with access to the repos your thopters will clone and push from
- iTerm2 if you want the nicest `thopter attach` tmux experience

Install `doctl` and authenticate:

```bash
brew install doctl
doctl auth init --context thopters
doctl auth switch --context thopters
```

Then install Thopter Swarm:

```bash
git clone <this-repo>
cd thopter-swarm
npm install
npm run build
npm link
```

### First-Time Setup

```bash
thopter setup
```

In DigitalOcean mode, setup currently does this:

1. Verifies `doctl` is authenticated
2. Verifies `~/.ssh/id_rsa(.pub)` exists
3. Ensures your local RSA public key is registered with DigitalOcean
4. Prompts for Redis and devbox environment variables
5. Optionally configures `ntfy.sh`

All local config lives in `~/.thopter.json`.

### Create a Golden Thopter

```bash
thopter create --fresh
thopter ssh adventurous-quesadilla
```

Authenticate Claude/Codex, clone the repos you use a lot, install whatever tools you want in your baseline, then snapshot it:

```bash
thopter snapshot create adventurous-quesadilla josh-golden
thopter snapshot default josh-golden
```

Now future creates can restore from that snapshot:

```bash
thopter create worker-1
thopter create worker-2
```

### Dispatch Work

```bash
thopter run --repo owner/repo "fix the login bug described in issue #42 and open a PR"
```

That creates a thopter, clones the repo, and launches Claude in a tmux session. From there:

```bash
thopter status
thopter tail worker-1 -f
thopter tell worker-1 "also fix the tests"
thopter attach worker-1
thopter ssh worker-1
```

## DigitalOcean Notes

The DigitalOcean migration is functional, but it is not feature-identical with RunLoop.

- `create`, `run`, `status`, `tail`, `tell`, `ssh`, `exec`, `destroy`, and snapshots work in DigitalOcean mode
- `suspend`, `resume`, and `keepalive` remain in the CLI for compatibility, but DigitalOcean mode currently rejects them explicitly
- some help text, package metadata, and config names still say "Runloop" because the cleanup is incomplete

That mismatch is intentional for now: preserve familiar CLI surface first, then make the provider model cleaner.

## Configuration

Important config and env values:

- `THOPTER_REDIS_URL`: required for status monitoring and transcript tailing
- `GH_TOKEN`: required for repo access and `gh` inside thopters
- `THOPTER_NTFY_CHANNEL`: optional push notifications
- `defaultSnapshotName`: default snapshot used by `thopter create`
- `runloopApiKey`: legacy compatibility field; not used by the active DigitalOcean provider

See [docs/configuration.md](docs/configuration.md) and [thopter-json-reference.md](thopter-json-reference.md).

## Architecture

The CLI is TypeScript + Commander.js. The active provider is currently hard-coded in [src/provider.ts](src/provider.ts) to `digitalocean`. Droplets are provisioned, bootstrapped over SSH, and instrumented with scripts/hooks that push status and transcripts into Redis.

See [docs/architecture.md](docs/architecture.md) for the current architecture doc and [docs/digitalocean-migration-proposal.md](docs/digitalocean-migration-proposal.md) for the migration plan/history.

## CLI Reference

See [docs/cli-reference.md](docs/cli-reference.md) for command details.

## More Docs

- [DigitalOcean setup notes](do-setup.md)
- [RunLoop mode notes](docs/runloop.md)
- [Clipboard setup](docs/clipboard.md)
- [Design docs and ideas](docs/)

## Electron GUI (Experimental)

There is also an experimental Electron app for managing thopters. It is still rough, but it is more than a toy wrapper around the CLI.

The GUI gives you:

- a dashboard view of running thopters and their current status
- task context on each thopter, including notes/metadata attached to the worker
- per-thopter tabs so each worker can stay open in its own view
- an SSH terminal per thopter inside the app
- integrated notification handling so activity can be tracked from the desktop UI

Under the hood, it shells out to the CLI for mutations and reads Redis directly for live state.

```bash
cd electron-gui
npm install
npm run rebuild
npm run dev
```

It should still be treated as internal tooling rather than a polished product, but if you want a dashboard-oriented workflow instead of living in the CLI, this is the interface for that.
