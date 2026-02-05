#!/bin/bash
set -e

# Logging function that outputs to both stdout and /thopter/log
# Captures both stdout and stderr to the log file
thopter_log() {
    local message="$(date '+%Y-%m-%d %H:%M:%S') [THOPTER-INIT] $*"
    echo "$message" | tee -a /thopter/log
}

thopter_log "Starting Thopter agent container as PID 1..."

# The thopter user is created in the Dockerfile with homedir at /data/thopter.
# The home directory persists from the Docker image (including Claude CLI).
# Only the workspace (/data/thopter/workspace) is a volume mount for performance.

# Wait for workspace volume mount to be ready
thopter_log "Checking workspace mount point readiness..."
WORKSPACE_MOUNT_READY=false
for i in {1..30}; do
    TEST_FILE="/data/thopter/workspace/.mount-test-$$-$(date +%s%N)"
    if echo "mount-test-$(date +%s)" > "$TEST_FILE" 2>/dev/null && \
       [ -f "$TEST_FILE" ] && \
       read -r test_content < "$TEST_FILE" && \
       [ -n "$test_content" ] && \
       rm -f "$TEST_FILE" 2>/dev/null; then
        thopter_log "Workspace mount point is ready (attempt $i/30)"
        WORKSPACE_MOUNT_READY=true
        break
    else
        thopter_log "Workspace mount not ready, waiting... (attempt $i/30)"
        sleep 2
    fi
done

if [ "$WORKSPACE_MOUNT_READY" = false ]; then
    thopter_log "ERROR: Workspace mount point failed readiness check after 60 seconds"
    exit 1
fi

# Clean the workspace volume (volumes are reused across thopters)
thopter_log "Cleaning workspace directory..."
rm -rf /data/thopter/workspace/*

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
    echo "$(date '+%Y-%m-%d %H:%M:%S') [FIREWALL] $line" | tee -a /thopter/log
done

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

thopter_log "add ~/.local/bin to PATH in bashrc"
echo "" >> /data/thopter/.bashrc
echo "# add local bin to PATH for claude CLI" >> /data/thopter/.bashrc
echo 'export PATH="$HOME/.local/bin:$PATH"' >> /data/thopter/.bashrc

# ensure bashrc is loaded on login shells
echo 'source ~/.bashrc' >> /data/thopter/.bash_profile

# Ensure logs directory exists with proper ownership for pm2 service logging
thopter_log "create and chmod /data/thopter/logs (for pm2)"
mkdir -p /data/thopter/logs

# Create directory for claude-code-log HTML output (webserver working directory)
thopter_log "chmod .claude dir"
mkdir -p /data/thopter/.claude/projects

# Start session observer with PM2 (as root, but observer runs as thopter user)
thopter_log "Starting session observer..."
/usr/local/bin/start-observer.sh 2>&1 | while IFS= read -r line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') [OBSERVER] $line" | tee -a /thopter/log
done

# fix workspace ownership (home directory ownership is set in Dockerfile)
thopter_log "chown -R thopter:thopter /data/thopter/workspace"
chown -R thopter:thopter /data/thopter/workspace

thopter_log "Switching to thopter user and starting NO-INDEX web terminal..."

# Switch to thopter user and start tmux + gotty using runuser to preserve environment
# runuser is designed for service scripts and preserves more environment than su
# Use exec to replace PID 1 with the runuser process
PRESERVE_ENV="TERM=$TERM COLORTERM=$COLORTERM LANG=$LANG LC_ALL=$LC_ALL LC_CTYPE=$LC_CTYPE TERMINFO=$TERMINFO"
# --ws-origin '.*' : Allow WebSocket connections from nginx proxy (bypasses origin validation)
exec runuser -u thopter -- env $PRESERVE_ENV bash -c "cd /data/thopter/workspace && tmux new-session -d -s thopter && gotty --permit-write --port ${WEB_TERMINAL_PORT:-7681} --ws-origin '.*' tmux attach-session -t thopter"
