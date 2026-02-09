# Configuration

All configuration lives in `~/.thopter.json`. Managed via `thopter setup`, `thopter config`, `thopter env`, and `thopter snapshot default`. See [`thopter-json-reference.md`](../thopter-json-reference.md) for a complete reference of all keys.

## Important Devbox Environment Variables

Env vars in the `envVars` section are written to `~/.thopter-env` inside each devbox at create time.

| Variable | Purpose |
|----------|---------|
| `GH_TOKEN` | GitHub token for git clone/push and `gh` CLI (required) |
| `THOPTER_REDIS_URL` | Upstash Redis URL for status monitoring (required) |
| `THOPTER_NTFY_CHANNEL` | ntfy.sh channel for push notifications (optional) |

`THOPTER_REDIS_URL` is used both by the CLI (for `thopter status` and `thopter tail`) and on devboxes (for heartbeats and status reporting).

`GH_TOKEN` is also used to configure git credentials (HTTPS credential store) after the devbox boots.

Add any other env vars your devboxes need (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) with `thopter env set`.

## GitHub Token and Branch Rules

Thopter devboxes use a GitHub personal access token (`GH_TOKEN`) for all git operations. The git user is **ThopterBot**. (TODO: full github setup howto)

Thopters are configured to only push to branches prefixed with `thopter/` (e.g. `thopter/fix-login-bug`). They can create pull requests but cannot merge them or push to `main`/`master` directly. This is enforced by convention in the devbox CLAUDE.md, and can be enforced at the GitHub level with branch protection rules.

To create a fine-grained token:
1. Go to GitHub Settings > Developer Settings > Fine-grained tokens
2. Select the repositories you want thopters to access
3. Grant: Contents (read/write), Pull requests (read/write), Issues (read)
4. Set with: `thopter env set GH_TOKEN`

## Notifications (ntfy.sh)

Thopters push notifications to your phone or desktop via [ntfy.sh](https://ntfy.sh) when Claude sends a notification (permission requests, errors, etc.).

1. Pick a unique channel name (e.g. `my-thopters-abc123`)
2. Subscribe on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) or desktop
3. Configure:

```bash
thopter env set THOPTER_NTFY_CHANNEL my-thopters-abc123
```

Stop notifications (when Claude finishes a response) are enabled by default. They're automatically suppressed during interactive sessions — if you sent a message within the last 30 seconds, the notification is silenced (configurable via `stopNotificationQuietPeriod`). Disable them with:

```bash
thopter config set stopNotifications false
```

New thopters created after configuring these will send notifications. Existing thopters need to be re-created or have `THOPTER_NTFY_CHANNEL` added to their `~/.thopter-env` manually.

## Custom CLAUDE.md

By default, thopters get a standard CLAUDE.md with devbox environment info and branch conventions. To deploy your own custom CLAUDE.md (e.g. with project-specific instructions), set the path in your config:

```json
{
  "claudeMdPath": "/path/to/my-custom-claude.md"
}
```

The file at that path will be deployed to `~/.claude/CLAUDE.md` on each new devbox, replacing the default.

## File Uploads

You can have files from your local machine automatically uploaded to new devboxes at create time:

```json
{
  "uploads": [
    { "local": "/path/to/local/file", "remote": "/home/user/destination" }
  ]
}
```

Each entry copies the local file to the specified remote path on the devbox. This runs after all other provisioning, so it can override default configs if needed.
