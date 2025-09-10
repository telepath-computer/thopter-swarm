#!/bin/bash
# Recreate Metadata Service - Provisions Redis metadata service on fly.io
# This script is idempotent - checks for existing metadata machine first

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

echo -e "${BLUE}${REDIS} Thopter Swarm Metadata Service Provisioning${NC}"
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

# Required variables for this script
REQUIRED_VARS=(
    "APP_NAME"
    "REGION"
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

# Check if metadata machine already exists first
echo "1. Checking for existing metadata machine..."
EXISTING_METADATA=$(fly machines list --json | jq -r '.[] | select(.name=="metadata") | .id' | head -n 1)

if [ -n "$EXISTING_METADATA" ] && [ "$EXISTING_METADATA" != "null" ]; then
    echo -e "${CHECK} Metadata service already exists: $EXISTING_METADATA"
    
    # Verify it's running
    METADATA_STATE=$(fly machines list --json | jq -r ".[] | select(.id==\"$EXISTING_METADATA\") | .state")
    echo -e "${INFO} Metadata service state: $METADATA_STATE"
    
    if [ "$METADATA_STATE" != "started" ]; then
        echo -e "${WARNING} Starting metadata service..."
        fly machine start $EXISTING_METADATA
    fi
    
    METADATA_ID=$EXISTING_METADATA
    SKIP_IMAGE_BUILD=true
    echo -e "${INFO} Skipping image build - using existing metadata machine"
else
    echo -e "${INFO} No existing metadata service found, will create one..."
    SKIP_IMAGE_BUILD=false
fi

echo ""

# Only build image if we need to create a new machine
if [ "$SKIP_IMAGE_BUILD" = false ]; then
    echo "2. Building metadata Redis image..."
    METADATA_TAG="metadata-$(date +%Y%m%d-%H%M%S)"
    METADATA_IMAGE="registry.fly.io/$APP_NAME:$METADATA_TAG"

    echo -e "${INFO} Image tag: $METADATA_TAG"

    # Detect platform and use appropriate Docker command
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
        echo -e "${INFO} Detected ARM64 architecture, using docker buildx for cross-compilation"
        docker buildx build \
          --platform linux/amd64 \
          -t $METADATA_IMAGE \
          -f fly/dockerfile-metadata \
          .
    else
        echo -e "${INFO} Detected AMD64 architecture, using native docker build"
        docker build \
          -t $METADATA_IMAGE \
          -f fly/dockerfile-metadata \
          .
    fi 

    if [ $? -ne 0 ]; then
        echo -e "${RED}${CROSS} Failed to build metadata image${NC}"
        exit 1
    fi

    fly auth docker
    docker push $METADATA_IMAGE
    # Push twice to handle auth expiration
    fly auth docker
    docker push $METADATA_IMAGE

    echo -e "${CHECK} Metadata image built and pushed successfully"
    echo ""
fi

# Check for and create persistent volume
echo "3. Ensuring metadata volume exists..."
VOLUME_NAME="metadata_redis"
EXISTING_VOLUME=$(fly volumes list --json | jq -r ".[] | select(.name==\"$VOLUME_NAME\") | .id" | head -n 1)

if [ -n "$EXISTING_VOLUME" ] && [ "$EXISTING_VOLUME" != "null" ]; then
    echo -e "${CHECK} Metadata volume already exists: $EXISTING_VOLUME"
else
    echo -e "${INFO} Creating metadata volume (100MB)..."
    fly volume create $VOLUME_NAME --size 1 --region $REGION
    echo -e "${CHECK} Metadata volume created"
fi

echo ""

# Create metadata machine if needed
if [ "$SKIP_IMAGE_BUILD" = false ]; then
    echo "4. Creating metadata machine..."
    echo -e "${INFO} Creating Redis metadata machine with persistent storage..."
    fly machine run $METADATA_IMAGE \
        --name metadata \
        --region $REGION \
        --app $APP_NAME \
        --autostop=off \
        --vm-size=shared-cpu-1x \
        --port 6379 \
        --volume $VOLUME_NAME:/data \
        --metadata redis=1
    
    METADATA_ID=$(fly machines list --json | jq -r '.[] | select(.name=="metadata") | .id' | head -n 1)
    
    echo -e "${CHECK} Created metadata service: $METADATA_ID"
    echo -e "${INFO} Service discovery: 1.redis.kv._metadata.${APP_NAME}.internal"
else
    echo "4. Using existing metadata machine: $METADATA_ID"
fi

echo ""

# Initialize metadata in Redis
echo "5. Initializing metadata values..."
echo -e "${INFO} Connecting to metadata service to initialize values..."

# Wait for Redis to be ready
echo -e "${INFO} Waiting for Redis to respond to PING..."
REDIS_READY=false
for i in {1..12}; do
    if fly ssh console --machine $METADATA_ID --command "redis-cli ping" 2>/dev/null | grep -q "PONG"; then
        echo -e "${CHECK} Redis is ready (attempt $i)"
        REDIS_READY=true
        break
    else
        echo -e "${INFO} Redis not ready yet, waiting... (attempt $i/12)"
        sleep 5
    fi
done

if [ "$REDIS_READY" = false ]; then
    echo -e "${RED}${CROSS} Redis did not become ready within 60 seconds${NC}"
    exit 1
fi

# Initialize metadata hash with known default values
fly ssh console --machine $METADATA_ID --command "redis-cli HSET metadata HUB_STATUS_PORT $HUB_STATUS_PORT"

echo -e "${CHECK} Metadata values initialized"

echo ""

# Verify external connectivity via machine ID address
echo "6. Verifying external connectivity..."
echo -e "${INFO} Testing Redis connectivity via ${METADATA_ID}.vm.${APP_NAME}.internal:6379"
EXTERNAL_READY=false
for i in {1..12}; do
    if redis-cli -h ${METADATA_ID}.vm.${APP_NAME}.internal -t 3 ping 2>/dev/null | grep -q "PONG"; then
        echo -e "${CHECK} External Redis connectivity verified (attempt $i)"
        EXTERNAL_READY=true
        break
    else
        echo -e "${INFO} External connectivity not ready yet, waiting... (attempt $i/12)"
        sleep 5
    fi
done

if [ "$EXTERNAL_READY" = false ]; then
    echo -e "${RED}${CROSS} Redis connectivity not available via internal network dns interface"
    exit 1
fi

echo ""
echo -e "${GREEN}${CHECK} Metadata service provisioning complete!${NC}"
echo -e "${INFO} Metadata service ID: $METADATA_ID"
echo -e "${INFO} Machine address: ${METADATA_ID}.vm.${APP_NAME}.internal:6379"
echo -e "${INFO} Service discovery: 1.redis.kv._metadata.${APP_NAME}.internal:6379"
echo -e "${INFO} Persistent storage: volume '$VOLUME_NAME' mounted at /data"
echo -e "${INFO} Redis persistence: AOF enabled with everysec fsync"
