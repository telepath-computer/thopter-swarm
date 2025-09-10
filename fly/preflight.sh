#!/bin/bash

# Thopter Swarm Preflight Check
# Validates prerequisites for setting up the thopter swarm on fly.io

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

# Track issues
ISSUES=()
WARNINGS=()

echo -e "${BLUE}🚁 Thopter Swarm Preflight Check${NC}"
echo "========================================"
echo ""

# Function to add issue
add_issue() {
    ISSUES+=("$1")
    echo -e "${RED}${CROSS} $1${NC}"
}

# Function to add warning
add_warning() {
    WARNINGS+=("$1")
    echo -e "${YELLOW}${WARNING} $1${NC}"
}

# Function to show success
show_success() {
    echo -e "${GREEN}${CHECK} $1${NC}"
}

# Function to show info
show_info() {
    echo -e "${BLUE}${INFO} $1${NC}"
}

echo "1. Checking fly CLI installation..."
if ! command -v fly &> /dev/null; then
    add_issue "fly CLI not found. Install from https://fly.io/docs/hands-on/install-flyctl/"
else
    FLY_VERSION=$(fly version | head -n1)
    show_success "fly CLI installed: $FLY_VERSION"
fi

echo ""
echo "2. Checking fly authentication..."
if ! fly auth whoami &> /dev/null; then
    add_issue "Not authenticated with fly.io. Run: fly auth login"
else
    FLY_USER=$(fly auth whoami 2>/dev/null)
    show_success "Authenticated as: $FLY_USER"
fi

echo ""
echo "3. Checking environment variables..."

# Change to script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ ! -f ".env" ]; then
    add_issue ".env file not found. Copy .env.example to .env and configure it"
else
    source .env
    
    # Required variables - all env vars from .env.example
    REQUIRED_VARS=(
        "APP_NAME"
        "REGION"
        "MAX_THOPTERS"
        "THOPTER_VM_SIZE"
        "THOPTER_VOLUME_SIZE"
        "HUB_VM_SIZE"
        "DANGEROUSLY_SKIP_FIREWALL"
        "ALLOWED_DOMAINS"
        "WEB_TERMINAL_PORT"
        "HUB_PORT"
        "HUB_STATUS_PORT"
        "GITHUB_INTEGRATION_JSON"
        "GITHUB_ISSUES_POLLING_INTERVAL"
        "FLY_DEPLOY_KEY"
    )
    
    ENV_OK=true
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ] || [ "${!var}" = "..." ]; then
            add_issue "Environment variable $var is not set or has placeholder value"
            ENV_OK=false
        fi
    done
    
    if [ "$ENV_OK" = true ]; then
        show_success "All required environment variables are configured"
        show_info "App: $APP_NAME, Region: $REGION"
        
        # Parse GitHub integration config and show repositories
        if [ -n "$GITHUB_INTEGRATION_JSON" ] && [ "$GITHUB_INTEGRATION_JSON" != "..." ]; then
            REPOS=$(echo "$GITHUB_INTEGRATION_JSON" | jq -r '.repositories | keys[]' 2>/dev/null || echo "")
            if [ -n "$REPOS" ]; then
                show_info "GitHub repositories: $(echo "$REPOS" | tr '\n' ' ')"
            else
                add_warning "Could not parse GITHUB_INTEGRATION_JSON repositories"
            fi
        fi
        
        show_info "Golden Claudes: Use './fly/recreate-gc.sh [name]' to create gc-* machines"
    fi
fi

echo ""
echo "4. Checking fly app configuration..."
if [ -n "$APP_NAME" ] && command -v fly &> /dev/null && fly auth whoami &> /dev/null; then
    if fly apps list | grep -q "^$APP_NAME"; then
        show_success "Fly app '$APP_NAME' exists"

        # Check if app is set as default
        if [ -f "fly.toml" ]; then
            if grep -q "app[[:space:]]*=[[:space:]]*[\"']$APP_NAME[\"']" fly.toml 2>/dev/null; then
                show_success "fly.toml configured for app '$APP_NAME'"
            else
                add_issue "fly.toml exists but doesn't match APP_NAME '$APP_NAME'. Fix manually or delete it to auto-create"
            fi
        else
            show_info "Creating fly.toml with app='$APP_NAME' and primary_region='$REGION'"
            cat > fly.toml << EOF
app = '$APP_NAME'
primary_region = '$REGION'
EOF
            show_success "Created fly.toml"
        fi
    else
        add_issue "Fly app '$APP_NAME' does not exist. Run: fly apps create --org <org> --name $APP_NAME --save"
    fi
fi

echo ""
echo "5. Checking wireguard connectivity..."
# Test actual wireguard connectivity by querying internal DNS for our app
INTERNAL_APPS=$(dig _apps.internal TXT +short +timeout=5 2>/dev/null | tr -d '"')
if [ -n "$INTERNAL_APPS" ]; then
    if echo "$INTERNAL_APPS" | grep -q "$APP_NAME"; then
        show_success "Wireguard VPN is active and $APP_NAME is accessible"
    else
        add_warning "Wireguard VPN is connected but $APP_NAME is not in internal apps list: $INTERNAL_APPS"
        add_warning "This may be normal if the app was just created. Deploy some machines first."
    fi
else
    add_warning "Wireguard VPN not connected or not working. You need an active Fly.io Wireguard connection to access thopter web terminals."
    add_warning "To fix: Run 'fly wireguard create' and activate the VPN connection on your system"
fi

echo ""
echo "6. Checking GitHub token permissions..."
if [ -n "$GITHUB_INTEGRATION_JSON" ] && [ "$GITHUB_INTEGRATION_JSON" != "..." ]; then
    # Parse the JSON and test each repository's tokens
    REPOS=$(echo "$GITHUB_INTEGRATION_JSON" | jq -r '.repositories | keys[]' 2>/dev/null || echo "")
    
    if [ -n "$REPOS" ]; then
        while IFS= read -r repo; do
            [ -z "$repo" ] && continue
            
            # Get tokens for this repo
            ISSUES_PAT=$(echo "$GITHUB_INTEGRATION_JSON" | jq -r ".repositories[\"$repo\"].issuesPAT" 2>/dev/null || echo "")
            AGENT_PAT=$(echo "$GITHUB_INTEGRATION_JSON" | jq -r ".repositories[\"$repo\"].agentCoderPAT" 2>/dev/null || echo "")
            
            # Test Issues PAT - only test issues access, not full repo access
            if [ -n "$ISSUES_PAT" ] && [ "$ISSUES_PAT" != "null" ]; then
                if curl -s -H "Authorization: token $ISSUES_PAT" \
                       -H "Accept: application/vnd.github.v3+json" \
                       "https://api.github.com/repos/$repo/issues?per_page=1" | grep -q '\['; then
                    show_success "GitHub Issues PAT has issues access to $repo"
                else
                    add_issue "GitHub Issues PAT cannot access issues in $repo. Check token permissions"
                fi
            else
                add_issue "No issuesPAT configured for repository $repo"
            fi
            
            # Test Agent Coder PAT
            if [ -n "$AGENT_PAT" ] && [ "$AGENT_PAT" != "null" ]; then
                if curl -s -H "Authorization: token $AGENT_PAT" \
                       -H "Accept: application/vnd.github.v3+json" \
                       "https://api.github.com/repos/$repo" | grep -q '"id"'; then
                    show_success "GitHub Agent Coder PAT has access to $repo"
                else
                    add_issue "GitHub Agent Coder PAT cannot access $repo. Check token permissions"
                fi
            else
                add_issue "No agentCoderPAT configured for repository $repo"
            fi
        done <<< "$REPOS"
    else
        add_warning "Could not parse repositories from GITHUB_INTEGRATION_JSON"
    fi
else
    add_issue "GITHUB_INTEGRATION_JSON not configured"
fi

echo ""
echo "========================================"
echo "📋 Preflight Summary"
echo "========================================"

if [ ${#ISSUES[@]} -eq 0 ]; then
    echo -e "${GREEN}${CHECK} All critical checks passed!${NC}"
    echo ""
else
    echo -e "${RED}${CROSS} Found ${#ISSUES[@]} critical issue(s):${NC}"
    for issue in "${ISSUES[@]}"; do
        echo -e "${RED}  • $issue${NC}"
    done
    echo ""
    echo -e "${RED}Please fix these issues before proceeding.${NC}"
    echo ""
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
    echo -e "${YELLOW}${WARNING} Found ${#WARNINGS[@]} warning(s):${NC}"
    for warning in "${WARNINGS[@]}"; do
        echo -e "${YELLOW}  • $warning${NC}"
    done
    echo ""
    echo -e "${YELLOW}These warnings won't prevent setup but may impact functionality.${NC}"
    echo ""
fi

# Exit with error if there are critical issues
if [ ${#ISSUES[@]} -gt 0 ]; then
    exit 1
fi

exit 0
