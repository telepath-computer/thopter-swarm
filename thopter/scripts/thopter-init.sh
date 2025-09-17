#!/bin/bash
set -e

# Create centralized logging directory on fast filesystem
mkdir -p /data/logs
chmod 755 /data/logs
chown thopter:thopter /data/logs

# Update logging function to use new location
LOG_FILE="/data/logs/init.log"
thopter_log() {
    local message="$(date '+%Y-%m-%d %H:%M:%S') [THOPTER-INIT] $*"
    echo "$message" | tee -a "$LOG_FILE"
}

thopter_log "Starting Thopter agent container as PID 1..."

# Check if this is a golden claude instance
if [ "$IS_GOLDEN_CLAUDE" = "true" ]; then
    thopter_log "Running in golden claude mode - git operations will be disabled"
    export GOLDEN_CLAUDE_MODE=true
else
    # Construct work branch from issue number and machine ID
    if [ -n "$ISSUE_NUMBER" ] && [ -n "$FLY_MACHINE_ID" ]; then
        export WORK_BRANCH="thopter/${ISSUE_NUMBER}--${FLY_MACHINE_ID}"
        thopter_log "Constructed WORK_BRANCH: $WORK_BRANCH"
    else
        thopter_log "Warning: Cannot construct WORK_BRANCH - missing ISSUE_NUMBER or FLY_MACHINE_ID"
    fi
fi

# important: the golden claude copy logic will *bulldoze* files in the homedir,
# with unpredictable timing relative to this script. for example, .bashrc --
# which i have explicitly excluded from the tarball snapshot in the copy script
# over in the provisioner. dont write files here that you expect to also exist
# in the golden claude, and if you do, you need to exclude them in the
# provisioner's snapshot logic.

# note the thopter user is created in the Dockerfile, and homedir is set to
# /data/thopter - and files might end up in there in that workflow (like uv's
# .local binary references) but they're going to be replaced by the mounted
# volume on machine creation.

# Wait for /data mount point to be fully ready before proceeding
thopter_log "Checking data mount point readiness..."
DATA_MOUNT_READY=false
for i in {1..30}; do
    # Test that we can write and read from the mount point
    TEST_FILE="/data/.mount-test-$$-$(date +%s%N)"
    if echo "mount-test-$(date +%s)" > "$TEST_FILE" 2>/dev/null && \
       [ -f "$TEST_FILE" ] && \
       read -r test_content < "$TEST_FILE" && \
       [ -n "$test_content" ] && \
       rm -f "$TEST_FILE" 2>/dev/null; then
        thopter_log "Data mount point is ready (attempt $i/30)"
        DATA_MOUNT_READY=true
        break
    else
        thopter_log "Data mount not ready, waiting... (attempt $i/30)"
        sleep 2
    fi
done

if [ "$DATA_MOUNT_READY" = false ]; then
    thopter_log "ERROR: Data mount point failed readiness check after 60 seconds"
    exit 1
fi

thopter_log "chmod 755 /data"
# /data is the fly volume mount which is installed for first command runs and
# we set the new user's homedir there, because these mounts have much higher
# performance than the VM's local volumes and claude needs to do active work.
chmod 755 /data

thopter_log "rm -rf /data/*"
# clear the volume mounted data dir as the volumes are reused across images
# unpredictably. also note that cloning a machine does not copy the contents of
# the data volume, the clone just grabs any available data volume with the same
# name (spec) or makes a new volume if needed. so this is a bit strange in both
# the sense that workers end up sharing the leftovers of each other's work, yet,
# we also can't reliably copy data (like from a golden claude to an instance
# agent).
# TODO: i have seen this hang forever, stuck on cleaning up uv cache
# directories. i have no idea how that is possible or what to do about it.
# i am considering not using a volume pool and just creating a new volume for
# every thopter, then regularly destroying unattached thopter volumes, because
# this is a fatal provisioning problem that has no apparent explanation or
# proper fix right now.
rm -rf /data/*

thopter_log "create workspace dir"
mkdir -p /data/thopter/workspace

thopter_log "create yolo-claude alias"
# Create useful aliases for thopter user
cat > /data/thopter/.bash_aliases << 'EOF'
# Claude alias with dangerous permissions flag (needed for autonomous operation)
alias yolo-claude='claude --dangerously-skip-permissions'
EOF

# Ensure .bashrc sources .bash_aliases
if ! grep -q "source.*\.bash_aliases" /data/thopter/.bashrc 2>/dev/null; then
    echo "" >> /data/thopter/.bashrc
    echo "# Load aliases if they exist" >> /data/thopter/.bashrc
    echo "if [ -f ~/.bash_aliases ]; then" >> /data/thopter/.bashrc
    echo "    source ~/.bash_aliases" >> /data/thopter/.bashrc
    echo "fi" >> /data/thopter/.bashrc
fi

# Phase 4: Setup network firewall (as root before switching to thopter user)
thopter_log "Setting up network firewall..."
/usr/local/bin/firewall.sh 2>&1 | while IFS= read -r line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') [FIREWALL] $line" | tee -a "$LOG_FILE"
done

# Skip all git setup for golden claude instances
if [ "$IS_GOLDEN_CLAUDE" != "true" ]; then
    # Create secure root enclave in /data for performance
    thopter_log "Creating secure root enclave..."
    mkdir -p /data/root
    chmod 700 /data/root
    chown root:root /data/root
    
    # Only proceed if we have required environment variables
    if [ -n "$REPOSITORY" ] && [ -n "$GITHUB_REPO_PAT" ]; then
        # Clone bare repo as root with PAT
        thopter_log "Setting up root-owned bare repository..."
        rm -rf /data/root/thopter-repo
        git clone --bare https://${GITHUB_REPO_PAT}@github.com/${REPOSITORY} /data/root/thopter-repo
        
        # Clone from bare repo for thopter user (local-only, no remote origin)
        REPO_NAME=$(echo $REPOSITORY | cut -d'/' -f2)
        git clone /data/root/thopter-repo /data/thopter/workspace/$REPO_NAME
        
        # Remove origin remote to make repository local-only (no direct GitHub access)
        cd /data/thopter/workspace/$REPO_NAME
        git remote remove origin
        cd /
    else
        thopter_log "Skipping git repository setup - missing REPOSITORY or GITHUB_REPO_PAT"
    fi
else
    thopter_log "Skipping git setup in golden claude mode"
fi

# If credentials were injected during container setup, fix ownership
if [ -d "/data/thopter/.claude" ]; then
    thopter_log "Fixing Claude credentials ownership for thopter user..."
fi

# If issue context was injected, fix ownership  
if [ -f "/data/thopter/workspace/issue.md" ]; then
    thopter_log "Fixing issue context ownership for thopter user..."
fi

if [ -f "/data/thopter/workspace/issue.json" ]; then
    thopter_log "Fixing issue.json ownership for thopter user..."
fi

if [ -f "/data/thopter/workspace/prompt.md" ]; then
    thopter_log "Fixing prompt.md ownership for thopter user..."
fi

# Move .env.thopters from /tmp if it exists (provided during machine creation)
if [ -f "/tmp/.env.thopters" ]; then
    thopter_log "Moving .env.thopters from /tmp to workspace directory..."
    mv /tmp/.env.thopters /data/thopter/workspace/.env.thopters
    chown thopter:thopter /data/thopter/workspace/.env.thopters
    thopter_log "Sourcing .env.thopters in .bashrc..."
    echo "" >> /data/thopter/.bashrc
    echo "# Load developer environment variables" >> /data/thopter/.bashrc
    echo "if [ -f ~/workspace/.env.thopters ]; then" >> /data/thopter/.bashrc
    echo "    set -a  # Mark all new variables for export" >> /data/thopter/.bashrc
    echo "    source ~/workspace/.env.thopters" >> /data/thopter/.bashrc
    echo "    set +a  # Turn off auto-export" >> /data/thopter/.bashrc
    echo "fi" >> /data/thopter/.bashrc
fi

# Move post-checkout.sh from /tmp if it exists (provided during machine creation)
if [ -f "/tmp/post-checkout.sh" ]; then
    thopter_log "Moving post-checkout.sh from /tmp to workspace directory..."
    mv /tmp/post-checkout.sh /data/thopter/workspace/post-checkout.sh
    chown thopter:thopter /data/thopter/workspace/post-checkout.sh
    chmod +x /data/thopter/workspace/post-checkout.sh
fi

thopter_log "add uv env setup to bashrc"
echo "" >> /data/thopter/.bashrc
echo "# make uv available" >> /data/thopter/.bashrc
echo "source /uv/env" >> /data/thopter/.bashrc
echo 'export UV_BIN_DIR="/opt/uv/bin"' >> /data/thopter/.bashrc
echo 'export UV_CACHE_DIR="/opt/uv/cache"' >> /data/thopter/.bashrc
echo 'export UV_PYTHON_INSTALL_DIR="/opt/uv/pys"' >> /data/thopter/.bashrc
echo 'export UV_TOOL_DIR="/opt/uv/tools"' >> /data/thopter/.bashrc

# ensure bashrc is loaded on login shells
echo 'source ~/.bashrc' >> /data/thopter/.bash_profile

# Note: PM2 logs now go to /data/logs (created at top of script)

# Create directory for claude-code-log HTML output (webserver working directory)
thopter_log "chmod .claude dir"
mkdir -p /data/thopter/.claude/projects

# Start session observer with PM2 (as root, but observer runs as thopter user)
thopter_log "Starting session observer..."
/usr/local/bin/start-services.sh 2>&1 | while IFS= read -r line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') [SERVICES] $line" | tee -a "$LOG_FILE"
done

# Export WORK_BRANCH for thopter user (only if not golden claude mode)
if [ "$IS_GOLDEN_CLAUDE" != "true" ] && [ -n "$WORK_BRANCH" ]; then
    echo "export WORK_BRANCH='$WORK_BRANCH'" >> /data/thopter/.bashrc
fi

# Configure Claude's MCP settings as thopter user
runuser -u thopter -- claude mcp add --transport http git-proxy http://localhost:8777

# Fix all ownership but preserve root enclave and shared logs
thopter_log "chown -R thopter:thopter /data"
chown -R thopter:thopter /data

# Restore root ownership of the secure enclave
if [ -d "/data/root" ]; then
    chown -R root:root /data/root
    chmod 700 /data/root
fi

# Keep logs directory accessible to both root and thopter
chmod 755 /data/logs

thopter_log "Switching to thopter user and starting NO-INDEX web terminal..."

# Switch to thopter user and start tmux + gotty using runuser to preserve environment
# runuser is designed for service scripts and preserves more environment than su
# Use exec to replace PID 1 with the runuser process
PRESERVE_ENV="TERM=$TERM COLORTERM=$COLORTERM LANG=$LANG LC_ALL=$LC_ALL LC_CTYPE=$LC_CTYPE TERMINFO=$TERMINFO"
# --ws-origin '.*' : Allow WebSocket connections from nginx proxy (bypasses origin validation)
exec runuser -u thopter -- env $PRESERVE_ENV bash -c "cd /data/thopter/workspace && tmux new-session -d -s thopter && gotty --permit-write --port ${WEB_TERMINAL_PORT:-7681} --ws-origin '.*' tmux attach-session -t thopter"
