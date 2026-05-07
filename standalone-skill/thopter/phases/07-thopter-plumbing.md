# Phase 07 — Thopter plumbing (status, hooks, heartbeat)

Goal: install the runtime scripts that make this box a *thopter* rather than just a Linux dev box. After this phase, the box reports status to Redis, fires Claude Code hooks, and runs a heartbeat cron.

## What gets installed where

**A. Runtime CLIs in `/usr/local/bin/` (mode 755):**

| Source (`assets/runtime/`) | Destination |
|----------------------------|-------------|
| `thopter-status.sh` | `/usr/local/bin/thopter-status` |
| `thopter-heartbeat.sh` | `/usr/local/bin/thopter-heartbeat` |
| `thopter-transcript-push.mjs` | `/usr/local/bin/thopter-transcript-push` |

**B. Claude Code hooks in `~/.claude/hooks/` (mode 755):**

| Source (`assets/runtime/hooks/`) | Destination |
|-----------------------------------|-------------|
| `on-stop.sh` | `~/.claude/hooks/on-stop.sh` |
| `on-prompt.sh` | `~/.claude/hooks/on-prompt.sh` |
| `on-notification.sh` | `~/.claude/hooks/on-notification.sh` |
| `on-session-start.sh` | `~/.claude/hooks/on-session-start.sh` |
| `on-session-end.sh` | `~/.claude/hooks/on-session-end.sh` |
| `on-tool-use.sh` | `~/.claude/hooks/on-tool-use.sh` |

## Step 1: Upload everything

```bash
# Class A: runtime CLIs to /tmp first, then sudo install
scp ${SKILL_DIR}/assets/runtime/thopter-status.sh           user@${HOST_IP}:/tmp/thopter-status
scp ${SKILL_DIR}/assets/runtime/thopter-heartbeat.sh        user@${HOST_IP}:/tmp/thopter-heartbeat
scp ${SKILL_DIR}/assets/runtime/thopter-transcript-push.mjs user@${HOST_IP}:/tmp/thopter-transcript-push.mjs

# Class B: hooks (already named on-*.sh in the skill)
ssh user@${HOST_IP} 'mkdir -p ~/.claude/hooks'
for h in on-stop on-prompt on-notification on-session-start on-session-end on-tool-use; do
  scp ${SKILL_DIR}/assets/runtime/hooks/${h}.sh user@${HOST_IP}:.claude/hooks/${h}.sh
done
```

## Step 2: Install runtime CLIs

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
sudo install -m 755 /tmp/thopter-status              /usr/local/bin/thopter-status
sudo install -m 755 /tmp/thopter-heartbeat           /usr/local/bin/thopter-heartbeat
sudo install -m 755 /tmp/thopter-transcript-push.mjs /usr/local/bin/thopter-transcript-push
chmod +x ~/.claude/hooks/*.sh
EOF
```

## Step 3: Register hooks in `~/.claude/settings.json`

Claude Code reads `~/.claude/settings.json`. We need to add a `hooks` block that points each event to our hook script. The merge must be idempotent — re-runs must replace prior thopter entries, not duplicate them.

Run inline (uses `jq`, which apt-installed in phase 03):

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

# Build the canonical hooks block (commands point at our scripts).
NEW_HOOKS=$(jq -n --arg dir "$HOOKS_DIR" '{
  SessionStart:     [{hooks:[{type:"command", command:($dir+"/on-session-start.sh")}]}],
  UserPromptSubmit: [{hooks:[{type:"command", command:($dir+"/on-prompt.sh")}]}],
  Notification:     [{hooks:[{type:"command", command:($dir+"/on-notification.sh")}]}],
  PostToolUse:      [{hooks:[{type:"command", command:($dir+"/on-tool-use.sh")}]}],
  Stop:             [{hooks:[{type:"command", command:($dir+"/on-stop.sh")}]}],
  SessionEnd:       [{hooks:[{type:"command", command:($dir+"/on-session-end.sh")}]}]
}')

# Strip any existing matchers whose commands point under HOOKS_DIR
# (idempotency: removes prior thopter entries before re-adding).
# Then merge in NEW_HOOKS (overwriting per-event arrays).
jq --argjson new "$NEW_HOOKS" --arg dir "$HOOKS_DIR" '
  .hooks = ((.hooks // {}) | with_entries(
    .value |= map(select(
      ((.hooks // []) | map(.command // "" | startswith($dir)) | any) | not
    ))
  )) | .hooks = (.hooks + $new)
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

echo "Hooks registered:"
jq '.hooks | keys' "$SETTINGS"
EOF
```

## Step 4: Heartbeat cron

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
sudo /usr/sbin/cron 2>/dev/null || true
( crontab -l 2>/dev/null | grep -v thopter-heartbeat ; \
  echo "* * * * * /usr/local/bin/thopter-heartbeat" ) | crontab -
crontab -l
EOF
```

`thopter-heartbeat` is invoked once per minute by cron and loops 6× internally (10s tick).

## Verification

```bash
ssh user@${HOST_IP} 'bash -lc "
  set -e
  command -v thopter-status
  command -v thopter-heartbeat
  command -v thopter-transcript-push
  ls ~/.claude/hooks/
  jq .hooks ~/.claude/settings.json
  crontab -l | grep thopter-heartbeat
"'
```

Expect:
- All three commands resolve to `/usr/local/bin/...`
- `~/.claude/hooks/` contains all six `on-*.sh` files
- `settings.json` has hooks for SessionStart, UserPromptSubmit, Notification, PostToolUse, Stop, SessionEnd
- Crontab has the heartbeat line
