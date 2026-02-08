#!/usr/bin/env bash
# Post-tool-use hook: signal that Claude is actively working.
# Touching a file is zero-cost; the heartbeat cron checks mtime
# and calls Runloop keepalive when appropriate.
touch /tmp/thopter-active
