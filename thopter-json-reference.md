# ~/.thopter.json Reference

## Top-level keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `runloopApiKey` | string | yes | Runloop API key. Get from the Runloop dashboard. |
| `defaultSnapshotId` | string | no | Snapshot used by `thopter create` when `--snapshot` isn't passed. Set via `thopter snapshot default`. |
| `defaultRepo` | string | no | Default repository (`owner/repo`) for `thopter run` when `--repo` isn't passed. Set via `thopter config set defaultRepo owner/repo`. |
| `defaultBranch` | string | no | Default branch for `thopter run` when `--branch` isn't passed. Set via `thopter config set defaultBranch main`. |
| `stopNotifications` | boolean | no | Send ntfy.sh notification when Claude finishes a response. Default `true`. Notifications are suppressed during the quiet period after a user message (see `stopNotificationQuietPeriod`). Set to `false` to disable. |
| `stopNotificationQuietPeriod` | number | no | Seconds after a user message during which stop notifications are suppressed (user is likely still engaged). Default `30`. Set to `0` to always send. |
| `claudeMdPath` | string | no | Path to a custom CLAUDE.md deployed to `~/.claude/CLAUDE.md` on every new devbox. Omit to use the built-in default. |
| `repos` | array | no | Predefined repositories for `thopter run`. Each entry: `{"repo": "owner/repo", "branch": "main"}`. Branch is optional — if omitted, user is prompted at run time (default: `main`). Multiple entries for the same repo with different branches are supported. Manage with `thopter repos {list,add,remove,edit}`. |
| `uploads` | array | no | Files to copy to new devboxes at create time. Each entry: `{"local": "/path/on/laptop", "remote": "/path/on/devbox"}`. Runs after all other provisioning. |
| `envVars` | object | yes | Key-value map of environment variables injected into every devbox. See below. |

## envVars

All secrets and config values that devboxes need go here. Written to `~/.thopter-env` on each devbox at create time. Manage with `thopter env set/delete` or edit the file directly.

| Key | Required | Description |
|-----|----------|-------------|
| `GH_TOKEN` | yes | GitHub personal access token. Used for git clone/push and `gh` CLI. Also configures HTTPS credential store on devboxes. |
| `THOPTER_REDIS_URL` | yes | Upstash Redis URL. Used by the CLI (`thopter status`, `thopter tail`) and on devboxes (heartbeats, status hooks). |
| `THOPTER_NTFY_CHANNEL` | no | ntfy.sh channel name for push notifications. Subscribe at `https://ntfy.sh/<channel>`. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | no | Set to `1` to enable the experimental agent teams feature in Claude Code. Suggested during setup. |

Add any other env vars your devboxes need — they're all passed through, e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`,

## Ignored keys

| Key | Description |
|-----|-------------|
| `docs` | Ignored by the CLI. Points to this reference file. |

## Example

```json
{
  "docs": "See thopter-json-reference.md for all config options.",
  "runloopApiKey": "rl_api_abc123...",
  "defaultSnapshotId": "jsw-golden",
  "defaultRepo": "telepath-computer/my-project",
  "defaultBranch": "main",
  "repos": [
    { "repo": "telepath-computer/my-app", "branch": "main" },
    { "repo": "telepath-computer/my-app", "branch": "dev" },
    { "repo": "telepath-computer/other-project" }
  ],
  "stopNotificationQuietPeriod": 30,
  "claudeMdPath": "/Users/jw/projects/my-claude-instructions.md",
  "uploads": [
    { "local": "/Users/jw/.npmrc", "remote": "/home/user/.npmrc" }
  ],
  "envVars": {
    "GH_TOKEN": "ghp_abc123...",
    "THOPTER_REDIS_URL": "rediss://default:abc123@us1-example.upstash.io:6379",
    "THOPTER_NTFY_CHANNEL": "my-thopters-abc123",
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-...",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```
