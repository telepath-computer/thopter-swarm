#!/bin/bash
set -e

echo "Starting Thopter agent container as PID 1..."

# /data is the fly volume mount which is installed for first command runs and
# we set the new user's homedir there, because these mounts have much higher
# performance than the VM's local volumes and claude needs to do active work.
chmod 755 /data

# clear the volume mounted data dir as the volumes are reused across images
# unpredictably. also note that cloning a machine does not copy the contents of
# the data volume, the clone just grabs any available data volume with the same
# name (spec) or makes a new volume if needed. so this is a bit strange in both
# the sense that workers end up sharing the leftovers of each other's work, yet,
# we also can't reliably copy data (like from a golden claude to an instance
# agent).
rm -rf /data/*

useradd -m -d /data/thopter -s /bin/bash -U thopter

mkdir -p /data/thopter/workspace
chown thopter:thopter /data/thopter/workspace

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
echo "Setting up network firewall..."
/usr/local/bin/firewall.sh

# If credentials were injected during container setup, fix ownership
if [ -d "/data/thopter/.claude" ]; then
    echo "Fixing Claude credentials ownership for thopter user..."
    chown -R thopter:thopter /data/thopter/.claude
fi

# If issue context was injected, fix ownership  
if [ -f "/data/thopter/issue.md" ]; then
    echo "Fixing issue context ownership for thopter user..."
    chown thopter:thopter /data/thopter/issue.md
fi

if [ -f "/data/thopter/issue.json" ]; then
    echo "Fixing issue.json ownership for thopter user..."
    chown thopter:thopter /data/thopter/issue.json
fi

if [ -f "/data/thopter/prompt.md" ]; then
    echo "Fixing prompt.md ownership for thopter user..."
    chown thopter:thopter /data/thopter/prompt.md
fi

# Ensure logs directory exists with proper ownership for observer
mkdir -p /data/thopter/logs
chown thopter:thopter /data/thopter/logs

# Create directory for claude-code-log HTML output (webserver working directory)
mkdir -p /data/thopter/.claude/projects
chown -R thopter:thopter /data/thopter/.claude

# Start session observer with PM2 (as root, but observer runs as thopter user)
echo "Starting session observer..."
/usr/local/bin/start-observer.sh

echo "Switching to thopter user and starting NO-INDEX web terminal..."

# Switch to thopter user and start tmux + gotty using runuser to preserve environment
# runuser is designed for service scripts and preserves more environment than su
# Use exec to replace PID 1 with the runuser process
PRESERVE_ENV="TERM=$TERM COLORTERM=$COLORTERM LANG=$LANG LC_ALL=$LC_ALL LC_CTYPE=$LC_CTYPE TERMINFO=$TERMINFO"
# --ws-origin '.*' : Allow WebSocket connections from nginx proxy (bypasses origin validation)
exec runuser -u thopter -- env $PRESERVE_ENV bash -c "cd /data/thopter/workspace && tmux new-session -d -s thopter && gotty --permit-write --port ${WEB_TERMINAL_PORT:-7681} --ws-origin '.*' tmux attach-session -t thopter"
