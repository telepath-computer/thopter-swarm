#!/bin/bash
# Provision a thopter locally without going through GitHub
#
# Usage:
#   ./test-fake-issue.sh --repo owner/name           # Provision for a specific repo
#   ./test-fake-issue.sh --repo owner/name -p arch   # With specific prompt
#   ./test-fake-issue.sh                             # Uses first repo from GITHUB_INTEGRATION_JSON

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Source environment if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env" ]; then
    source "$SCRIPT_DIR/../.env"
fi

# Default values
HUB_URL=""
PROMPT_NAME="default"
REPO=""
TITLE="Local test thopter"
ISSUE_NUMBER=$(date +%s)  # Use timestamp for unique issue numbers

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --url)
            HUB_URL="$2"
            shift 2
            ;;
        --prompt|-p)
            PROMPT_NAME="$2"
            shift 2
            ;;
        --repo|-r)
            REPO="$2"
            shift 2
            ;;
        --title|-t)
            TITLE="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--repo owner/name] [--title <label>] [--prompt <name>]"
            echo "  --repo, -r <owner/name>: Repository to provision for (required or auto-detected)"
            echo "  --title, -t <label>: Label shown on dashboard (default: 'Local test thopter')"
            echo "  --prompt, -p <name>: Use specific prompt template (default: default)"
            echo "  --url <URL>: Test against custom hub URL"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--repo owner/name] [--title <label>] [--prompt <name>]"
            exit 1
            ;;
    esac
done

# Auto-detect repo from GITHUB_INTEGRATION_JSON if not specified
if [ -z "$REPO" ]; then
    if [ -n "$GITHUB_INTEGRATION_JSON" ]; then
        REPO=$(echo "$GITHUB_INTEGRATION_JSON" | jq -r '.repositories | keys[0]' 2>/dev/null || echo "")
        if [ -n "$REPO" ] && [ "$REPO" != "null" ]; then
            echo -e "${BLUE}Auto-detected repo from .env: $REPO${NC}"
        fi
    fi
fi

if [ -z "$REPO" ]; then
    echo -e "${RED}❌ No repository specified${NC}"
    echo "Use --repo owner/name or configure GITHUB_INTEGRATION_JSON in .env"
    exit 1
fi

echo -e "${BLUE}🧪 Testing Thopter Provisioning Endpoint${NC}"
echo "========================================="

# Auto-detect hub if no URL specified
if [ -z "$HUB_URL" ]; then
    echo "Auto-detecting hub..."

    # Get metadata service machine ID
    APP_NAME=${APP_NAME:-"swarm1"}
    METADATA_ID=$(fly machines list --json -a "$APP_NAME" 2>/dev/null | jq -r '.[] | select(.name=="metadata") | .id' || echo "")
    
    if [ -n "$METADATA_ID" ]; then
        HUB_SERVICE_HOST="1.hub.kv._metadata.${APP_NAME}.internal"
        HUB_URL="http://$HUB_SERVICE_HOST:8080"
        echo -e "${GREEN}✅ Hub: $HUB_URL${NC}"
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
echo "Provisioning thopter..."
echo -e "${BLUE}Repo: $REPO${NC}"
echo -e "${BLUE}Title: $TITLE${NC}"
echo -e "${BLUE}Prompt: $PROMPT_NAME${NC}"

# Build JSON payload with variable interpolation
JSON_PAYLOAD=$(cat <<EOF
{
  "repository": "$REPO",
  "prompt": "$PROMPT_NAME",
  "github": {
    "repository": "$REPO",
    "issueNumber": "$ISSUE_NUMBER",
    "issueTitle": "$TITLE",
    "issueBody": "Claude: This is a test thopter. Your only task is to say hello to prove you have read this message, then STOP and wait for further instructions. Do NOT make any commits, code changes, or take any other actions.",
    "issueUrl": "https://github.com/$REPO/issues/$ISSUE_NUMBER",
    "issueAuthor": "local-user",
    "mentionCommentId": $ISSUE_NUMBER,
    "mentionAuthor": "local-provisioner",
    "mentionLocation": "body",
    "assignees": [],
    "labels": ["test"],
    "comments": []
  }
}
EOF
)

# Send provision request
RESPONSE=$(curl -s -X POST "$HUB_URL/provision" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.' || echo "$RESPONSE"

# Check if provisioning was successful
if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    REQUEST_ID=$(echo "$RESPONSE" | jq -r '.requestId')
    MESSAGE=$(echo "$RESPONSE" | jq -r '.message')
    
    echo ""
    echo -e "${GREEN}🚁 Provision request created successfully!${NC}"
    echo -e "${GREEN}Request ID: $REQUEST_ID${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Watch dashboard: $HUB_URL/"
    echo "2. Access thopter web terminal and run 'yolo-claude' to authenticate"
    echo "3. Check status: ./fly/status.sh"
else
    echo ""
    echo -e "${RED}❌ Provisioning failed${NC}"
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
    echo -e "${RED}Error: $ERROR${NC}"
fi

echo ""
echo "========================================"
