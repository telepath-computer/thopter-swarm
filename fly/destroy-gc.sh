#!/bin/bash

# Destroy Golden Claude - Removes golden claude instances from fly.io
# This script safely destroys golden claude machines and optionally their volumes

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

echo -e "${RED}${BOOM} Golden Claude Destruction${NC}"
echo "========================================"
echo ""

# Change to script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Source environment variables
if [ -f ".env" ]; then
    source .env
fi

# Find existing golden claude machines
echo "1. Scanning for golden claude machines..."
EXISTING_GCs=()

# Look for all gc-* machines
while IFS= read -r machine_info; do
    if [ -n "$machine_info" ]; then
        MACHINE_ID=$(echo "$machine_info" | cut -d'|' -f1)
        MACHINE_NAME=$(echo "$machine_info" | cut -d'|' -f2)
        MACHINE_STATE=$(echo "$machine_info" | cut -d'|' -f3)
        
        EXISTING_GCs+=("$MACHINE_NAME:$MACHINE_ID:$MACHINE_STATE")
        echo -e "  Found: $MACHINE_NAME ($MACHINE_ID) - $MACHINE_STATE"
    fi
done < <(fly machines list --json | jq -r '.[] | select(.name and (.name | startswith("gc-"))) | "\(.id)|\(.name)|\(.state)"' 2>/dev/null || true)

if [ ${#EXISTING_GCs[@]} -eq 0 ]; then
    echo -e "${INFO} No golden claude machines found"
    exit 0
fi

echo -e "${WARNING} Found ${#EXISTING_GCs[@]} golden claude machine(s):"
for gc_info in "${EXISTING_GCs[@]}"; do
    GC_NAME=$(echo "$gc_info" | cut -d':' -f1)
    GC_ID=$(echo "$gc_info" | cut -d':' -f2) 
    GC_STATE=$(echo "$gc_info" | cut -d':' -f3)
    echo "  - $GC_NAME ($GC_ID) - state: $GC_STATE"
done

echo ""
echo "⚠️  WARNING: This will destroy golden claude machines and their authentication data!"
echo ""
echo "Options:"
echo "1. Cancel (exit)"
echo "2. Destroy golden claude machines only (keep volumes)"
echo "3. Destroy golden claude machines AND their paired volumes (complete cleanup)"
echo ""
read -p "Choose option (1, 2, or 3): " choice

case $choice in
    1)
        echo -e "${INFO} Operation cancelled"
        exit 0
        ;;
    2)
        DESTROY_VOLUMES=false
        ;;
    3)
        DESTROY_VOLUMES=true
        ;;
    *)
        echo -e "${RED}${CROSS} Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""

# Stop and destroy golden claude machines
for gc_info in "${EXISTING_GCs[@]}"; do
    GC_NAME=$(echo "$gc_info" | cut -d':' -f1)
    GC_ID=$(echo "$gc_info" | cut -d':' -f2) 
    GC_STATE=$(echo "$gc_info" | cut -d':' -f3)
    
    echo "2. Processing golden claude: $GC_NAME ($GC_ID)"
    
    # Stop machine if running
    if [ "$GC_STATE" = "started" ]; then
        echo "   Stopping machine..."
        fly machine stop $GC_ID
        
        echo "   Waiting for stop..."
        for i in {1..10}; do
            CURRENT_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$GC_ID\") | .state")
            if [ "$CURRENT_STATE" = "stopped" ]; then
                echo -e "   ${CHECK} Machine stopped"
                break
            fi
            echo "   Waiting for stop... ($i/10)"
            sleep 2
        done
        
        # Check if it actually stopped
        FINAL_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$GC_ID\") | .state")
        if [ "$FINAL_STATE" != "stopped" ]; then
            echo -e "   ${WARNING} Machine didn't stop cleanly (state: $FINAL_STATE), forcing destruction..."
        fi
    else
        echo "   Machine is already stopped"
    fi
    
    # Destroy machine
    echo "   Destroying machine..."
    fly machine destroy $GC_ID --force
    
    if [ $? -eq 0 ]; then
        echo -e "   ${CHECK} Golden claude $GC_NAME destroyed successfully"
    else
        echo -e "   ${RED}${CROSS} Failed to destroy golden claude $GC_NAME${NC}"
    fi
    
    echo ""
done

# Handle volume destruction
if [ "$DESTROY_VOLUMES" = true ]; then
    echo "3. Destroying paired Golden Claude volumes..."
    
    # Destroy volumes for each Golden Claude
    for gc_info in "${EXISTING_GCs[@]}"; do
        GC_NAME=$(echo "$gc_info" | cut -d':' -f1)
        # Extract the name part (gc-josh -> josh) and convert to volume format
        GC_BASE_NAME=$(echo "$GC_NAME" | sed 's/^gc-//')
        GC_VOLUME_NAME="gc_volume_$(echo "$GC_BASE_NAME" | tr '-' '_')"
        
        echo "   Looking for volume: $GC_VOLUME_NAME"
        if fly volumes list --json | jq -e ".[] | select(.name==\"$GC_VOLUME_NAME\")" > /dev/null 2>&1; then
            VOLUME_ID=$(fly volumes list --json | jq -r ".[] | select(.name==\"$GC_VOLUME_NAME\") | .id")
            VOLUME_REGION=$(fly volumes list --json | jq -r ".[] | select(.name==\"$GC_VOLUME_NAME\") | .region")
            VOLUME_SIZE=$(fly volumes list --json | jq -r ".[] | select(.name==\"$GC_VOLUME_NAME\") | .size_gb")
            
            echo "   Found volume: $VOLUME_ID (${VOLUME_SIZE}GB in $VOLUME_REGION)"
            fly volumes destroy $VOLUME_ID --yes
            if [ $? -eq 0 ]; then
                echo -e "   ${CHECK} Volume $GC_VOLUME_NAME destroyed"
            else
                echo -e "   ${RED}${CROSS} Failed to destroy volume $GC_VOLUME_NAME${NC}"
                echo -e "   ${WARNING} You may need to destroy it manually: fly volumes destroy $VOLUME_ID"
            fi
        else
            echo -e "   ${INFO} No volume found for $GC_NAME"
        fi
    done
else
    echo "3. Keeping Golden Claude volumes (as requested)"
    for gc_info in "${EXISTING_GCs[@]}"; do
        GC_NAME=$(echo "$gc_info" | cut -d':' -f1)
        GC_BASE_NAME=$(echo "$GC_NAME" | sed 's/^gc-//')
        GC_VOLUME_NAME="gc_volume_$(echo "$GC_BASE_NAME" | tr '-' '_')"
        
        if fly volumes list --json | jq -e ".[] | select(.name==\"$GC_VOLUME_NAME\")" > /dev/null 2>&1; then
            VOLUME_ID=$(fly volumes list --json | jq -r ".[] | select(.name==\"$GC_VOLUME_NAME\") | .id")
            VOLUME_REGION=$(fly volumes list --json | jq -r ".[] | select(.name==\"$GC_VOLUME_NAME\") | .region")
            VOLUME_SIZE=$(fly volumes list --json | jq -r ".[] | select(.name==\"$GC_VOLUME_NAME\") | .size_gb")
            echo -e "   ${INFO} Preserved: $GC_VOLUME_NAME ($VOLUME_ID, ${VOLUME_SIZE}GB in $VOLUME_REGION)"
        fi
    done
fi

echo ""
echo "========================================"
echo -e "${GREEN}${BOOM} Golden Claude Destruction Complete!${NC}"
echo "========================================"
echo ""

if [ "$DESTROY_VOLUMES" = true ]; then
    echo -e "${GREEN}Cleaned up:${NC}"
    echo "  ✓ All golden claude machines destroyed"
    echo "  ✓ All golden_claude volumes destroyed"
    echo ""
    echo -e "${GREEN}Result: Complete cleanup - you can run fly/recreate-gc.sh to start fresh${NC}"
else
    echo -e "${GREEN}Cleaned up:${NC}"
    echo "  ✓ Golden claude machines destroyed"
    echo "  ⚠ golden_claude volumes preserved"
    echo ""
    echo -e "${GREEN}Result: Machines destroyed but volumes preserved - run fly/recreate-gc.sh to recreate${NC}"
fi

echo ""