#!/usr/bin/env bash
# Hook: SessionEnd — Claude session ended

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

thopter-status done "session ended" 2>/dev/null || true

# Final transcript push for thopter tail (also updates last_message)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true

exit 0
