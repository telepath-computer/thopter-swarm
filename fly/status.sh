#!/bin/bash

# Status - Shows current state of all thopter swarm resources
# Provides overview of hub, golden claudes, and active thopters

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
ROCKET="🚁"
STAR="🏆"
GEAR="⚙️"

echo -e "${BLUE}${ROCKET} Thopter Swarm Status${NC}"
echo "========================================"
echo ""

# Change to script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Source environment variables
if [ -f ".env" ]; then
    source .env
fi

# 1. Environment Overview
echo -e "${BLUE}Environment:${NC} ${APP_NAME:-unknown} (${REGION:-unknown})"

# 2. Metadata Service Status
echo ""
echo -e "${BLUE}Metadata Service:${NC}"
if fly machines list --json | jq -e '.[] | select(.name=="metadata")' > /dev/null 2>&1; then
    METADATA_ID=$(fly machines list --json | jq -r '.[] | select(.name=="metadata") | .id')
    METADATA_STATE=$(fly machines list --json | jq -r '.[] | select(.name=="metadata") | .state')
    METADATA_REGION=$(fly machines list --json | jq -r '.[] | select(.name=="metadata") | .region')
    
    if [ "$METADATA_STATE" = "started" ]; then
        echo -e "  ${CHECK} metadata ($METADATA_ID) running in $METADATA_REGION"
        echo -e "  ${GEAR} Redis: $METADATA_ID.vm.${APP_NAME:-thopter-swarm}.internal:6379"
        
        # Try to connect and show some metadata info
        if command -v redis-cli >/dev/null 2>&1; then
            METADATA_HOST="$METADATA_ID.vm.${APP_NAME}.internal"
            THOPTER_IMAGE=$(timeout 3s redis-cli -h "$METADATA_HOST" -p 6379 HGET metadata THOPTER_IMAGE 2>/dev/null || echo "")
            
            # Hub uses static service discovery - no need to store in metadata
            echo -e "  ${INFO} Hub service host: 1.hub.kv._metadata.${APP_NAME}.internal"
            if [ -n "$THOPTER_IMAGE" ] && [ "$THOPTER_IMAGE" != "(nil)" ]; then
                echo -e "  ${INFO} Thopter image: $THOPTER_IMAGE"
            fi
        else
            echo -e "  ${INFO} (redis-cli not available for metadata inspection)"
        fi
    else
        echo -e "  ${WARNING} metadata ($METADATA_ID) $METADATA_STATE in $METADATA_REGION"
    fi
else
    echo -e "  ${CROSS} No metadata service found - run fly/recreate-hub.sh"
fi

# 3. Hub Status
echo ""
echo -e "${BLUE}Hub Status:${NC}"
HUB_MACHINES=$(fly machines list --json | jq -r '.[] | select(.name | startswith("hub-")) | .name' 2>/dev/null || echo "")
HUB_COUNT=$(echo "$HUB_MACHINES" | grep -c . 2>/dev/null || echo "0")

if [ "$HUB_COUNT" -gt 1 ]; then
    echo -e "  ${WARNING} Found $HUB_COUNT hub machines (expected 1):"
    echo "$HUB_MACHINES" | while read -r hub_name; do
        if [ -n "$hub_name" ]; then
            HUB_ID=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .id')
            HUB_STATE=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .state')
            HUB_REGION=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .region')
            echo -e "    ${INFO} $hub_name ($HUB_ID) $HUB_STATE in $HUB_REGION"
        fi
    done
elif [ "$HUB_COUNT" -eq 1 ]; then
    HUB_NAME=$(echo "$HUB_MACHINES" | head -1)
    HUB_ID=$(fly machines list --json | jq -r --arg name "$HUB_NAME" '.[] | select(.name==$name) | .id')
    HUB_STATE=$(fly machines list --json | jq -r --arg name "$HUB_NAME" '.[] | select(.name==$name) | .state')
    HUB_IMAGE=$(fly machines list --json | jq -r --arg name "$HUB_NAME" '.[] | select(.name==$name) | .image_ref.tag' 2>/dev/null || echo "unknown")
    HUB_REGION=$(fly machines list --json | jq -r --arg name "$HUB_NAME" '.[] | select(.name==$name) | .region')
    
    if [ "$HUB_STATE" = "started" ]; then
        echo -e "  ${CHECK} hub ($HUB_ID) running in $HUB_REGION"
        echo -e "  ${GEAR} Dashboard: http://$HUB_ID.vm.${APP_NAME:-thopter-swarm}.internal:${HUB_PORT:-8080}/"
    else
        echo -e "  ${WARNING} hub ($HUB_ID) $HUB_STATE in $HUB_REGION"
    fi
    echo -e "  ${INFO} Image: $HUB_IMAGE"
else
    echo -e "  ${CROSS} No hub machine found - run fly/recreate-hub.sh"
fi

# 4. Platform App Machines (dummy processes for fly.io platform requirements)
echo ""
echo -e "${BLUE}Platform App Machines:${NC}"
FOUND_APP_MACHINES=false

while IFS= read -r machine_info; do
    if [ -n "$machine_info" ]; then
        FOUND_APP_MACHINES=true
        MACHINE_ID=$(echo "$machine_info" | cut -d'|' -f1)
        MACHINE_NAME=$(echo "$machine_info" | cut -d'|' -f2)
        MACHINE_STATE=$(echo "$machine_info" | cut -d'|' -f3)
        MACHINE_REGION=$(echo "$machine_info" | cut -d'|' -f4)
        
        if [ "$MACHINE_STATE" = "started" ]; then
            echo -e "  ${GEAR} $MACHINE_NAME ($MACHINE_ID) running in $MACHINE_REGION (flyio/hellofly dummy app)"
        else
            echo -e "  ${WARNING} $MACHINE_NAME ($MACHINE_ID) $MACHINE_STATE in $MACHINE_REGION (flyio/hellofly dummy app)"
        fi
    fi
done < <(fly machines list --json | jq -r '.[] | select(.config.env.FLY_PROCESS_GROUP == "app") | "\(.id)|\(.name)|\(.state)|\(.region)"' 2>/dev/null || true)

if [ "$FOUND_APP_MACHINES" = false ]; then
    echo -e "  ${INFO} No platform app machines found"
fi

# 6. Thopters (non-hub, non-gc machines)
echo ""
echo -e "${BLUE}Thopters:${NC}"
FOUND_THOPTERS=false

while IFS= read -r machine_name; do
    if [ -n "$machine_name" ]; then
        FOUND_THOPTERS=true
        THOPTER_ID=$(fly machines list --json | jq -r ".[] | select(.name==\"$machine_name\") | .id")
        THOPTER_STATE=$(fly machines list --json | jq -r ".[] | select(.name==\"$machine_name\") | .state")
        THOPTER_REGION=$(fly machines list --json | jq -r ".[] | select(.name==\"$machine_name\") | .region")
        
        if [ "$THOPTER_STATE" = "started" ]; then
            echo -e "  ${ROCKET} $machine_name ($THOPTER_ID) running in $THOPTER_REGION - http://$THOPTER_ID.vm.${APP_NAME:-thopter-swarm}.internal:${WEB_TERMINAL_PORT:-7681}/"
        else
            echo -e "  ${WARNING} $machine_name ($THOPTER_ID) $THOPTER_STATE in $THOPTER_REGION"
        fi
    fi
done < <(fly machines list --json | jq -r '.[] | select(.name | startswith("thopter-")) | .name' 2>/dev/null || true)

if [ "$FOUND_THOPTERS" = false ]; then
    echo -e "  ${INFO} No thopters running"
fi

# 7. Resource Summary
echo ""
echo -e "${BLUE}Resource Summary:${NC}"

# Count machines
TOTAL_MACHINES=$(fly machines list --json | jq '. | length' 2>/dev/null || echo "0")
HUB_COUNT=$(fly machines list --json | jq '[.[] | select(.name | startswith("hub-"))] | length' 2>/dev/null || echo "0")
METADATA_COUNT=$(fly machines list --json | jq '[.[] | select(.name=="metadata")] | length' 2>/dev/null || echo "0")
THOPTER_COUNT=$(fly machines list --json | jq '[.[] | select(.name | startswith("thopter-"))] | length' 2>/dev/null || echo "0")
APP_COUNT=$(fly machines list --json | jq '[.[] | select(.config.env.FLY_PROCESS_GROUP == "app")] | length' 2>/dev/null || echo "0")

echo -e "  ${INFO} Machines: $TOTAL_MACHINES total (hub: $HUB_COUNT, metadata: $METADATA_COUNT, thopters: $THOPTER_COUNT, platform: $APP_COUNT)"

# Check for unknown/unclassified machines
EXPECTED_COUNT=$((HUB_COUNT + METADATA_COUNT + THOPTER_COUNT + APP_COUNT))
if [ "$TOTAL_MACHINES" -gt "$EXPECTED_COUNT" ]; then
    UNKNOWN_COUNT=$((TOTAL_MACHINES - EXPECTED_COUNT))
    echo ""
    echo -e "${YELLOW}Unknown Machines (${UNKNOWN_COUNT}):${NC}"
    
    # Find machines that don't match any expected pattern
    while IFS= read -r machine_name; do
        if [ -n "$machine_name" ]; then
            MACHINE_ID=$(fly machines list --json | jq -r ".[] | select(.name==\"$machine_name\") | .id")
            MACHINE_STATE=$(fly machines list --json | jq -r ".[] | select(.name==\"$machine_name\") | .state")
            MACHINE_REGION=$(fly machines list --json | jq -r ".[] | select(.name==\"$machine_name\") | .region")
            
            if [ "$MACHINE_STATE" = "started" ]; then
                echo -e "  ${WARNING} $machine_name ($MACHINE_ID) running in $MACHINE_REGION"
            else
                echo -e "  ${WARNING} $machine_name ($MACHINE_ID) $MACHINE_STATE in $MACHINE_REGION"
            fi
        fi
    done < <(fly machines list --json | jq -r '.[] | select(.name != "hub" and .name != "metadata" and (.name | startswith("hub-") | not) and (.name | startswith("thopter-") | not) and (.config.env.FLY_PROCESS_GROUP != "app")) | .name' 2>/dev/null || true)
fi

echo ""

# Count volumes
ALL_VOLUMES=$(fly volumes list --json 2>/dev/null || echo "[]")
TOTAL_VOLUMES=$(echo "$ALL_VOLUMES" | jq '. | length' 2>/dev/null || echo "0")
METADATA_VOLUMES=$(echo "$ALL_VOLUMES" | jq '[.[] | select(.name=="metadata_redis")] | length' 2>/dev/null || echo "0")
HUB_VOLUMES=$(echo "$ALL_VOLUMES" | jq '[.[] | select(.name=="hub_data")] | length' 2>/dev/null || echo "0")
THOPTER_VOLUMES=$(echo "$ALL_VOLUMES" | jq '[.[] | select(.name=="thopter_data")] | length' 2>/dev/null || echo "0")


# Detailed thopter volume status
if [ "$THOPTER_VOLUMES" -gt 0 ]; then
    echo ""
    echo -e "${BLUE}Thopter Volume Pool Status:${NC}"
    
    # Count attached vs available volumes
    ATTACHED_VOLUMES=$(fly volumes list --json | jq '[.[] | select(.name=="thopter_data" and .attached_machine_id != null)] | length' 2>/dev/null || echo "0")
    AVAILABLE_VOLUMES=$(fly volumes list --json | jq '[.[] | select(.name=="thopter_data" and (.attached_machine_id == null or .attached_machine_id == ""))] | length' 2>/dev/null || echo "0")
    
    # Calculate total pool size
    THOPTER_POOL_SIZE=$(fly volumes list --json | jq '[.[] | select(.name=="thopter_data") | .size_gb] | add' 2>/dev/null || echo "0")
    
    echo -e "  ${INFO} Pool: $THOPTER_VOLUMES volumes, ${THOPTER_POOL_SIZE}GB total"
    echo -e "  ${INFO} Status: $ATTACHED_VOLUMES attached, $AVAILABLE_VOLUMES available"
    
    # Show any orphaned attachments (attached to non-existent machines)
    ORPHANED_COUNT=0
    while IFS= read -r attached_machine_id; do
        if [ -n "$attached_machine_id" ] && [ "$attached_machine_id" != "null" ]; then
            # Check if the attached machine actually exists
            if ! fly machines list --json | jq -e ".[] | select(.id==\"$attached_machine_id\")" > /dev/null 2>&1; then
                if [ "$ORPHANED_COUNT" -eq 0 ]; then
                    echo -e "  ${WARNING} Orphaned attachments (volumes attached to destroyed machines):"
                fi
                ORPHANED_COUNT=$((ORPHANED_COUNT + 1))
                VOLUME_ID=$(fly volumes list --json | jq -r ".[] | select(.name==\"thopter_data\" and .attached_machine_id==\"$attached_machine_id\") | .id")
                echo -e "    ${WARNING} Volume $VOLUME_ID attached to missing machine $attached_machine_id"
            fi
        fi
    done < <(fly volumes list --json | jq -r '.[] | select(.name=="thopter_data") | .attached_machine_id' 2>/dev/null | grep -v "^null$" || true)
    
    if [ "$ORPHANED_COUNT" -gt 0 ]; then
        echo -e "  ${INFO} Tip: Run './cleanup-thopters.sh --volumes' to clean up orphaned volumes"
    fi
fi

echo ""
echo "========================================"

# Volume Summary
if [ "$TOTAL_VOLUMES" -gt 0 ]; then
    TOTAL_SIZE=$(echo "$ALL_VOLUMES" | jq '[.[] | .size_gb] | add' 2>/dev/null || echo "0")
    echo -e "${GREEN}Volumes: $TOTAL_VOLUMES total, ${TOTAL_SIZE}GB (metadata: $METADATA_VOLUMES, hub: $HUB_VOLUMES, thopter_data: $THOPTER_VOLUMES)${NC}"

    # Check for unknown/unclassified volumes
    EXPECTED_VOLUME_COUNT=$((METADATA_VOLUMES + HUB_VOLUMES + THOPTER_VOLUMES))
    if [ "$TOTAL_VOLUMES" -gt "$EXPECTED_VOLUME_COUNT" ]; then
        UNKNOWN_VOLUME_COUNT=$((TOTAL_VOLUMES - EXPECTED_VOLUME_COUNT))
        echo -e "${YELLOW}Unknown Volumes (${UNKNOWN_VOLUME_COUNT}):${NC}"
        
        # Find volumes that don't match any expected pattern
        while IFS= read -r volume_info; do
            if [ -n "$volume_info" ]; then
                VOLUME_ID=$(echo "$volume_info" | cut -d'|' -f1)
                VOLUME_NAME=$(echo "$volume_info" | cut -d'|' -f2)
                VOLUME_SIZE=$(echo "$volume_info" | cut -d'|' -f3)
                VOLUME_REGION=$(echo "$volume_info" | cut -d'|' -f4)
                ATTACHED_MACHINE=$(echo "$volume_info" | cut -d'|' -f5)
                
                if [ "$ATTACHED_MACHINE" != "null" ] && [ -n "$ATTACHED_MACHINE" ]; then
                    echo -e "  ${WARNING} $VOLUME_NAME ($VOLUME_ID) ${VOLUME_SIZE}GB in $VOLUME_REGION - attached to $ATTACHED_MACHINE"
                else
                    echo -e "  ${WARNING} $VOLUME_NAME ($VOLUME_ID) ${VOLUME_SIZE}GB in $VOLUME_REGION - unattached"
                fi
            fi
        done < <(echo "$ALL_VOLUMES" | jq -r '.[] | select(.name != "metadata_redis" and .name != "hub_data" and .name != "thopter_data") | "\(.id)|\(.name)|\(.size_gb)|\(.region)|\(.attached_machine_id // "null")"' 2>/dev/null || true)
    fi
else
    echo -e "${YELLOW}No volumes found${NC}"
fi

echo ""
