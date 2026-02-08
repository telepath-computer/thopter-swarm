#!/usr/bin/env bash
# Cron target: source env vars and run heartbeat every 10s for 1 minute.
# Cron launches this once per minute; it loops 6 times internally.
# Installed to /usr/local/bin/thopter-heartbeat

. "$HOME/.bashrc" 2>/dev/null

# Activity-based status: check the touch file that Claude hooks update.
# If active within the last minute, status is "running".
# If stale and status was "running", flip to "inactive" (Claude likely died
# or was killed without a clean stop/done signal).
if [ -f /tmp/thopter-active ] && [ "$(find /tmp/thopter-active -mmin -1 2>/dev/null)" ]; then
    /usr/local/bin/thopter-status running >/dev/null 2>&1 || true
else
    CURRENT_STATUS=$(redis-cli --tls -u "$REDIS_URL" GET "thopter:${THOPTER_NAME}:status" 2>/dev/null || true)
    if [ "$CURRENT_STATUS" = "running" ]; then
        /usr/local/bin/thopter-status inactive >/dev/null 2>&1 || true
    fi
fi

for i in 1 2 3 4 5 6; do
    /usr/local/bin/thopter-status heartbeat >/dev/null 2>&1

    # Update last message from active Claude transcript
    TRANSCRIPT=$(cat /tmp/thopter-transcript-path 2>/dev/null)
    if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
        node /usr/local/bin/thopter-last-message "$TRANSCRIPT" | /usr/local/bin/thopter-status message 2>/dev/null || true
    fi

    [ "$i" -lt 6 ] && sleep 10
done
