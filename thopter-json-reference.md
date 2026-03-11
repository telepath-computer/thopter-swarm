# `~/.thopter.json` Reference

The active provider is currently DigitalOcean, but this config file still contains some legacy RunLoop-era fields for compatibility.

## Top-Level Keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `runloopApiKey` | string | no | RunLoop-only key. Kept for compatibility with the older backend and not used by the active DigitalOcean provider. |
| `defaultSnapshotName` | string | no | Snapshot name used by `thopter create` when `--snapshot` is not passed. Set via `thopter snapshot default`. |
| `defaultSnapshotId` | string | no | Legacy alias for `defaultSnapshotName`. The code migrates toward `defaultSnapshotName`. |
| `defaultRepo` | string | no | Default repository (`owner/repo`) for `thopter run` when `--repo` is not passed. |
| `defaultBranch` | string | no | Default branch for `thopter run` when `--branch` is not passed. |
| `defaultThopter` | string | no | Default thopter used when you pass `.` to commands like `thopter ssh .`. |
| `stopNotifications` | boolean | no | Whether to send stop notifications via `ntfy.sh`. Defaults to `true`. |
| `stopNotificationQuietPeriod` | number | no | Seconds after a user message during which stop notifications are suppressed. Defaults to `30`. |
| `claudeMdPath` | string | no | Path to a custom CLAUDE.md uploaded to new thopters. |
| `repos` | array | no | Predefined repositories for `thopter run`. |
| `uploads` | array | no | Files to upload to newly created thopters after provisioning. |
| `syncthing` | object | no | Local SyncThing configuration for pairing with thopters. |
| `envVars` | object | no | Key-value map of environment variables injected into new thopters. |
| `docs` | string | no | Ignored by the CLI. Convenience pointer to this reference doc. |

## `envVars`

These values are written to `~/.thopter-env` inside each newly created thopter.

| Key | Required | Description |
|-----|----------|-------------|
| `GH_TOKEN` | effectively yes | GitHub token used for git and `gh` inside thopters |
| `THOPTER_REDIS_URL` | yes | Redis URL used for status, heartbeats, and transcript tailing |
| `THOPTER_NTFY_CHANNEL` | no | `ntfy.sh` topic for push notifications |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | no | Set to `1` to enable the experimental Claude Code agent teams feature |

Any additional keys are passed through as-is.

## `repos`

Each entry has this shape:

```json
{ "repo": "owner/repo", "branch": "main" }
```

`branch` is optional.

## `uploads`

Each entry has this shape:

```json
{ "local": "/path/on/laptop", "remote": "/path/on/thopter" }
```

## `syncthing`

The local SyncThing config shape is:

```json
{
  "deviceId": "MFZWI3D-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX",
  "folderName": "my-sync-folder"
}
```

## Example: DigitalOcean-First

```json
{
  "docs": "See thopter-json-reference.md for all config options.",
  "defaultSnapshotName": "jsw-golden",
  "defaultRepo": "telepath-computer/my-project",
  "defaultBranch": "main",
  "defaultThopter": "jw/worker-1",
  "repos": [
    { "repo": "telepath-computer/my-app", "branch": "main" },
    { "repo": "telepath-computer/my-app", "branch": "dev" },
    { "repo": "telepath-computer/other-project" }
  ],
  "stopNotifications": true,
  "stopNotificationQuietPeriod": 30,
  "claudeMdPath": "/Users/jw/projects/my-claude-instructions.md",
  "uploads": [
    { "local": "/Users/jw/.npmrc", "remote": "/home/user/.npmrc" }
  ],
  "syncthing": {
    "deviceId": "MFZWI3D-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX",
    "folderName": "thopter-sync"
  },
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

## Example: RunLoop Mode

If you explicitly switch the codebase back to RunLoop mode, `runloopApiKey` becomes relevant again:

```json
{
  "runloopApiKey": "rl_api_abc123...",
  "defaultSnapshotName": "jsw-golden",
  "envVars": {
    "GH_TOKEN": "ghp_abc123...",
    "THOPTER_REDIS_URL": "rediss://default:abc123@us1-example.upstash.io:6379"
  }
}
```

See [docs/runloop.md](docs/runloop.md) for the secondary RunLoop path.
