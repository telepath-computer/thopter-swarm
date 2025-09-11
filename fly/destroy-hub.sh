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

# Check for hub machines
echo "1. Checking for existing hub machines..."
HUB_MACHINES=$(fly machines list --json | jq -r '.[] | select(.name | startswith("hub-")) | .name' 2>/dev/null || echo "")
HUB_COUNT=$(echo "$HUB_MACHINES" | grep -c . 2>/dev/null || echo "0")

if [ "$HUB_COUNT" -eq 0 ]; then
    echo -e "${INFO} No hub machines found"
    exit 0
fi

echo -e "${WARNING} Found $HUB_COUNT hub machine(s):"
echo "$HUB_MACHINES" | while read -r hub_name; do
    if [ -n "$hub_name" ]; then
        HUB_ID=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .id')
        HUB_STATE=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .state')
        echo -e "  ${INFO} $hub_name ($HUB_ID) - state: $HUB_STATE"
    fi
done
echo ""
echo "⚠️  WARNING: This will destroy ALL hub machines!"
echo ""
echo "Options:"
echo "1. Cancel (exit)"
echo "2. Destroy hub machines only (keep volume and data)"
echo "3. Destroy hub machines AND volume (delete all data)"
echo ""
read -p "Choose option (1, 2, or 3): " choice

case $choice in
    1)
        echo -e "${INFO} Operation cancelled"
        exit 0
        ;;
    2)
        DESTROY_VOLUME=false
        ;;
    3)
        DESTROY_VOLUME=true
        echo -e "${RED}${WARNING} This will permanently delete all hub data!${NC}"
        read -p "Are you sure? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo -e "${INFO} Operation cancelled"
            exit 0
        fi
        ;;
    *)
        echo -e "${RED}${CROSS} Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""

# Stop and destroy all hub machines
echo "2. Processing hub machines..."
DESTROYED_COUNT=0
FAILED_COUNT=0

echo "$HUB_MACHINES" | while read -r hub_name; do
    if [ -n "$hub_name" ]; then
        HUB_ID=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .id')
        HUB_STATE=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .state')
        
        echo "  Processing $hub_name ($HUB_ID)..."
        
        # Stop if running
        if [ "$HUB_STATE" = "started" ]; then
            echo "    Stopping machine..."
            if fly machine stop $HUB_ID; then
                echo "    Waiting for stop..."
                for i in {1..10}; do
                    CURRENT_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$HUB_ID\") | .state" 2>/dev/null || echo "destroyed")
                    if [ "$CURRENT_STATE" = "stopped" ] || [ "$CURRENT_STATE" = "destroyed" ]; then
                        break
                    fi
                    echo "    Waiting for stop... ($i/10)"
                    sleep 2
                done
            else
                echo -e "    ${WARNING} Failed to stop cleanly, will force destroy"
            fi
        fi
        
        # Destroy machine
        echo "    Destroying machine..."
        if fly machine destroy $HUB_ID --force; then
            echo -e "    ${CHECK} $hub_name destroyed successfully"
            DESTROYED_COUNT=$((DESTROYED_COUNT + 1))
        else
            echo -e "    ${RED}${CROSS} Failed to destroy $hub_name${NC}"
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
        
        echo ""
    fi
done

# Final status outside the subshell
HUB_REMAINING=$(fly machines list --json | jq '[.[] | select(.name | startswith("hub-"))] | length' 2>/dev/null || echo "0")
if [ "$HUB_REMAINING" -eq 0 ]; then
    echo -e "${CHECK} All hub machines destroyed successfully"
else
    echo -e "${RED}${CROSS} $HUB_REMAINING hub machines still remain${NC}"
    exit 1
fi

# Handle volume destruction if requested
if [ "$DESTROY_VOLUME" = true ]; then
    echo ""
    echo "3. Destroying hub volume..."
    HUB_VOLUME_NAME="hub_data"
    
    # Check if hub volume exists
    EXISTING_HUB_VOLUME=$(fly volumes list --json 2>/dev/null | jq -r --arg name "$HUB_VOLUME_NAME" '.[] | select(.name==$name) | .id' | head -n1)
    
    if [ -n "$EXISTING_HUB_VOLUME" ]; then
        echo -e "${INFO} Found hub volume: $HUB_VOLUME_NAME ($EXISTING_HUB_VOLUME)"
        echo "  Destroying volume..."
        
        if fly volume destroy $EXISTING_HUB_VOLUME -y; then
            echo -e "${CHECK} Hub volume destroyed successfully"
        else
            echo -e "${RED}${CROSS} Failed to destroy hub volume${NC}"
            exit 1
        fi
    else
        echo -e "${INFO} No hub volume found (already destroyed or never created)"
    fi
fi

echo ""
echo "========================================"
echo -e "${GREEN}${BOOM} Hub Destruction Complete!${NC}"
echo "========================================"
echo ""

echo -e "${GREEN}Cleaned up:${NC}"
echo "  ✓ All hub machines destroyed"
if [ "$DESTROY_VOLUME" = true ]; then
    echo "  ✓ Hub volume destroyed"
fi
echo ""
echo -e "${GREEN}Result: Hub destroyed - you can run fly/recreate-hub.sh to recreate${NC}"

echo ""