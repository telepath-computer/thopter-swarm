#!/usr/bin/env bash
# Cron target: source env vars and run heartbeat every 10s for 1 minute.
# Cron launches this once per minute; it loops 6 times internally.
# Installed to /usr/local/bin/thopter-heartbeat

. "$HOME/.bashrc" 2>/dev/null

# Runloop keepalive: if Claude was active in the last 10 minutes, reset the
# idle timer so the devbox doesn't auto-suspend. Runs once per cron cycle
# (every minute) — cheap compared to the 2-hour idle timeout.
if [ -n "${THOPTER_ID:-}" ] && [ -n "${RUNLOOP_API_KEY:-}" ] && [ -f /tmp/thopter-active ]; then
    if [ "$(find /tmp/thopter-active -mmin -10 2>/dev/null)" ]; then
        curl -sf -X POST "https://api.runloop.ai/v1/devboxes/${THOPTER_ID}/keep_alive" \
            -H "Authorization: Bearer ${RUNLOOP_API_KEY}" \
            >/dev/null 2>&1 || true
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
