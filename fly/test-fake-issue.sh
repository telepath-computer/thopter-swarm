#!/bin/bash
# Test script to exercise the thopter provisioning endpoint
#
# Usage:
#   ./test-fake-issue.sh                    # Auto-detect hub and test
#   ./test-fake-issue.sh --url <URL>        # Test against custom URL
#   ./test-fake-issue.sh --gc <name>        # Use specific Golden Claude (default: default)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
HUB_URL=""
GOLDEN_CLAUDE="default"
ISSUE_NUMBER=$(date +%s)  # Use timestamp for unique issue numbers

# Parse command line arguments
for arg in "$@"; do
    case $arg in
        --url)
            HUB_URL="$2"
            shift 2
            ;;
        --gc)
            GOLDEN_CLAUDE="$2"
            shift 2
            ;;
        *)
            if [ -z "$1" ]; then
                break
            fi
            echo "Usage: $0 [--local] [--url <URL>] [--gc <name>]"
            echo "  --local: Test against localhost:8080"
            echo "  --url <URL>: Test against custom URL"
            echo "  --gc <name>: Use specific Golden Claude (default: default)"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}🧪 Testing Thopter Provisioning Endpoint${NC}"
echo "========================================="

# Auto-detect hub if no URL specified
if [ -z "$HUB_URL" ]; then
    echo "Auto-detecting hub from metadata service..."
    
    # Source environment if available
    if [ -f ".env" ]; then
        source .env
    fi
    
    # Get metadata service machine ID
    APP_NAME=${APP_NAME:-"swarm1"}
    METADATA_ID=$(fly machines list --json -a "$APP_NAME" 2>/dev/null | jq -r '.[] | select(.name=="metadata") | .id' || echo "")
    
    if [ -n "$METADATA_ID" ]; then
        APP_NAME=${APP_NAME:-"swarm1"}
        METADATA_HOST="$METADATA_ID.vm.$APP_NAME.internal"
        
        echo "Connecting to metadata service: $METADATA_HOST:6379"
        
        # Use static hub service discovery - no need to check metadata
        HUB_SERVICE_HOST="1.hub.kv._metadata.${APP_NAME}.internal"
        HUB_URL="http://$HUB_SERVICE_HOST:8080"
        echo -e "${GREEN}✅ Using hub service discovery: $HUB_SERVICE_HOST${NC}"
        echo -e "${BLUE}   Hub URL: $HUB_URL${NC}"
    else
        echo -e "${RED}❌ No metadata service found${NC}"
        echo "Run './fly/recreate-hub.sh' to deploy services, or use --local/--url flags"
        exit 1
    fi
else
    echo -e "${BLUE}Using specified URL: $HUB_URL${NC}"
fi

echo ""

# Test hub health first
echo "Checking hub health..."
if curl -s --connect-timeout 5 "$HUB_URL/health" | grep -q '"status":"ok"' 2>/dev/null; then
    echo -e "${GREEN}✅ Hub is healthy${NC}"
else
    echo -e "${YELLOW}⚠️  Hub health check failed (may still work for provisioning)${NC}"
fi

echo ""
echo "Testing provisioning with sample GitHub issue..."
echo -e "${YELLOW}Issue #$ISSUE_NUMBER${NC}"
echo -e "${BLUE}Golden Claude: $GOLDEN_CLAUDE${NC}"

# Sample provision request with dynamic issue number
RESPONSE=$(curl -s -X POST "$HUB_URL/provision" \
  -H "Content-Type: application/json" \
  -d "{
    \"repository\": \"test/repo\",
    \"gc\": \"$GOLDEN_CLAUDE\",
    \"github\": {
      \"issueNumber\": \"$ISSUE_NUMBER\",
      \"issueTitle\": \"Fix authentication bug in user login\",
      \"issueBody\": \"Users are experiencing login failures when using special characters in passwords. The authentication service is throwing validation errors.\\n\\nSteps to reproduce:\\n1. Create user with password containing @#$%\\n2. Attempt to login\\n3. See error\\n\\nExpected: Login should succeed\\nActual: ValidationError thrown\\n\\n/thopter\",
      \"issueUrl\": \"https://github.com/test/repo/issues/$ISSUE_NUMBER\",
      \"issueAuthor\": \"test-user\",
      \"mentionAuthor\": \"test-provisioner\",
      \"mentionLocation\": \"body\"
    }
  }")

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.' || echo "$RESPONSE"

# Check if provisioning was successful
if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    AGENT_ID=$(echo "$RESPONSE" | jq -r '.agent.id')
    WEB_TERMINAL=$(echo "$RESPONSE" | jq -r '.agent.webTerminalUrl')
    
    echo ""
    echo -e "${GREEN}🚁 Thopter provisioned successfully!${NC}"
    echo -e "${GREEN}Agent ID: $AGENT_ID${NC}"
    echo -e "${GREEN}Web Terminal: $WEB_TERMINAL${NC}"
    echo ""
    echo "You can now:"
    echo "1. Access the thopter via web terminal: $WEB_TERMINAL"
    echo "2. Check status: ./fly/status.sh"
    echo "3. Clean up when done: ./cleanup-thopters.sh"
else
    echo ""
    echo -e "${RED}❌ Provisioning failed${NC}"
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
    echo -e "${RED}Error: $ERROR${NC}"
fi

echo ""
echo "========================================"
