#!/usr/bin/env bash
# Hook: UserPromptSubmit — user engaged, Claude is working

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Signal activity — heartbeat will set status to "running"
touch /tmp/thopter-active

if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    node /usr/local/bin/thopter-last-message "$TRANSCRIPT" | thopter-status message 2>/dev/null || true
fi

exit 0
