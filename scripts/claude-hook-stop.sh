#!/usr/bin/env bash
# Hook: Stop — Claude finished responding, waiting for user input.
# Parses transcript to extract last assistant message and stores in redis.
# Sends ntfy notification if THOPTER_NTFY_CHANNEL is configured.

# read -t returns immediately when a line is available, with 1s safety timeout
read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

thopter-status waiting "Claude stopped, waiting for input" 2>/dev/null || true

# Extract last assistant text from transcript
LAST_MSG=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    LAST_MSG=$(node /usr/local/bin/thopter-last-message "$TRANSCRIPT" 2>/dev/null || true)
fi

# Send to redis
if [ -n "$LAST_MSG" ]; then
    printf '%s' "$LAST_MSG" | thopter-status message 2>/dev/null || true
fi

# Stream transcript entries to Redis for thopter tail
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true

# Send ntfy notification (only when explicitly enabled via stopNotifications config)
if [ -n "${THOPTER_NTFY_CHANNEL:-}" ] && [ "${THOPTER_STOP_NOTIFY:-}" = "1" ]; then
    NTFY_MSG="Waiting for input"
    [ -n "$LAST_MSG" ] && NTFY_MSG=$(printf '%s' "$LAST_MSG" | head -c 500)
    curl -s -H "Title: ${THOPTER_NAME}" -d "$NTFY_MSG" "ntfy.sh/$THOPTER_NTFY_CHANNEL" &
fi

exit 0
