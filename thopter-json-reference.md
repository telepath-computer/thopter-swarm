# ~/.thopter.json Reference

## Top-level keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `runloopApiKey` | string | yes | Runloop API key. Get from the Runloop dashboard. |
| `defaultSnapshotId` | string | no | Snapshot used by `thopter create` when `--snapshot` isn't passed. Set via `thopter snapshot default`. |
| `stopNotifications` | boolean | no | Send ntfy.sh notification when Claude finishes a response. Default `false`. Best for unattended thopters — noisy in interactive sessions. |
| `claudeMdPath` | string | no | Path to a custom CLAUDE.md deployed to `~/.claude/CLAUDE.md` on every new devbox. Omit to use the built-in default. |
| `uploads` | array | no | Files to copy to new devboxes at create time. Each entry: `{"local": "/path/on/laptop", "remote": "/path/on/devbox"}`. Runs after all other provisioning. |
| `envVars` | object | yes | Key-value map of environment variables injected into every devbox. See below. |

## envVars

All secrets and config values that devboxes need go here. Written to `~/.thopter-env` on each devbox at create time. Manage with `thopter env set/delete` or edit the file directly.

| Key | Required | Description |
|-----|----------|-------------|
| `GH_TOKEN` | yes | GitHub personal access token. Used for git clone/push and `gh` CLI. Also configures HTTPS credential store on devboxes. |
| `THOPTER_REDIS_URL` | yes | Upstash Redis URL. Used by the CLI (`thopter status`, `thopter tail`) and on devboxes (heartbeats, status hooks). |
| `THOPTER_NTFY_CHANNEL` | no | ntfy.sh channel name for push notifications. Subscribe at `https://ntfy.sh/<channel>`. |
| `ANTHROPIC_API_KEY` | no | For Claude Code on devboxes. |
| `OPENAI_API_KEY` | no | For Codex CLI on devboxes. |

Add any other env vars your devboxes need — they're all passed through.

## Ignored keys

| Key | Description |
|-----|-------------|
| `docs` | Ignored by the CLI. Points to this reference file. |

## Example

```json
{
  "docs": "See thopter-json-reference.md for all config options.",
  "runloopApiKey": "rl_api_abc123...",
  "defaultSnapshotId": "jw/golden",
  "stopNotifications": true,
  "claudeMdPath": "/Users/jw/projects/my-claude-instructions.md",
  "uploads": [
    { "local": "/Users/jw/.npmrc", "remote": "/home/user/.npmrc" }
  ],
  "envVars": {
    "GH_TOKEN": "ghp_abc123...",
    "THOPTER_REDIS_URL": "rediss://default:abc123@us1-example.upstash.io:6379",
    "THOPTER_NTFY_CHANNEL": "my-thopters-abc123",
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-..."
  }
}
```
