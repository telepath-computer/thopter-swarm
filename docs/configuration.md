# Configuration

All local configuration lives in `~/.thopter.json`. Manage it with `thopter setup`, `thopter config`, `thopter env`, `thopter repos`, `thopter use`, and `thopter snapshot default`.

See [`thopter-json-reference.md`](../thopter-json-reference.md) for the full key reference.

## Current Provider Assumption

The active provider is currently DigitalOcean. That matters for setup:

- `thopter setup` verifies `doctl` auth
- it requires `~/.ssh/id_rsa` and `~/.ssh/id_rsa.pub`
- it ensures your local RSA public key is registered with DigitalOcean

Some config names are legacy from the RunLoop version of the project. Most notably, `runloopApiKey` still exists in the config schema, but it is not used by the active DigitalOcean path.

## Important Devbox Environment Variables

Values under `envVars` are written to `~/.thopter-env` inside each new thopter.

| Variable | Purpose |
|----------|---------|
| `GH_TOKEN` | GitHub token for git clone/push and `gh` CLI inside thopters |
| `THOPTER_REDIS_URL` | Redis URL used by both the CLI and thopters for status and transcript reporting |
| `THOPTER_NTFY_CHANNEL` | Optional `ntfy.sh` topic for push notifications |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Optional Claude Code flag; setup offers to enable it |

Add anything else your machines need with `thopter env set`, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

## GitHub Token

`GH_TOKEN` is required for most real use:

- git clone/push from thopters
- `gh` CLI use inside thopters
- creating PRs from agent work

A fine-grained PAT is the intended setup. Typical permissions:

1. Repository contents: read/write
2. Pull requests: read/write
3. Issues: read

Set it with:

```bash
thopter env set GH_TOKEN
```

Branch safety is still mostly convention-driven. The default thopter CLAUDE.md pushes agents toward branch-based workflows and PRs rather than direct writes to protected branches.

## Redis

`THOPTER_REDIS_URL` is required. It powers:

- `thopter status`
- `thopter tail`
- heartbeat/alive state
- status line reporting from hooks
- last-message and notification state

In practice this should be reachable from both your laptop and the droplets. Upstash is the obvious lightweight choice.

## Notifications

If `THOPTER_NTFY_CHANNEL` is set, thopters can notify you via [ntfy.sh](https://ntfy.sh/) when Claude stops or needs attention.

```bash
thopter env set THOPTER_NTFY_CHANNEL my-thopters-abc123
```

Control stop notifications with:

```bash
thopter config set stopNotifications false
thopter config set stopNotificationQuietPeriod 0
```

New machines receive updated env vars at create time. Existing machines will not automatically pick up local config changes unless you recreate them or update `~/.thopter-env` manually.

## Snapshots

Use snapshots to create your own "golden" machine image:

```bash
thopter snapshot create my-thopter my-golden
thopter snapshot default my-golden
```

Then `thopter create` will restore from that snapshot unless you pass `--fresh`.

In the active provider, snapshots are DigitalOcean droplet snapshots. The CLI tries to keep the snapshot UX provider-neutral.

## Custom CLAUDE.md

To replace the built-in thopter CLAUDE.md on newly created machines:

```json
{
  "claudeMdPath": "/path/to/my-custom-claude.md"
}
```

That file is uploaded to `~/.claude/CLAUDE.md` during provisioning.

## File Uploads

You can push local files to each new thopter after provisioning:

```json
{
  "uploads": [
    { "local": "/path/to/local/file", "remote": "/home/user/destination" }
  ]
}
```

This is useful for dotfiles, package manager auth, or other per-user bootstrap material.

## Legacy Fields

These still exist mainly for compatibility with the older RunLoop-based code path:

- `runloopApiKey`
- some CLI descriptions that still say "Runloop"
- package metadata still named `runloop-thopters`

Those remnants are expected during the migration. They should not be read as "RunLoop is the primary backend."
