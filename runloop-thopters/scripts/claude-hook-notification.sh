#!/usr/bin/env bash
# Hook: Notification — log Claude Code notifications to redis

read -t 1 INPUT || true
MSG=$(echo "$INPUT" | jq -r '.message // "unknown notification"')
TYPE=$(echo "$INPUT" | jq -r '.notification_type // "unknown"')
thopter-status log "notification [$TYPE]: $MSG" 2>/dev/null || true
exit 0
