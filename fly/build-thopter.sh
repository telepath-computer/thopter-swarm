#!/bin/bash

# Build and push Thopter Docker image
# This script builds the Thopter container image and pushes it to the Fly registry
# It also updates the metadata server with the new image tag
#
# Usage:
#   ./build-thopter.sh           # Build and push Thopter image

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

echo -e "${BLUE}🐦 Thopter Image Builder${NC}"
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
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}${CROSS} Environment variable $var is not set${NC}"
        exit 1
    fi
done

echo -e "${INFO} App: $APP_NAME"
echo ""

# Ensure metadata service exists and is configured
echo "1. Ensuring metadata service is provisioned..."
./fly/ensure-metadata.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to provision metadata service${NC}"
    exit 1
fi

echo ""

# Generate unique tag for this deployment
GIT_SHA=$(git rev-parse --short=8 HEAD)
EPOCH_SECONDS=$(date +%s)
THOPTER_TAG="thopter-${GIT_SHA}-${EPOCH_SECONDS}"
THOPTER_IMAGE="registry.fly.io/$APP_NAME:$THOPTER_TAG"

echo "2. Building thopter image..."
echo -e "${INFO} Image tag: $THOPTER_TAG"

# Use local Docker build instead of fly deploy
cd thopter

# Detect platform and use appropriate Docker command
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
    echo -e "${INFO} Detected ARM64 architecture, using docker buildx for cross-compilation"
    docker buildx build \
      --platform linux/amd64 \
      -t $THOPTER_IMAGE \
      --build-arg CURRENT_IMAGE="$THOPTER_IMAGE" \
      .
else
    echo -e "${INFO} Detected AMD64 architecture, using native docker build"
    docker build \
      -t $THOPTER_IMAGE \
      --build-arg CURRENT_IMAGE="$THOPTER_IMAGE" \
      .
fi 

if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to build thopter image${NC}"
    exit 1
fi

# Push to fly registry
fly auth docker
docker push $THOPTER_IMAGE
# one more time, a crude solution, but sometimes auth expires too fast and the
# push doesn't complete
fly auth docker
docker push $THOPTER_IMAGE

cd ..

echo -e "${CHECK} Thopter image built and pushed successfully"

# Update metadata service with new thopter image
echo -e "${INFO} Updating metadata service with thopter image information..."
METADATA_SERVICE_HOST=1.redis.kv._metadata.${APP_NAME}.internal
if redis-cli -h $METADATA_SERVICE_HOST -t 10 ping >/dev/null 2>&1; then
    redis-cli -h $METADATA_SERVICE_HOST HSET metadata THOPTER_IMAGE "$THOPTER_IMAGE"
    echo -e "${CHECK} Metadata service updated with thopter image: $THOPTER_IMAGE"
else
    echo -e "${RED}${CROSS} Could not update metadata service (service discovery not responding)"
    echo -e "${WARNING} This is expected if running outside the Fly network"
    echo -e "${INFO} The image will still be available but metadata update was skipped"
fi

echo ""
echo "========================================"
echo -e "${GREEN}${ROCKET} Thopter Image Build Complete!${NC}"
echo "========================================"
echo ""
echo -e "${GREEN}Image Details:${NC}"
echo "  Image: $THOPTER_IMAGE"
echo "  Tag: $THOPTER_TAG"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "  You can now use this image in golden claude or thopter deployments"
echo "  The metadata server has been updated with the new image tag"
echo ""

# Export the image tag for other scripts to use
export THOPTER_IMAGE
