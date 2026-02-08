#!/usr/bin/env bash
# thopter-status: report thopter status, logs, and health to redis.
# Reads THOPTER_NAME, THOPTER_ID, REDIS_URL from environment.

set -euo pipefail

if [ -z "${REDIS_URL:-}" ]; then
    echo "REDIS_URL not set" >&2
    exit 1
fi
if [ -z "${THOPTER_NAME:-}" ]; then
    echo "THOPTER_NAME not set" >&2
    exit 1
fi

PREFIX="thopter:${THOPTER_NAME}"

rcli() {
    redis-cli --tls -u "$REDIS_URL" "$@" 2>/dev/null
}

cmd_log() {
    local msg="$*"
    local entry="$(date -u +%Y-%m-%dT%H:%M:%SZ) $msg"
    rcli RPUSH "$PREFIX:logs" "$entry" > /dev/null
    rcli EXPIRE "$PREFIX:logs" 604800 > /dev/null  # 7 days
    echo "Logged: $entry"
}

cmd_waiting() {
    rcli SET "$PREFIX:status" "waiting" EX 86400 > /dev/null
    echo "Status: waiting"
    if [ $# -gt 0 ]; then
        cmd_log "waiting: $*"
    fi
}

cmd_done() {
    rcli SET "$PREFIX:status" "done" EX 86400 > /dev/null
    echo "Status: done"
    if [ $# -gt 0 ]; then
        cmd_log "done: $*"
    fi
}

cmd_running() {
    rcli SET "$PREFIX:status" "running" EX 86400 > /dev/null
    echo "Status: running"
}

cmd_heartbeat() {
    rcli SET "$PREFIX:heartbeat" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" EX 86400 > /dev/null
    rcli SET "$PREFIX:alive" "1" EX 30 > /dev/null
    if [ -n "${THOPTER_ID:-}" ]; then
        rcli SET "$PREFIX:id" "$THOPTER_ID" EX 86400 > /dev/null
    fi
    # Check if claude is running
    if pgrep -x claude > /dev/null 2>&1; then
        rcli SET "$PREFIX:claude_running" "1" EX 86400 > /dev/null
    else
        rcli SET "$PREFIX:claude_running" "0" EX 86400 > /dev/null
    fi
    # Ensure status is set (default to running if not already set)
    local current_status
    current_status=$(rcli GET "$PREFIX:status" 2>/dev/null || true)
    if [ -z "$current_status" ] || [ "$current_status" = "(nil)" ]; then
        rcli SET "$PREFIX:status" "running" EX 86400 > /dev/null
    fi
}

cmd_message() {
    # Read message from stdin to avoid shell escaping issues.
    # Uses redis-cli -x (read last arg from stdin) with SETEX.
    # Skip if stdin is empty to avoid overwriting with blank.
    local msg
    msg=$(cat)
    [ -z "$msg" ] && return 0
    printf '%s' "$msg" | rcli -x SETEX "$PREFIX:last_message" 86400 > /dev/null
}

cmd_show() {
    echo "=== thopter-status: ${THOPTER_NAME} ==="
    echo "ID:             $(rcli GET "$PREFIX:id")"
    echo "Status:         $(rcli GET "$PREFIX:status")"
    echo "Heartbeat:      $(rcli GET "$PREFIX:heartbeat")"
    echo "Alive:          $(rcli GET "$PREFIX:alive")"
    echo "Claude running: $(rcli GET "$PREFIX:claude_running")"
    echo "Last message:   $(rcli GET "$PREFIX:last_message" | head -c 100)"
    echo "Recent logs:"
    rcli LRANGE "$PREFIX:logs" -10 -1 | while read -r line; do
        echo "  $line"
    done
}

case "${1:-}" in
    log)       shift; cmd_log "$@" ;;
    waiting)   shift; cmd_waiting "$@" ;;
    done)      shift; cmd_done "$@" ;;
    running)   cmd_running ;;
    message)   cmd_message ;;
    heartbeat) cmd_heartbeat ;;
    show)      cmd_show ;;
    *)
        echo "Usage: thopter-status {log|waiting|done|running|heartbeat|message|show} [args...]"
        echo ""
        echo "Commands:"
        echo "  log <message>        Add a timestamped log entry"
        echo "  waiting [message]    Set status to waiting (optionally log why)"
        echo "  done [message]       Set status to done (optionally log why)"
        echo "  running              Set status to running"
        echo "  message              Set last message (reads from stdin)"
        echo "  heartbeat            Update heartbeat + check claude process (cron)"
        echo "  show                 Show current status from redis"
        exit 1
        ;;
esac
