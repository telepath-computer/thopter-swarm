#!/usr/bin/env bash
# Install heartbeat cron entry and ensure cron is running.
# Idempotent: safe to run multiple times.

set -e

# Start cron daemon if not running
sudo /usr/sbin/cron 2>/dev/null || true

# Install crontab (once per minute; heartbeat script loops internally every 10s)
# First get existing entries (minus ours), then append ours
EXISTING=$(crontab -l 2>/dev/null | grep -v thopter-heartbeat || true)
{
  [ -n "$EXISTING" ] && echo "$EXISTING"
  echo "* * * * * /usr/local/bin/thopter-heartbeat"
} | crontab -

echo "Cron installed:"
crontab -l
