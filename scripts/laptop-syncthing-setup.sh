#!/usr/bin/env bash
# laptop-syncthing-setup.sh — One-time SyncThing setup on the developer's laptop.
#
# Run this on your macOS or Linux laptop to set up file sync with devboxes.
# Prerequisites:
#   - SyncThing installed (brew install syncthing / apt install syncthing)
#   - thopter CLI configured (thopter setup)
#
# Usage: bash scripts/laptop-syncthing-setup.sh <folder-name>

set -euo pipefail

SYNC_FOLDER_ID="${1:?Usage: laptop-syncthing-setup.sh <folder-name>}"
SYNC_FOLDER_PATH="$HOME/$SYNC_FOLDER_ID"

echo "=== SyncThing Laptop Setup for Thopter File Sync ==="
echo ""

# ── 1. Check SyncThing is installed ─────────────────────────────────────────

if ! command -v syncthing &>/dev/null; then
    echo "ERROR: SyncThing is not installed."
    echo ""
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "  Install with: brew install syncthing"
    else
        echo "  Install with: sudo apt install syncthing"
    fi
    exit 1
fi

echo "SyncThing found: $(syncthing --version | head -1)"

# ── 2. Ensure SyncThing is running ──────────────────────────────────────────

if ! syncthing cli show system &>/dev/null 2>&1; then
    echo ""
    echo "SyncThing is not running. Starting it..."

    if [[ "$(uname)" == "Darwin" ]]; then
        if command -v brew &>/dev/null; then
            brew services start syncthing
            echo "Started via Homebrew services."
        else
            syncthing --no-browser &
            echo "Started in background."
        fi
    else
        if systemctl --user start syncthing.service 2>/dev/null; then
            systemctl --user enable syncthing.service
            echo "Started via systemd."
        else
            syncthing --no-browser &
            echo "Started in background."
        fi
    fi

    echo "Waiting for SyncThing to start..."
    for i in $(seq 1 30); do
        if syncthing cli show system &>/dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    if ! syncthing cli show system &>/dev/null 2>&1; then
        echo "ERROR: SyncThing did not start. Check logs."
        exit 1
    fi
fi

echo "SyncThing API is ready."

# ── 3. Get laptop device ID ─────────────────────────────────────────────────

LAPTOP_DEVICE_ID=$(syncthing cli show system | jq -r .myID 2>/dev/null || syncthing --device-id 2>/dev/null)

if [ -z "$LAPTOP_DEVICE_ID" ]; then
    echo "ERROR: Could not determine SyncThing device ID"
    exit 1
fi

echo ""
echo "Your laptop's SyncThing device ID:"
echo "  $LAPTOP_DEVICE_ID"

# ── 4. Create sync folder ───────────────────────────────────────────────────

echo ""
if [ -d "$SYNC_FOLDER_PATH" ]; then
    echo "Sync folder already exists at $SYNC_FOLDER_PATH"
else
    echo "Creating sync folder at $SYNC_FOLDER_PATH..."
    mkdir -p "$SYNC_FOLDER_PATH"
fi

# ── 5. Create .stignore ─────────────────────────────────────────────────────

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
    echo "Created .stignore in sync folder."
else
    echo ".stignore already exists."
fi

# ── 6. Configure SyncThing folder ───────────────────────────────────────────

echo ""
echo "Configuring SyncThing shared folder..."

if syncthing cli config folders "$SYNC_FOLDER_ID" path get &>/dev/null 2>&1; then
    echo "Folder '$SYNC_FOLDER_ID' already configured in SyncThing."
else
    syncthing cli config folders add \
        --id "$SYNC_FOLDER_ID" \
        --label "$SYNC_FOLDER_ID" \
        --path "$SYNC_FOLDER_PATH"
    echo "Folder '$SYNC_FOLDER_ID' added to SyncThing."
fi

# ── 7. Save config to ~/.thopter.json ────────────────────────────────────────

echo ""
echo "Saving SyncThing config to ~/.thopter.json..."

if command -v thopter &>/dev/null; then
    thopter sync init \
        --device-id "$LAPTOP_DEVICE_ID" \
        --folder-name "$SYNC_FOLDER_ID"
else
    echo "WARNING: thopter CLI not found. Save manually with:"
    echo "  thopter sync init"
fi

# ── 8. Summary ───────────────────────────────────────────────────────────────

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  SyncThing device ID: $LAPTOP_DEVICE_ID"
echo "  Sync folder:         ~/$SYNC_FOLDER_ID (on all machines)"
echo "  SyncThing Web UI:    http://localhost:8384"
echo ""
echo "Next steps:"
echo "  1. Create a devbox: thopter create my-worker"
echo "     (SyncThing will auto-install and pair)"
echo "  2. Or pair an existing devbox: thopter sync pair <name>"
echo "  3. Check sync status: open http://localhost:8384"
