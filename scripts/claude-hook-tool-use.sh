#!/usr/bin/env bash
# Post-tool-use hook: signal that Claude is actively working.
# Writes transcript path to the activity file so the heartbeat can
# update last_message in redis. The file mtime signals activity.

read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$TRANSCRIPT" ] && echo "$TRANSCRIPT" > /tmp/thopter-active || touch /tmp/thopter-active
