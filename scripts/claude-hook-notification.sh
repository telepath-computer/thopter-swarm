#!/usr/bin/env bash
# Hook: Notification — log Claude Code notifications to redis
# Sends ntfy notification if THOPTER_NTFY_CHANNEL is configured.

read -t 1 INPUT || true
MSG=$(echo "$INPUT" | jq -r '.message // "unknown notification"')
TYPE=$(echo "$INPUT" | jq -r '.notification_type // "unknown"')
thopter-status log "notification [$TYPE]: $MSG" 2>/dev/null || true

# Send ntfy notification
if [ -n "${THOPTER_NTFY_CHANNEL:-}" ]; then
    curl -s -H "Title: ${THOPTER_NAME}" -d "[$TYPE] $MSG" "ntfy.sh/$THOPTER_NTFY_CHANNEL" &
fi

exit 0
