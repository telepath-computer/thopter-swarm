#!/bin/bash

# Recreate Golden Claude - Provisions golden claude instances on fly.io
# These are persistent thopter instances used for Claude authentication and credential management
# 
# Usage:
#   ./recreate-gc.sh           # (re-)creates gc-default
#   ./recreate-gc.sh josh      # (re-)creates gc-josh

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

echo -e "${BLUE}🏆 Golden Claude Provisioning${NC}"
echo "========================================"
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

# Unset sensitive hub-only secrets to prevent accidental leakage to thopters
unset FLY_DEPLOY_KEY

# Get Golden Claude name from first argument (default: "default")
# Handle both "josh" and "gc-josh" formats - normalize to just the name part
RAW_ARG="${1:-default}"
if [[ "$RAW_ARG" =~ ^gc- ]]; then
    GC_NAME="${RAW_ARG#gc-}"  # Remove "gc-" prefix if present
else
    GC_NAME="$RAW_ARG"
fi

# Required variables for this script
REQUIRED_VARS=(
    "APP_NAME"
    "REGION"
    "WEB_TERMINAL_PORT"
    "HUB_STATUS_PORT"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}${CROSS} Environment variable $var is not set${NC}"
        exit 1
    fi
done

# Create machine name from argument
GC_MACHINE_NAME="gc-$GC_NAME"

echo -e "${INFO} App: $APP_NAME, Region: $REGION"
echo -e "${INFO} Golden Claude: $GC_NAME (machine: $GC_MACHINE_NAME)"
echo ""

# Validate golden claude name for DNS compatibility
if ! echo "$GC_NAME" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'; then
    echo -e "${RED}${CROSS} Golden Claude name '$GC_NAME' is not DNS compatible${NC}"
    echo "Requirements:"
    echo "  - Must start and end with alphanumeric character"
    echo "  - Can contain lowercase letters, numbers, and hyphens"
    echo "  - Cannot start or end with hyphen"
    echo "  - Examples: 'josh', 'team1', 'dev-env'"
    exit 1
fi

# Additional length check (DNS labels max 63 chars, but fly machine names should be shorter)
if [ ${#GC_NAME} -gt 32 ]; then
    echo -e "${RED}${CROSS} Golden Claude name '$GC_NAME' is too long (max 32 characters)${NC}"
    exit 1
fi

# Check if golden claude already exists
echo "1. Checking for existing golden claude machine..."
if fly machines list --json | jq -e ".[] | select(.name==\"$GC_MACHINE_NAME\")" > /dev/null 2>&1; then
    GC_ID=$(fly machines list --json | jq -r ".[] | select(.name==\"$GC_MACHINE_NAME\") | .id")
    GC_STATE=$(fly machines list --json | jq -r ".[] | select(.name==\"$GC_MACHINE_NAME\") | .state")
    echo -e "${WARNING} Golden Claude machine already exists: $GC_ID (state: $GC_STATE)"
    echo ""
    echo "Options:"
    echo "1. Keep existing golden claude (exit)"
    echo "2. Destroy and recreate golden claude"
    echo ""
    read -p "Choose option (1 or 2): " choice
    
    case $choice in
        1)
            echo -e "${INFO} Keeping existing golden claude machine"
            exit 0
            ;;
        2)
            echo -e "${WARNING} Destroying existing golden claude machine..."
            if [ "$GC_STATE" = "started" ]; then
                fly machine stop $GC_ID
                echo "Waiting for golden claude to stop..."
                sleep 5
            fi
            fly machine destroy $GC_ID --force
            echo -e "${CHECK} Golden Claude machine destroyed"
            ;;
        *)
            echo -e "${RED}${CROSS} Invalid choice${NC}"
            exit 1
            ;;
    esac
else
    echo -e "${CHECK} No existing golden claude machine found"
fi

# Ensure metadata service exists and is configured
echo "2. Ensuring metadata service is provisioned..."
./fly/ensure-metadata.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to provision metadata service${NC}"
    exit 1
fi

echo ""

# Build thopter image using separate build script
echo "3. Building thopter image..."
./fly/build-thopter.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to build thopter image${NC}"
    exit 1
fi

# Get the latest thopter image from metadata service
echo -e "${INFO} Retrieving thopter image from metadata service..."
METADATA_SERVICE_HOST=1.redis.kv._metadata.${APP_NAME}.internal
if redis-cli -h $METADATA_SERVICE_HOST -t 10 ping >/dev/null 2>&1; then
    THOPTER_IMAGE=$(redis-cli -h $METADATA_SERVICE_HOST HGET metadata THOPTER_IMAGE)
    if [ -z "$THOPTER_IMAGE" ]; then
        echo -e "${RED}${CROSS} Could not retrieve thopter image from metadata service${NC}"
        exit 1
    fi
    echo -e "${CHECK} Retrieved thopter image: $THOPTER_IMAGE"
else
    echo -e "${RED}${CROSS} Could not connect to metadata service${NC}"
    exit 1
fi

echo ""

# Create golden claude volume with specific name
echo "4. Ensuring golden claude volume exists..."
# Convert hyphens to underscores for volume names (fly.io requirement)
GC_VOLUME_NAME="gc_volume_$(echo "$GC_NAME" | tr '-' '_')"
if ! fly volumes list --json | jq -e ".[] | select(.name==\"$GC_VOLUME_NAME\")" > /dev/null 2>&1; then
    echo -e "${INFO} Creating golden claude volume: $GC_VOLUME_NAME"
    fly volume create --size 10 "$GC_VOLUME_NAME" --region $REGION -y
    echo -e "${CHECK} Golden claude volume created: $GC_VOLUME_NAME"
else
    echo -e "${CHECK} Golden claude volume already exists: $GC_VOLUME_NAME"
fi

echo ""

echo "5. Skipping hub dependency - observer gets hub info from metadata service..."
echo -e "${CHECK} Thopter will connect to hub via metadata service"

# Launch golden claude machine
echo "5. Launching golden claude machine..."
echo -e "${ROCKET} Starting golden claude with image: $THOPTER_IMAGE"

# Golden Claudes bypass the firewall to allow Claude Code to self-update
# and potentially access other needed services
GOLDEN_CLAUDE_SKIP_FIREWALL="I_UNDERSTAND"

# Restricted environment variables for thopters (no sensitive hub secrets)
fly machine run $THOPTER_IMAGE \
    --name $GC_MACHINE_NAME \
    --vm-size=shared-cpu-2x \
    --autostop=off \
    --volume $GC_VOLUME_NAME:/data \
    --region $REGION \
    --env METADATA_SERVICE_HOST="$METADATA_SERVICE_HOST" \
    --env APP_NAME="$APP_NAME" \
    --env HUB_STATUS_PORT="$HUB_STATUS_PORT" \
    --env WEB_TERMINAL_PORT="$WEB_TERMINAL_PORT" \
    --env GITHUB_REPOS="$GITHUB_REPOS" \
    --env GIT_USER_NAME="$GIT_USER_NAME" \
    --env GIT_USER_EMAIL="$GIT_USER_EMAIL" \
    --env ALLOWED_DOMAINS="$ALLOWED_DOMAINS" \
    --env DANGEROUSLY_SKIP_FIREWALL="$DANGEROUSLY_SKIP_FIREWALL"

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to launch golden claude machine${NC}"
    exit 1
fi

# Get golden claude machine ID
GC_ID=$(fly machines list --json | jq -r ".[] | select(.name==\"$GC_MACHINE_NAME\") | .id")

echo -e "${CHECK} Golden Claude machine launched successfully"
echo -e "${INFO} Golden Claude ID: $GC_ID"

echo ""

# Wait for golden claude to be ready
echo "6. Waiting for golden claude to be ready..."
echo -e "${INFO} Checking if gotty web terminal is running..."

# Wait up to 60 seconds for the golden claude to start
READY=false
for i in {1..12}; do
    # Check if gotty is responding with a 200 status code
    if fly ssh console --machine $GC_ID -C "curl -s -o /dev/null -w '%{http_code}' http://localhost:$WEB_TERMINAL_PORT/" 2>/dev/null | grep -q "200"; then
        echo -e "${CHECK} Golden Claude web terminal is ready (HTTP 200)"
        READY=true
        break
    fi
    echo "Waiting for golden claude to start... ($i/12)"
    sleep 5
done

if [ "$READY" = false ]; then
    echo -e "${WARNING} Golden Claude web terminal health check timed out"
fi

echo ""
echo "========================================"
echo -e "${GREEN}${ROCKET} Golden Claude Deployment Complete!${NC}"
echo "========================================"
echo ""
echo -e "${GREEN}Golden Claude Details:${NC}"
echo "  Machine ID: $GC_ID"
echo "  Machine Name: $GC_MACHINE_NAME"
echo "  Image: $THOPTER_IMAGE"
echo "  VM Size: shared-cpu-2x"
echo "  Region: $REGION"
echo ""
echo -e "${GREEN}Access URLs (via Wireguard):${NC}"
echo "  Web Terminal: http://$GC_ID.vm.$APP_NAME.internal:$WEB_TERMINAL_PORT/"
echo "  SSH Console: fly ssh console --machine $GC_ID"
echo ""
echo -e "${GREEN}Setup Instructions:${NC}"
echo "Access the web terminal and set up Claude authentication:"
echo "   - Run: yolo-claude (an alias for claude --dangerously-skip-permissions)"
echo "     (the yolo flag is important or it wont be pre-approved in agents!)"
echo "   - Login using Claude's UI"
echo "   - Accept all safety checks and autonomous operation prompts"
echo ""
