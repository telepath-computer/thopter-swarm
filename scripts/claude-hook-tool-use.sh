#!/usr/bin/env bash
# Post-tool-use hook: signal that Claude is actively working.
# Writes transcript path to the activity file so the heartbeat can
# update last_message in redis. The file mtime signals activity.

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-active || touch /tmp/thopter-active

# Stream transcript entries to Redis for thopter tail (synchronous to avoid cursor races)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true
