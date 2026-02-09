#!/usr/bin/env bash
# Hook: UserPromptSubmit — user engaged, Claude is working

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Signal activity with transcript path — heartbeat reads this to update last_message
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-active || touch /tmp/thopter-active

if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    node /usr/local/bin/thopter-last-message "$TRANSCRIPT" | thopter-status message 2>/dev/null || true
    # Stream transcript entries to Redis for thopter tail
    node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null &
fi

exit 0
