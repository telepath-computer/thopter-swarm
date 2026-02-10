#!/usr/bin/env bash
# Post-tool-use hook: signal that Claude is actively working.
# The activity file mtime is used by the heartbeat for liveness detection.

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-active || touch /tmp/thopter-active

# Stream transcript entries to Redis for thopter tail (also updates last_message)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true
