#!/bin/bash

# Start Session Observer - Launches the session observer with PM2
# This script should be run as the thopter user

set -e

# Ensure logs directory exists with proper ownership
mkdir -p /data/thopter/logs
chown thopter:thopter /data/thopter/logs

# Agent ID will be auto-detected from hostname if not provided
AGENT_ID=${AGENT_ID:-$(hostname)}
if [ -z "$AGENT_ID" ]; then
    echo "ERROR: Could not determine AGENT_ID from hostname or environment"
    exit 1
fi

if [ -z "$METADATA_SERVICE_HOST" ]; then
    echo "ERROR: METADATA_SERVICE_HOST environment variable is required"  
    exit 1
fi

echo "Starting session observer..."
echo "Agent ID: $AGENT_ID"
echo "Metadata Service: $METADATA_SERVICE_HOST"
echo "Hub connection info will be retrieved from metadata service"

# Copy observer script to expected location
cp /usr/local/bin/observer.js /usr/local/bin/observer.js.bak 2>/dev/null || true
chmod +x /usr/local/bin/observer.js

# Start with PM2
pm2 start /usr/local/bin/pm2.config.js

echo "Session observer started with PM2"
echo "View logs: pm2 logs session-observer"
echo "Stop observer: pm2 stop session-observer"