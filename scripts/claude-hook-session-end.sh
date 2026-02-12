#!/usr/bin/env bash
# Hook: SessionEnd — Claude session ended

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

thopter-status done "session ended" 2>/dev/null || true

# Final transcript push for thopter tail (also updates last_message)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true

# Capture tmux screen and push to Redis for GUI terminal view
tmux capture-pane -t claude -p 2>/dev/null | redis-cli --tls -u "$THOPTER_REDIS_URL" -x SETEX "thopter:${THOPTER_NAME}:screen_dump" 120 >/dev/null 2>&1 || true

exit 0
