#!/usr/bin/env bash
# Hook: SessionStart — Claude session started or resumed

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Signal activity for heartbeat liveness detection
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-active || touch /tmp/thopter-active

thopter-status log "session started" 2>/dev/null || true

# Reset transcript cursor and push session marker for thopter tail
[ -n "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" --reset 2>/dev/null || true

# Capture tmux screen and push to Redis for GUI terminal view
tmux capture-pane -t claude -p 2>/dev/null | redis-cli --tls -u "$THOPTER_REDIS_URL" -x SETEX "thopter:${THOPTER_NAME}:screen_dump" 120 >/dev/null 2>&1 || true

# Send ntfy notification
if [ -n "${THOPTER_NTFY_CHANNEL:-}" ]; then
    curl -s -H "Title: ${THOPTER_NAME}" -d "Claude session started" "ntfy.sh/$THOPTER_NTFY_CHANNEL" &
fi

exit 0
