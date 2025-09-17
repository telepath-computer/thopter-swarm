#!/bin/bash

# Upload post-checkout.sh to Hub
# This script uploads the post-checkout.sh file to the hub's data volume
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

echo -e "${BLUE}🚁 Thopter Post-Checkout Script Upload${NC}"
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

# Check if post-checkout.sh exists
if [ ! -f "post-checkout.sh" ]; then
    echo -e "${YELLOW}${WARNING} post-checkout.sh file not found${NC}"
    echo -e "${INFO} This file is optional. Create it if you need to run custom commands after repository checkout."
    echo ""
    echo "Example post-checkout.sh content:"
    echo "  #!/bin/bash"
    echo "  # This script runs after git checkout in thopters"
    echo "  echo 'Running post-checkout setup...'"
    echo "  npm install"
    echo "  # Add any custom setup commands here"
    echo ""
    exit 0
fi

# Validate post-checkout.sh file format
echo "1. Validating post-checkout.sh file..."

# Check if file is executable or can be made executable
if [ ! -r "post-checkout.sh" ]; then
    echo -e "${RED}${CROSS} post-checkout.sh file is not readable${NC}"
    exit 1
fi

# Basic validation - check if it's a shell script
if ! head -n1 "post-checkout.sh" | grep -q "^#!.*sh"; then
    echo -e "${YELLOW}${WARNING} post-checkout.sh does not start with a shebang (#!/bin/bash or #!/bin/sh)${NC}"
    echo -e "${INFO} Consider adding #!/bin/bash as the first line for better compatibility"
fi

echo -e "${CHECK} post-checkout.sh file is valid"

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
echo "3. Uploading post-checkout.sh to hub..."

# Create directory on hub if it doesn't exist
fly ssh console --machine $HUB_MACHINE -C "mkdir -p /tmp/thopter" 2>/dev/null || true

# Delete existing file first (sftp won't replace files)
fly ssh console --machine $HUB_MACHINE -C "rm -f /tmp/thopter/post-checkout.sh" 2>/dev/null || true

# Upload the file using sftp
echo "put post-checkout.sh /tmp/thopter/post-checkout.sh" | fly ssh sftp shell --machine $HUB_MACHINE

if [ $? -eq 0 ]; then
    echo -e "${CHECK} post-checkout.sh uploaded successfully"
else
    echo -e "${RED}${CROSS} Failed to upload post-checkout.sh${NC}"
    exit 1
fi

# Set permissions
echo ""
echo "4. Setting file permissions..."
fly ssh console --machine $HUB_MACHINE -C "chmod 755 /tmp/thopter/post-checkout.sh"
echo -e "${CHECK} Permissions set"

# Verify the file
echo ""
echo "5. Verifying upload..."
FILE_SIZE=$(fly ssh console --machine $HUB_MACHINE -C "stat -c%s /tmp/thopter/post-checkout.sh" 2>/dev/null)
LOCAL_SIZE=$(stat -f%z post-checkout.sh 2>/dev/null || stat -c%s post-checkout.sh 2>/dev/null)

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
echo -e "${INFO} The post-checkout.sh script has been uploaded to the hub."
echo -e "${INFO} New thopters will automatically execute this script after repository checkout."
echo ""
echo -e "${YELLOW}${WARNING} Remember:${NC}"
echo "  - The script runs as the thopter user with the repository as working directory"
echo "  - Output is captured to /thopter/log"
echo "  - Script failure will not prevent Claude from launching"
echo "  - Update the script on hub by running this script again"
echo ""
