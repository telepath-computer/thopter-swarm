#!/bin/bash

# Recreate Hub - Provisions the Thopter Swarm Hub on fly.io
# This script checks for an existing hub machine and creates one if needed
# 
# Usage:
#   ./recreate-hub.sh         # Interactive mode (prompts if hub exists)
#   ./recreate-hub.sh --force # Force recreate (destroys existing hub)

set -e

# Parse command line arguments
FORCE_RECREATE=false
for arg in "$@"; do
    case $arg in
        --force)
            FORCE_RECREATE=true
            shift
            ;;
        *)
            echo "Usage: $0 [--force]"
            echo "  --force: Force recreate hub without prompting"
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

# Emojis
CHECK="✅"
CROSS="❌"
WARNING="⚠️"
INFO="ℹ️"
ROCKET="🚀"

echo -e "${BLUE}🚁 Thopter Swarm Hub Provisioning${NC}"
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

# Required variables for this script
REQUIRED_VARS=(
    "APP_NAME"
    "REGION"
    "HUB_VM_SIZE"
    "HUB_PORT"
    "HUB_STATUS_PORT"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}${CROSS} Environment variable $var is not set${NC}"
        exit 1
    fi
done

echo -e "${INFO} App: $APP_NAME, Region: $REGION"
echo ""

# Check for any existing hub machines (hub-* pattern)
echo "1. Checking for existing hub machines..."
HUB_MACHINES=$(fly machines list --json | jq -r '.[] | select(.name | startswith("hub-")) | .name' 2>/dev/null || echo "")
HUB_COUNT=$(echo "$HUB_MACHINES" | grep -c . 2>/dev/null || echo "0")

if [ "$HUB_COUNT" -gt 0 ]; then
    echo -e "${WARNING} Found $HUB_COUNT existing hub machine(s):"
    echo "$HUB_MACHINES" | while read -r hub_name; do
        if [ -n "$hub_name" ]; then
            HUB_ID=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .id')
            HUB_STATE=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .state')
            echo -e "  ${INFO} $hub_name ($HUB_ID) - state: $HUB_STATE"
        fi
    done
    
    if [ "$FORCE_RECREATE" = true ]; then
        echo -e "${WARNING} --force flag specified, destroying all existing hub machines..."
        choice=2
    else
        echo ""
        echo "Options:"
        echo "1. Keep existing hub (exit)"
        echo "2. Destroy all hubs and recreate"
        echo ""
        read -p "Choose option (1 or 2): " choice
    fi
    
    case $choice in
        1)
            echo -e "${INFO} Keeping existing hub machines"
            exit 0
            ;;
        2)
            echo -e "${WARNING} Destroying all existing hub machines..."
            echo "$HUB_MACHINES" | while read -r hub_name; do
                if [ -n "$hub_name" ]; then
                    HUB_ID=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .id')
                    HUB_STATE=$(fly machines list --json | jq -r --arg name "$hub_name" '.[] | select(.name==$name) | .state')
                    
                    echo "  Destroying $hub_name ($HUB_ID)..."
                    if [ "$HUB_STATE" = "started" ]; then
                        fly machine stop $HUB_ID
                        echo "  Waiting for $hub_name to stop..."
                        sleep 5
                    fi
                    fly machine destroy $HUB_ID --force
                fi
            done
            echo -e "${CHECK} All hub machines destroyed"
            ;;
        *)
            echo -e "${RED}${CROSS} Invalid choice${NC}"
            exit 1
            ;;
    esac
else
    echo -e "${CHECK} No existing hub machines found"
fi

echo ""

# Ensure metadata service exists and is configured
echo "2. Ensuring metadata service is provisioned..."
./fly/ensure-metadata.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to provision metadata service${NC}"
    exit 1
fi

echo ""

# Generate unique tag and machine name for this deployment
GIT_SHA=$(git rev-parse --short=8 HEAD)
EPOCH_SECONDS=$(date +%s)
HUB_TAG="hub-${GIT_SHA}-${EPOCH_SECONDS}"
HUB_MACHINE_NAME="hub-$EPOCH_SECONDS"
HUB_IMAGE="registry.fly.io/$APP_NAME:$HUB_TAG"

echo "3. Building hub image..."
echo -e "${INFO} Image tag: $HUB_TAG"
echo -e "${INFO} Machine name: $HUB_MACHINE_NAME"

# todo: figure out how to properly use fly's builder. it was working for me,
# then stopped working, and now refuses to build anything but the hello world
# image i specified once in a fly.toml that doesn't exist anymore.
cd hub

# Detect platform and use appropriate Docker command
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
    echo -e "${INFO} Detected ARM64 architecture, using docker buildx for cross-compilation"
    docker buildx build \
      --platform linux/amd64 \
      -t $HUB_IMAGE \
      --build-arg HUB_PORT=$HUB_PORT \
      --build-arg HUB_STATUS_PORT=$HUB_STATUS_PORT \
      .
else
    echo -e "${INFO} Detected AMD64 architecture, using native docker build"
    docker build \
      -t $HUB_IMAGE \
      --build-arg HUB_PORT=$HUB_PORT \
      --build-arg HUB_STATUS_PORT=$HUB_STATUS_PORT \
      .
fi 

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to build hub image${NC}"
    exit 1
fi

fly auth docker
docker push $HUB_IMAGE
# one more time, a crude solution, but sometimes auth expires too fast and the
# push doesn't complete
fly auth docker
docker push $HUB_IMAGE

cd ..

echo -e "${CHECK} Hub image built and pushed successfully"

echo ""

# Ensure hub volume exists
echo "4. Ensuring hub volume exists..."
HUB_VOLUME_NAME="hub_data"

# Check if hub volume exists
EXISTING_HUB_VOLUME=$(fly volumes list --json 2>/dev/null | jq -r --arg name "$HUB_VOLUME_NAME" '.[] | select(.name==$name) | .id' | head -n1)

if [ -n "$EXISTING_HUB_VOLUME" ]; then
    echo -e "${CHECK} Hub volume already exists: $HUB_VOLUME_NAME ($EXISTING_HUB_VOLUME)"
else
    echo -e "${INFO} Creating hub volume: $HUB_VOLUME_NAME"
    fly volume create $HUB_VOLUME_NAME --size 10 --region $REGION -y
    if [ $? -ne 0 ]; then
        echo -e "${RED}${CROSS} Failed to create hub volume${NC}"
        exit 1
    fi
    echo -e "${CHECK} Hub volume created: $HUB_VOLUME_NAME"
fi

# Check for .env.thopters file before launching hub machine
echo "5. Checking for .env.thopters file..."
ENV_THOPTERS_ARG=""
if [ -f ".env.thopters" ]; then
    echo -e "${INFO} Found .env.thopters file, will include in machine creation"
    ENV_THOPTERS_ARG="--file-local /tmp/thopter/.env.thopters=.env.thopters"
else
    echo -e "${INFO} No .env.thopters file found (optional)"
fi

# Check for post-checkout.sh script before launching hub machine
echo "  Checking for post-checkout.sh script..."
POST_CHECKOUT_ARG=""
if [ -f "post-checkout.sh" ]; then
    echo -e "${INFO} Found post-checkout.sh script, will include in machine creation"
    POST_CHECKOUT_ARG="--file-local /tmp/thopter/post-checkout.sh=post-checkout.sh"
else
    echo -e "${INFO} No post-checkout.sh script found (optional)"
fi

echo ""

# Launch hub machine
echo "6. Launching hub machine..."
echo -e "${ROCKET} Starting hub with image: $HUB_IMAGE"

METADATA_SERVICE_HOST=1.redis.kv._metadata.${APP_NAME}.internal

fly machine run $HUB_IMAGE \
    --name $HUB_MACHINE_NAME \
    --vm-size=$HUB_VM_SIZE \
    --autostop=off \
    --region $REGION \
    --volume $HUB_VOLUME_NAME:/data \
    --env APP_NAME="$APP_NAME" \
    --env REGION="$REGION" \
    --env MAX_THOPTERS="$MAX_THOPTERS" \
    --env THOPTER_VM_SIZE="$THOPTER_VM_SIZE" \
    --env THOPTER_VOLUME_SIZE="$THOPTER_VOLUME_SIZE" \
    --env HUB_VM_SIZE="$HUB_VM_SIZE" \
    --env DANGEROUSLY_SKIP_FIREWALL="$DANGEROUSLY_SKIP_FIREWALL" \
    --env ALLOWED_DOMAINS="$ALLOWED_DOMAINS" \
    --env WEB_TERMINAL_PORT="$WEB_TERMINAL_PORT" \
    --env HUB_PORT="$HUB_PORT" \
    --env HUB_STATUS_PORT="$HUB_STATUS_PORT" \
    --env GITHUB_INTEGRATION_JSON="$GITHUB_INTEGRATION_JSON" \
    --env GITHUB_ISSUES_POLLING_INTERVAL="$GITHUB_ISSUES_POLLING_INTERVAL" \
    --env FLY_DEPLOY_KEY="$FLY_DEPLOY_KEY" \
    --env METADATA_SERVICE_HOST="$METADATA_SERVICE_HOST" \
    $ENV_THOPTERS_ARG \
    $POST_CHECKOUT_ARG \
    --metadata hub=1

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to launch hub machine${NC}"
    exit 1
fi

# Get hub machine ID
HUB_ID=$(fly machines list --json | jq -r --arg name "$HUB_MACHINE_NAME" '.[] | select(.name==$name) | .id')

echo -e "${CHECK} Hub machine launched successfully"
echo -e "${INFO} Hub ID: $HUB_ID"

# Update metadata service with new hub information
echo -e "${INFO} Updating metadata service with hub information..."
if redis-cli -h $METADATA_SERVICE_HOST -t 10 ping >/dev/null 2>&1; then
    redis-cli -h $METADATA_SERVICE_HOST HSET metadata HUB_IMAGE "$HUB_IMAGE"
    echo -e "${CHECK} Metadata service updated with hub information"
else
    echo -e "${WARNING} Could not update metadata service (service discovery not responding)"
fi

echo ""

# Wait for hub to be ready
echo "7. Waiting for hub to start..."
echo -e "${INFO} Checking if hub process is running..."

# Check if hub is running internally (this doesn't require wireguard)
HEALTH_CHECK_PASSED=false
for i in {1..12}; do
    if fly ssh console --machine $HUB_ID -C "curl -s http://fly-local-6pn:$HUB_PORT/health" 2>/dev/null | grep -q '"status":"ok"'; then
        echo -e "${CHECK} Hub process is running and healthy"
        HEALTH_CHECK_PASSED=true
        break
    fi
    echo "Waiting for hub to start... ($i/12)"
    sleep 5
done

if [ "$HEALTH_CHECK_PASSED" = false ]; then
    echo -e "${WARNING} Hub health check via SSH timed out"
fi

echo ""
echo "8. Waiting for hub service discovery..."
echo -e "${INFO} Testing hub service discovery via 1.hub.kv._metadata.${APP_NAME}.internal:${HUB_PORT}"
HUB_DNS_READY=false
for i in {1..24}; do
    if curl -s --connect-timeout 2 "http://1.hub.kv._metadata.${APP_NAME}.internal:${HUB_PORT}/health" 2>/dev/null | grep -q '"status":"ok"'; then
        echo -e "${CHECK} Hub service discovery working (attempt $i)"
        HUB_DNS_READY=true
        break
    else
        echo -e "${INFO} Hub service discovery not ready yet, waiting... (attempt $i/24)"
        sleep 10
    fi
done

if [ "$HUB_DNS_READY" = false ]; then
    echo -e "${RED}${CROSS} Hub service discovery hostname not responding"
    exit 1
fi

echo ""
echo "9. Testing Wireguard connectivity..."
HUB_URL="http://$HUB_ID.vm.$APP_NAME.internal:$HUB_PORT/health"

if curl -s --connect-timeout 3 "$HUB_URL" | grep -q '"status":"ok"' 2>/dev/null; then
    echo -e "${CHECK} Hub accessible via Wireguard"
else
    echo -e "${WARNING} Cannot reach hub via Wireguard (this may be normal)"
    echo -e "${INFO} This could mean:"
    echo "  - Wireguard VPN is not active"
    echo "  - Hub is still starting up"
    echo "  - Network connectivity issues"
fi

# Note: .env.thopters file was included during machine creation via --file-local flag

echo ""
echo "========================================"
echo -e "${GREEN}${ROCKET} Hub Deployment Complete!${NC}"
echo "========================================"
echo ""
echo -e "${GREEN}Hub Details:${NC}"
echo "  Machine ID: $HUB_ID"
echo "  Image: $HUB_IMAGE"
echo "  VM Size: $HUB_VM_SIZE"
echo "  Region: $REGION"
echo ""
echo -e "${GREEN}Access URLs (service discovery):${NC}"
echo "  Dashboard: http://1.hub.kv._metadata.$APP_NAME.internal:$HUB_PORT/"
echo "  Health: http://1.hub.kv._metadata.$APP_NAME.internal:$HUB_PORT/health"
echo "  Status Collector: http://1.hub.kv._metadata.$APP_NAME.internal:$HUB_STATUS_PORT/status"
echo ""
