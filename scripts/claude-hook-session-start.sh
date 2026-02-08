#!/usr/bin/env bash
# Hook: SessionStart — Claude session started or resumed

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Persist transcript path for heartbeat to read
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-transcript-path

# Signal activity — heartbeat will set status to "running"
touch /tmp/thopter-active
thopter-status log "session started" 2>/dev/null || true

if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    node /usr/local/bin/thopter-last-message "$TRANSCRIPT" | thopter-status message 2>/dev/null || true
fi

exit 0
