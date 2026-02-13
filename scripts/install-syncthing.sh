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

SYNCTHING_CONFIG_DIR="$HOME/.local/state/syncthing"

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

if [ ! -f "$SYNCTHING_CONFIG_DIR/config.xml" ]; then
    echo "Generating SyncThing config..."
    syncthing generate --config="$SYNCTHING_CONFIG_DIR" --skip-port-probing
else
    echo "SyncThing config already exists."
fi

# Get this devbox's device ID
DEVBOX_DEVICE_ID=$(syncthing --device-id 2>/dev/null || syncthing -device-id 2>/dev/null)
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
syncthing serve --no-browser --no-upgrade --logfile="$HOME/.local/state/syncthing/syncthing.log" &
ST_PID=$!

# Wait for the REST API to become available
echo "Waiting for SyncThing API..."
for i in $(seq 1 30); do
    if syncthing cli show system &>/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Verify it's running
if ! syncthing cli show system &>/dev/null 2>&1; then
    echo "ERROR: SyncThing API did not become available"
    exit 1
fi

echo "SyncThing API is ready."

# ── 6. Configure the shared folder ──────────────────────────────────────────

# Remove the default folder if it exists (SyncThing creates one on first run)
syncthing cli config folders default delete 2>/dev/null || true

# Add our sync folder
echo "Configuring shared folder: $SYNC_FOLDER_ID at $SYNC_FOLDER_PATH"
syncthing cli config folders add \
    --id "$SYNC_FOLDER_ID" \
    --label "$SYNC_FOLDER_ID" \
    --path "$SYNC_FOLDER_PATH" 2>/dev/null || {
    echo "Folder already configured, updating path..."
    syncthing cli config folders "$SYNC_FOLDER_ID" path set "$SYNC_FOLDER_PATH"
}

# ── 7. Add laptop as peer ───────────────────────────────────────────────────

echo "Adding laptop device: $LAPTOP_DEVICE_ID"

# Add the laptop as a known device
syncthing cli config devices add \
    --device-id "$LAPTOP_DEVICE_ID" \
    --name "laptop" 2>/dev/null || {
    echo "Laptop device already known, skipping."
}

# Share the folder with the laptop
syncthing cli config folders "$SYNC_FOLDER_ID" devices add \
    --device-id "$LAPTOP_DEVICE_ID" 2>/dev/null || {
    echo "Laptop already in folder device list, skipping."
}

# Auto-accept folders from the laptop
syncthing cli config devices "$LAPTOP_DEVICE_ID" auto-accept-folders set true 2>/dev/null || true

echo "Laptop peer configured."

# ── 8. Install systemd service for auto-start ───────────────────────────────

# Stop the temp daemon — systemd will manage it
kill $ST_PID 2>/dev/null || true
wait $ST_PID 2>/dev/null || true

# Create a simple systemd user service
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/syncthing.service" << 'SYSTEMD'
[Unit]
Description=Syncthing File Synchronization
After=network.target

[Service]
ExecStart=/usr/local/bin/syncthing serve --no-browser --no-upgrade
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SYSTEMD

# Enable lingering so user services run without login
sudo loginctl enable-linger user 2>/dev/null || true

# Enable and start
systemctl --user daemon-reload
systemctl --user enable syncthing.service
systemctl --user start syncthing.service

echo "SyncThing systemd service installed and started."

# ── 9. Output device ID (last line — captured by caller) ────────────────────

echo ""
echo "SYNCTHING_DEVBOX_DEVICE_ID=$DEVBOX_DEVICE_ID"
