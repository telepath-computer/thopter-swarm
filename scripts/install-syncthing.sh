#!/usr/bin/env bash
# install-syncthing.sh — Install and configure SyncThing on a thopter devbox.
#
# Arguments:
#   $1 — Laptop's SyncThing device ID
#   $2 — SyncThing folder ID (must match laptop config)
#   $3 — Local path for the sync folder on this devbox
#
# Usage: bash install-syncthing.sh <laptop-device-id> <folder-id> <folder-path>
#
# After running, the devbox's SyncThing device ID is printed to stdout
# (last line, as SYNCTHING_DEVBOX_DEVICE_ID=...) for the caller to capture.

set -euo pipefail

LAPTOP_DEVICE_ID="${1:?Usage: install-syncthing.sh <laptop-device-id> <folder-id> <folder-path>}"
SYNC_FOLDER_ID="${2:?Missing folder ID}"
SYNC_FOLDER_PATH="${3:?Missing folder path}"

# Expand ~ in path
SYNC_FOLDER_PATH="${SYNC_FOLDER_PATH/#\~/$HOME}"

ST_HOME="$HOME/.local/state/syncthing"

# ── 1. Install SyncThing ────────────────────────────────────────────────────

if command -v syncthing &>/dev/null; then
    echo "SyncThing already installed: $(syncthing --version)"
else
    echo "Installing SyncThing..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  ST_ARCH="amd64" ;;
        aarch64) ST_ARCH="arm64" ;;
        *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    # Fetch latest release URL from GitHub API
    ST_URL=$(curl -fsSL https://api.github.com/repos/syncthing/syncthing/releases/latest \
        | jq -r ".assets[] | select(.name | test(\"syncthing-linux-${ST_ARCH}-v.*\\\\.tar\\\\.gz\$\")) | .browser_download_url")

    if [ -z "$ST_URL" ]; then
        echo "ERROR: Could not find SyncThing release for linux-${ST_ARCH}"
        exit 1
    fi

    TMPDIR=$(mktemp -d)
    curl -fsSL "$ST_URL" | tar xz -C "$TMPDIR"
    sudo install -m 755 "$TMPDIR"/syncthing-linux-*/syncthing /usr/local/bin/syncthing
    rm -rf "$TMPDIR"
    echo "SyncThing installed: $(syncthing --version)"
fi

# ── 2. Generate config (if not already present) ─────────────────────────────

if [ ! -f "$ST_HOME/config.xml" ]; then
    echo "Generating SyncThing config..."
    syncthing generate --home="$ST_HOME" --no-port-probing
else
    echo "SyncThing config already exists."
fi

# Get this devbox's device ID
DEVBOX_DEVICE_ID=$(syncthing device-id --home="$ST_HOME")
echo "Devbox SyncThing device ID: $DEVBOX_DEVICE_ID"

# ── 3. Create sync folder (if not already present) ──────────────────────────

if [ ! -d "$SYNC_FOLDER_PATH" ]; then
    echo "Creating sync folder at $SYNC_FOLDER_PATH..."
    mkdir -p "$SYNC_FOLDER_PATH"
else
    echo "Sync folder already exists at $SYNC_FOLDER_PATH"
fi

# ── 4. Create .stignore ─────────────────────────────────────────────────────

if [ ! -f "$SYNC_FOLDER_PATH/.stignore" ]; then
    cat > "$SYNC_FOLDER_PATH/.stignore" << 'STIGNORE'
// Git internals — each machine maintains its own clone
.git

// Dependencies and build artifacts
node_modules
dist
.next
__pycache__
*.pyc
.venv

// OS junk
.DS_Store
Thumbs.db

// Editor temp files
*.swp
*.swo
*~
STIGNORE
fi

# ── 5. Start SyncThing daemon ───────────────────────────────────────────────

# Start in background so we can configure via CLI
echo "Starting SyncThing daemon..."
syncthing serve --home="$ST_HOME" --no-browser --no-upgrade --logfile="$ST_HOME/syncthing.log" &
ST_PID=$!

# Wait for the REST API to become available
echo "Waiting for SyncThing API..."
for i in $(seq 1 30); do
    if syncthing cli --home="$ST_HOME" show system &>/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Verify it's running
if ! syncthing cli --home="$ST_HOME" show system &>/dev/null 2>&1; then
    echo "ERROR: SyncThing API did not become available"
    exit 1
fi

echo "SyncThing API is ready."

# ── 6. Configure the shared folder ──────────────────────────────────────────

# Remove the default folder if it exists (SyncThing creates one on first run)
syncthing cli --home="$ST_HOME" config folders default delete 2>/dev/null || true

# Add our sync folder
echo "Configuring shared folder: $SYNC_FOLDER_ID at $SYNC_FOLDER_PATH"
syncthing cli --home="$ST_HOME" config folders add \
    --id "$SYNC_FOLDER_ID" \
    --label "$SYNC_FOLDER_ID" \
    --path "$SYNC_FOLDER_PATH" 2>/dev/null || {
    echo "Folder already configured, updating path..."
    syncthing cli --home="$ST_HOME" config folders "$SYNC_FOLDER_ID" path set "$SYNC_FOLDER_PATH"
}

# Enable filesystem watcher for near-instant change detection (inotify)
syncthing cli --home="$ST_HOME" config folders "$SYNC_FOLDER_ID" fswatcher-enabled set true 2>/dev/null || true
syncthing cli --home="$ST_HOME" config folders "$SYNC_FOLDER_ID" fswatcher-delays set 1 2>/dev/null || true
syncthing cli --home="$ST_HOME" config folders "$SYNC_FOLDER_ID" rescan-intervals set 30 2>/dev/null || true

# ── 7. Add laptop as peer ───────────────────────────────────────────────────

echo "Adding laptop device: $LAPTOP_DEVICE_ID"

# Add the laptop as a known device
syncthing cli --home="$ST_HOME" config devices add \
    --device-id "$LAPTOP_DEVICE_ID" \
    --name "laptop" 2>/dev/null || {
    echo "Laptop device already known, skipping."
}

# Share the folder with the laptop
syncthing cli --home="$ST_HOME" config folders "$SYNC_FOLDER_ID" devices add \
    --device-id "$LAPTOP_DEVICE_ID" 2>/dev/null || {
    echo "Laptop already in folder device list, skipping."
}

# Auto-accept folders from the laptop
syncthing cli --home="$ST_HOME" config devices "$LAPTOP_DEVICE_ID" auto-accept-folders set true 2>/dev/null || true

echo "Laptop peer configured."

# ── 8. Ensure SyncThing runs persistently ─────────────────────────────────

# Try systemd user service first; fall back to cron @reboot if systemd isn't available
# (Runloop devboxes don't have D-Bus, so systemd --user may not work)
kill $ST_PID 2>/dev/null || true
wait $ST_PID 2>/dev/null || true

SYSTEMD_OK=false
if systemctl --user daemon-reload 2>/dev/null; then
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/syncthing.service" << SYSTEMD
[Unit]
Description=Syncthing File Synchronization
After=network.target

[Service]
ExecStart=/usr/local/bin/syncthing serve --home=$ST_HOME --no-browser --no-upgrade
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SYSTEMD

    sudo loginctl enable-linger user 2>/dev/null || true
    systemctl --user enable syncthing.service 2>/dev/null && \
    systemctl --user start syncthing.service 2>/dev/null && \
    SYSTEMD_OK=true
fi

if [ "$SYSTEMD_OK" = true ]; then
    echo "SyncThing running via systemd."
else
    echo "systemd not available, using cron + nohup fallback."
    # Add @reboot cron entry (idempotent)
    CRON_CMD="@reboot /usr/local/bin/syncthing serve --home=$ST_HOME --no-browser --no-upgrade > /dev/null 2>&1"
    ( crontab -l 2>/dev/null | grep -v "syncthing serve" ; echo "$CRON_CMD" ) | crontab -
    # Start now
    nohup syncthing serve --home="$ST_HOME" --no-browser --no-upgrade > "$ST_HOME/syncthing.log" 2>&1 &
    echo "SyncThing started in background (cron @reboot for persistence)."
fi

# ── 9. Output device ID (last line — captured by caller) ────────────────────

echo ""
echo "SYNCTHING_DEVBOX_DEVICE_ID=$DEVBOX_DEVICE_ID"
