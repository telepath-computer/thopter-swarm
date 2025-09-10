#!/bin/bash
# Destroy Metadata Service - Removes the Redis metadata service from fly.io

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
REDIS="📊"

echo -e "${BLUE}${REDIS} Thopter Swarm Metadata Service Destruction${NC}"
echo "=============================================="
echo ""

# Change to script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Source environment variables
if [ ! -f ".env" ]; then
    echo -e "${RED}${CROSS} .env file not found. Run fly/preflight.sh first${NC}"
    exit 1
fi

source .env

echo -e "${INFO} App: $APP_NAME"
echo ""

# Check if metadata machine exists
echo "1. Checking for metadata machine..."
METADATA_ID=$(fly machines list --json | jq -r '.[] | select(.name=="metadata") | .id' | head -n 1)
if [ -n "$METADATA_ID" ] && [ "$METADATA_ID" != "null" ]; then
    echo -e "${INFO} Found metadata service: $METADATA_ID"
    
    # Stop the machine if it's running
    METADATA_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$METADATA_ID\") | .state")
    echo -e "${INFO} Metadata service state: $METADATA_STATE"
    
    if [ "$METADATA_STATE" = "started" ]; then
        echo -e "${INFO} Stopping metadata service..."
        fly machine stop $METADATA_ID
        echo -e "${CHECK} Metadata service stopped"
        
        # Wait a moment for stop to complete
        sleep 3
    fi
    
    # Destroy the machine
    echo -e "${INFO} Destroying metadata service machine..."
    fly machine destroy $METADATA_ID --force
    echo -e "${CHECK} Metadata service machine destroyed"
    
else
    echo -e "${INFO} No metadata service found - nothing to destroy"
fi

echo ""

#### # Remove the METADATA_SERVICE_HOST secret
#### echo "2. Removing METADATA_SERVICE_HOST secret..."
#### if fly secrets list --json | jq -e '.[] | select(.Name=="METADATA_SERVICE_HOST")' > /dev/null 2>&1; then
####     fly secrets unset METADATA_SERVICE_HOST
####     echo -e "${CHECK} METADATA_SERVICE_HOST secret removed"
#### else
####     echo -e "${INFO} METADATA_SERVICE_HOST secret not found - nothing to remove"
#### fi

echo ""
echo -e "${GREEN}${CHECK} Metadata service destruction complete!${NC}"
