#!/bin/bash
set -e

# Logging function that outputs to both stdout and /thopter/log
# Captures both stdout and stderr to the log file
thopter_log() {
    local message="$(date '+%Y-%m-%d %H:%M:%S') [THOPTER-INIT] $*"
    echo "$message" | tee -a /thopter/log
}

thopter_log "Starting Thopter agent container as PID 1..."

# important: the golden claude copy logic will *bulldoze* files in the homedir,
# with unpredictable timing relative to this script. for example, .bashrc --
# which i have explicitly excluded from the tarball snapshot in the copy script
# over in the provisioner. dont write files here that you expect to also exist
# in the golden claude, and if you do, you need to exclude them in the
# provisioner's snapshot logic.

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
rm -rf /data/*

thopter_log "useradd thopter"
useradd -m -d /data/thopter -s /bin/bash -U thopter

thopter_log "create workspace dir"
mkdir -p /data/thopter/workspace
chown thopter:thopter /data/thopter/workspace

thopter_log "create yolo-claude alias"
# Create useful aliases for thopter user
cat > /data/thopter/.bash_aliases << 'EOF'
# Claude alias with dangerous permissions flag (needed for autonomous operation)
alias yolo-claude='claude --dangerously-skip-permissions'
EOF

chown thopter:thopter /data/thopter/.bash_aliases

# Ensure .bashrc sources .bash_aliases
if ! grep -q "source.*\.bash_aliases" /data/thopter/.bashrc 2>/dev/null; then
    echo "" >> /data/thopter/.bashrc
    echo "# Load aliases if they exist" >> /data/thopter/.bashrc
    echo "if [ -f ~/.bash_aliases ]; then" >> /data/thopter/.bashrc
    echo "    source ~/.bash_aliases" >> /data/thopter/.bashrc
    echo "fi" >> /data/thopter/.bashrc
    chown thopter:thopter /data/thopter/.bashrc
fi

# Phase 4: Setup network firewall (as root before switching to thopter user)
thopter_log "Setting up network firewall..."
/usr/local/bin/firewall.sh 2>&1 | while IFS= read -r line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') [FIREWALL] $line" | tee -a /thopter/log
done

# If credentials were injected during container setup, fix ownership
if [ -d "/data/thopter/.claude" ]; then
    thopter_log "Fixing Claude credentials ownership for thopter user..."
    chown -R thopter:thopter /data/thopter/.claude
fi

# If issue context was injected, fix ownership  
if [ -f "/data/thopter/issue.md" ]; then
    thopter_log "Fixing issue context ownership for thopter user..."
    chown thopter:thopter /data/thopter/issue.md
fi

if [ -f "/data/thopter/issue.json" ]; then
    thopter_log "Fixing issue.json ownership for thopter user..."
    chown thopter:thopter /data/thopter/issue.json
fi

if [ -f "/data/thopter/prompt.md" ]; then
    thopter_log "Fixing prompt.md ownership for thopter user..."
    chown thopter:thopter /data/thopter/prompt.md
fi

# Move .env.thopters from /tmp if it exists (provided during machine creation)
if [ -f "/tmp/.env.thopters" ]; then
    thopter_log "Moving .env.thopters from /tmp to thopter home directory..."
    mv /tmp/.env.thopters /data/thopter/.env.thopters
    chown thopter:thopter /data/thopter/.env.thopters
    thopter_log "Sourcing .env.thopters in .bashrc..."
    echo "" >> /data/thopter/.bashrc
    echo "# Load developer environment variables" >> /data/thopter/.bashrc
    echo "if [ -f ~/.env.thopters ]; then" >> /data/thopter/.bashrc
    echo "    set -a  # Mark all new variables for export" >> /data/thopter/.bashrc
    echo "    source ~/.env.thopters" >> /data/thopter/.bashrc
    echo "    set +a  # Turn off auto-export" >> /data/thopter/.bashrc
    echo "fi" >> /data/thopter/.bashrc
    chown thopter:thopter /data/thopter/.bashrc
fi

thopter_log "add uv env setup to bashrc"
echo "" >> /data/thopter/.bashrc
echo "# make uv available" >> /data/thopter/.bashrc
echo "source /uv/env" >> /data/thopter/.bashrc

# Ensure logs directory exists with proper ownership for pm2 service logging
thopter_log "create and chmod /data/thopter/logs (for pm2)"
mkdir -p /data/thopter/logs
chown thopter:thopter /data/thopter/logs

# Create directory for claude-code-log HTML output (webserver working directory)
thopter_log "chmod .claude dir"
mkdir -p /data/thopter/.claude/projects
chown -R thopter:thopter /data/thopter/.claude

# Start session observer with PM2 (as root, but observer runs as thopter user)
thopter_log "Starting session observer..."
/usr/local/bin/start-observer.sh 2>&1 | while IFS= read -r line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') [OBSERVER] $line" | tee -a /thopter/log
done

thopter_log "Switching to thopter user and starting NO-INDEX web terminal..."

# Switch to thopter user and start tmux + gotty using runuser to preserve environment
# runuser is designed for service scripts and preserves more environment than su
# Use exec to replace PID 1 with the runuser process
PRESERVE_ENV="TERM=$TERM COLORTERM=$COLORTERM LANG=$LANG LC_ALL=$LC_ALL LC_CTYPE=$LC_CTYPE TERMINFO=$TERMINFO"
# --ws-origin '.*' : Allow WebSocket connections from nginx proxy (bypasses origin validation)
exec runuser -u thopter -- env $PRESERVE_ENV bash -c "cd /data/thopter/workspace && tmux new-session -d -s thopter && gotty --permit-write --port ${WEB_TERMINAL_PORT:-7681} --ws-origin '.*' tmux attach-session -t thopter"
