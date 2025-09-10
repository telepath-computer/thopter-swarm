#!/bin/bash

# Destroy Hub - Removes the Thopter Swarm Hub from fly.io
# This script safely destroys the hub machine and optionally its volume

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
BOOM="💥"

echo -e "${RED}${BOOM} Thopter Swarm Hub Destruction${NC}"
echo "========================================"
echo ""

# Change to script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Source environment variables
if [ -f ".env" ]; then
    source .env
fi

# Check if hub exists
echo "1. Checking for existing hub machine..."
if ! fly machines list --json | jq -e '.[] | select(.name=="hub")' > /dev/null 2>&1; then
    echo -e "${INFO} No hub machine found"
    exit 0
fi

HUB_ID=$(fly machines list --json | jq -r '.[] | select(.name=="hub") | .id')
HUB_STATE=$(fly machines list --json | jq -r '.[] | select(.name=="hub") | .state')

echo -e "${WARNING} Found hub machine: $HUB_ID (state: $HUB_STATE)"
echo ""
echo "⚠️  WARNING: This will destroy the hub machine!"
echo ""
echo "Options:"
echo "1. Cancel (exit)"
echo "2. Destroy hub machine"
echo ""
read -p "Choose option (1 or 2): " choice

case $choice in
    1)
        echo -e "${INFO} Operation cancelled"
        exit 0
        ;;
    2)
        # Proceed with destruction
        ;;
    *)
        echo -e "${RED}${CROSS} Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""

# Stop hub if running
if [ "$HUB_STATE" = "started" ]; then
    echo "2. Stopping hub machine..."
    fly machine stop $HUB_ID
    
    echo "Waiting for hub to stop..."
    for i in {1..10}; do
        CURRENT_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$HUB_ID\") | .state")
        if [ "$CURRENT_STATE" = "stopped" ]; then
            echo -e "${CHECK} Hub machine stopped"
            break
        fi
        echo "Waiting for stop... ($i/10)"
        sleep 2
    done
    
    # Check if it actually stopped
    FINAL_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$HUB_ID\") | .state")
    if [ "$FINAL_STATE" != "stopped" ]; then
        echo -e "${WARNING} Hub didn't stop cleanly (state: $FINAL_STATE), forcing destruction..."
    fi
else
    echo "2. Hub machine is already stopped"
fi

echo ""

# Destroy hub machine
echo "3. Destroying hub machine..."
fly machine destroy $HUB_ID --force

if [ $? -eq 0 ]; then
    echo -e "${CHECK} Hub machine destroyed successfully"
else
    echo -e "${RED}${CROSS} Failed to destroy hub machine${NC}"
    exit 1
fi


echo ""
echo "========================================"
echo -e "${GREEN}${BOOM} Hub Destruction Complete!${NC}"
echo "========================================"
echo ""

echo -e "${GREEN}Cleaned up:${NC}"
echo "  ✓ Hub machine destroyed"
echo ""
echo -e "${GREEN}Result: Hub destroyed - you can run fly/recreate-hub.sh to recreate${NC}"

echo ""