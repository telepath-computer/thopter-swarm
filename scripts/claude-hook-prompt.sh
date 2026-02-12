#!/usr/bin/env bash
# Hook: UserPromptSubmit — user engaged, Claude is working

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Signal activity for heartbeat liveness detection
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-active || touch /tmp/thopter-active

# Stream transcript entries to Redis for thopter tail (also updates last_message)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true

# Capture tmux screen and push to Redis for GUI terminal view
tmux capture-pane -p 2>/dev/null | redis-cli --tls -u "$THOPTER_REDIS_URL" -x SETEX "thopter:${THOPTER_NAME}:screen_dump" 120 >/dev/null 2>&1 || true

exit 0
