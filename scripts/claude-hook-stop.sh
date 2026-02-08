#!/usr/bin/env bash
# Hook: Stop — Claude finished responding, waiting for user input.
# Parses transcript to extract last assistant message and stores in redis.

# read -t returns immediately when a line is available, with 1s safety timeout
read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

thopter-status waiting "Claude stopped, waiting for input" 2>/dev/null || true

# Extract last assistant text from transcript and pipe to redis
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    node /usr/local/bin/thopter-last-message "$TRANSCRIPT" | thopter-status message 2>/dev/null || true
fi

exit 0
