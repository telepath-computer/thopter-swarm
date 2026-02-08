#!/usr/bin/env bash
# Cron target: source env vars and run heartbeat every 10s for 1 minute.
# Cron launches this once per minute; it loops 6 times internally.
# Installed to /usr/local/bin/thopter-heartbeat

. "$HOME/.bashrc" 2>/dev/null

for i in 1 2 3 4 5 6; do
    /usr/local/bin/thopter-status heartbeat >/dev/null 2>&1

    # Update last message from active Claude transcript
    TRANSCRIPT=$(cat /tmp/thopter-transcript-path 2>/dev/null)
    if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
        node /usr/local/bin/thopter-last-message "$TRANSCRIPT" | /usr/local/bin/thopter-status message 2>/dev/null || true
    fi

    [ "$i" -lt 6 ] && sleep 10
done
