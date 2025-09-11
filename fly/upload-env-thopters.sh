#!/bin/bash

# Upload .env.thopters to Hub
# This script uploads the .env.thopters file to the hub's data volume
# to be used when provisioning new thopters

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Emojis
CHECK="✅"
CROSS="❌"
WARNING="⚠️"
INFO="ℹ️"
ROCKET="🚀"

echo -e "${BLUE}🚁 Thopter Environment Variables Upload${NC}"
echo "========================================"
echo ""

# Change to script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Source environment variables for APP_NAME
if [ ! -f ".env" ]; then
    echo -e "${RED}${CROSS} .env file not found. Run fly/preflight.sh first${NC}"
    exit 1
fi

source .env

# Check if .env.thopters exists
if [ ! -f ".env.thopters" ]; then
    echo -e "${YELLOW}${WARNING} .env.thopters file not found${NC}"
    echo -e "${INFO} This file is optional. Create it if you need to set environment variables for thopters."
    echo ""
    echo "Example .env.thopters content:"
    echo "  ANTHROPIC_API_KEY=sk-ant-..."
    echo "  MY_DEV_API_TOKEN=..."
    echo "  NODE_ENV=development"
    echo ""
    exit 0
fi

# Validate .env.thopters file format
echo "1. Validating .env.thopters file..."

# Basic validation - check if it can be sourced
if ! bash -c "set -e; source .env.thopters" 2>/dev/null; then
    echo -e "${RED}${CROSS} .env.thopters file is not valid bash source format${NC}"
    echo -e "${INFO} The file should contain only KEY=value pairs, one per line"
    echo -e "${INFO} Comments starting with # are allowed"
    exit 1
fi

# Check for dangerous patterns
if grep -qE '(rm |sudo |eval |exec |source |\./)' .env.thopters; then
    echo -e "${RED}${CROSS} .env.thopters contains potentially dangerous commands${NC}"
    echo -e "${INFO} Only KEY=value pairs are allowed"
    exit 1
fi

echo -e "${CHECK} .env.thopters file is valid"

# Find the hub machine
echo ""
echo "2. Finding hub machine..."
HUB_MACHINE=$(fly machines list --json | jq -r '.[] | select(.name | startswith("hub-")) | .id' | head -n1)

if [ -z "$HUB_MACHINE" ]; then
    echo -e "${RED}${CROSS} No hub machine found. Run fly/recreate-hub.sh first${NC}"
    exit 1
fi

HUB_NAME=$(fly machines list --json | jq -r --arg id "$HUB_MACHINE" '.[] | select(.id==$id) | .name')
echo -e "${CHECK} Found hub: $HUB_NAME ($HUB_MACHINE)"

# Check hub is running
HUB_STATE=$(fly machines list --json | jq -r --arg id "$HUB_MACHINE" '.[] | select(.id==$id) | .state')
if [ "$HUB_STATE" != "started" ]; then
    echo -e "${RED}${CROSS} Hub is not running (state: $HUB_STATE)${NC}"
    exit 1
fi

# Upload the file to hub
echo ""
echo "3. Uploading .env.thopters to hub..."

# Create directory on hub if it doesn't exist
fly ssh console --machine $HUB_MACHINE -C "mkdir -p /data/thopter-env" 2>/dev/null || true

# Upload the file using sftp
echo "put .env.thopters /data/thopter-env/.env.thopters" | fly ssh sftp shell --machine $HUB_MACHINE

if [ $? -eq 0 ]; then
    echo -e "${CHECK} .env.thopters uploaded successfully"
else
    echo -e "${RED}${CROSS} Failed to upload .env.thopters${NC}"
    exit 1
fi

# Set permissions
echo ""
echo "4. Setting file permissions..."
fly ssh console --machine $HUB_MACHINE -C "chmod 644 /data/thopter-env/.env.thopters"
echo -e "${CHECK} Permissions set"

# Verify the file
echo ""
echo "5. Verifying upload..."
FILE_SIZE=$(fly ssh console --machine $HUB_MACHINE -C "stat -c%s /data/thopter-env/.env.thopters" 2>/dev/null)
LOCAL_SIZE=$(stat -f%z .env.thopters 2>/dev/null || stat -c%s .env.thopters 2>/dev/null)

if [ "$FILE_SIZE" = "$LOCAL_SIZE" ]; then
    echo -e "${CHECK} File uploaded correctly (size: $FILE_SIZE bytes)"
else
    echo -e "${WARNING} File sizes don't match (local: $LOCAL_SIZE, remote: $FILE_SIZE)"
fi

echo ""
echo "========================================"
echo -e "${GREEN}${ROCKET} Upload Complete!${NC}"
echo "========================================"
echo ""
echo -e "${INFO} The .env.thopters file has been uploaded to the hub."
echo -e "${INFO} New thopters will automatically receive these environment variables."
echo ""
echo -e "${YELLOW}${WARNING} Remember:${NC}"
echo "  - Never include sensitive production credentials"
echo "  - This file is for development environment variables only"
echo "  - Update the file on hub by running this script again"
echo ""