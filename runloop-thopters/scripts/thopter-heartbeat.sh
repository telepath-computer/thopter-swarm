#!/usr/bin/env bash
# Cron target: source env vars and run heartbeat.
# Installed to /usr/local/bin/thopter-heartbeat

. "$HOME/.bashrc" 2>/dev/null
/usr/local/bin/thopter-status heartbeat >/dev/null 2>&1
