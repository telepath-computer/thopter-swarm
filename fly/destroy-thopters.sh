#!/bin/bash

# Cleanup script to destroy all thopter machines and optionally volumes
#
# Usage:
#   ./cleanup-thopters.sh           # Clean up machines only
#   ./cleanup-thopters.sh --volumes # Clean up machines AND volumes

set -e

# Parse command line arguments
CLEANUP_VOLUMES=false
for arg in "$@"; do
    case $arg in
        --volumes)
            CLEANUP_VOLUMES=true
            shift
            ;;
        *)
            echo "Usage: $0 [--volumes]"
            echo "  --volumes: Also clean up thopter volumes (not default)"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 Thopter Cleanup Script${NC}"
echo "=================================="
echo ""

# Get all thopter machines
echo "1. Finding thopter machines..."
THOPTER_MACHINES=$(fly machines list --json | jq -r '.[] | select(.name | startswith("thopter")) | .id')

if [ -z "$THOPTER_MACHINES" ]; then
    echo -e "${GREEN}✅ No thopter machines found${NC}"
else
    echo -e "${YELLOW}Found thopter machines:${NC}"
    echo "$THOPTER_MACHINES"
    echo ""
    
    echo "2. Destroying thopter machines..."
    for machine_id in $THOPTER_MACHINES; do
        echo -e "${YELLOW}Destroying machine: $machine_id${NC}"
        
        # Try to stop first, ignore errors
        fly machine stop $machine_id 2>/dev/null || echo "  (machine already stopped or error stopping)"
        
        # Destroy with force
        fly machine destroy $machine_id --force
        echo -e "${GREEN}✅ Destroyed: $machine_id${NC}"
    done
fi

echo ""

# Volume cleanup (only if --volumes flag is specified)
if [ "$CLEANUP_VOLUMES" = true ]; then
    echo "3. Finding thopter_data volumes..."
    # Fix: Look for volumes with name exactly "thopter_data" (the pool name)
    THOPTER_VOLUMES=$(fly volumes list --json | jq -r '.[] | select(.name == "thopter_data") | .id')

    if [ -z "$THOPTER_VOLUMES" ]; then
        echo -e "${GREEN}✅ No thopter_data volumes found${NC}"
    else
        echo -e "${YELLOW}Found thopter_data volumes:${NC}"
        fly volumes list --json | jq -r '.[] | select(.name == "thopter_data") | "\(.id) - \(.name) - attached: \(.attached_machine_id // "none")"'
        echo ""
        
        echo "4. Destroying thopter_data volumes..."
        for volume_id in $THOPTER_VOLUMES; do
            echo -e "${YELLOW}Destroying volume: $volume_id${NC}"
            fly volume destroy $volume_id -y
            echo -e "${GREEN}✅ Destroyed: $volume_id${NC}"
        done
    fi
else
    echo "3. Skipping volume cleanup (use --volumes flag to include)"
fi

echo ""
echo "=================================="
echo -e "${GREEN}🧹 Cleanup completed!${NC}"
echo ""

# Check for any remaining thopter resources that might be dangling
echo "📊 Final Resource Report:"
echo "========================"

# Check for remaining thopter machines
REMAINING_THOPTERS=$(fly machines list --json | jq -r '.[] | select(.name | startswith("thopter")) | .id' 2>/dev/null || echo "")
if [ -n "$REMAINING_THOPTERS" ]; then
    echo -e "${YELLOW}⚠️  Remaining thopter machines (may be stuck):${NC}"
    fly machines list --json | jq -r '.[] | select(.name | startswith("thopter")) | "  \(.id) - \(.name) (\(.state))"'
    echo ""
fi

# Check for remaining thopter_data volumes
REMAINING_VOLUMES=$(fly volumes list --json | jq -r '.[] | select(.name == "thopter_data") | .id' 2>/dev/null || echo "")
if [ -n "$REMAINING_VOLUMES" ]; then
    echo -e "${YELLOW}⚠️  Remaining thopter_data volumes:${NC}"
    fly volumes list --json | jq -r '.[] | select(.name == "thopter_data") | "  \(.id) - attached: \(.attached_machine_id // "none")"'
    echo ""
    echo -e "${BLUE}💡 If volumes show as attached to non-existent machines:${NC}"
    echo "   This is likely a fly.io state propagation delay."
    echo "   Try running the cleanup again in a few minutes."
    echo ""
fi

if [ -n "$REMAINING_THOPTERS" ] || [ -n "$REMAINING_VOLUMES" ]; then
    echo ""
    echo -e "${YELLOW}📝 TODO: Improve cleanup script to handle fly.io state propagation delays${NC}"
    echo "   - Add proper volume detachment waiting logic"
    echo "   - Add retry mechanism for stuck resources"
    echo "   - Handle eventual consistency in fly.io API responses"
fi
