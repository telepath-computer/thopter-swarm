# SyncThing File Sync — Design & Setup Guide

Real-time file sync between developer laptops and thopter devboxes.

## The Problem

Agents create artifacts (documents, code, configs, designs) on their devbox
filesystems. To view, edit, or give feedback the developer currently needs to
`git push` / `git pull` — high friction for rapid iteration. We want a file to
appear on the developer's machine within seconds of an agent writing it, and
vice versa.

## The Solution: SyncThing

[SyncThing](https://syncthing.net) is a peer-to-peer, encrypted, open-source
file sync tool. No central server, no accounts, no cloud storage. Each node has
a device ID derived from a TLS certificate. Peers that know each other's device
IDs can sync shared folders.

Key properties that make it ideal:

- **Offline-resilient**: If the laptop is off, agents keep working locally.
  Changes sync when the laptop reconnects. Nothing is lost.
- **Block-level diffing**: Only changed portions of files transfer, not whole
  files.
- **Conflict-safe**: If both sides edit the same file while disconnected,
  SyncThing keeps both versions (one as a `.sync-conflict-*` file). Nothing
  is silently overwritten.
- **Headless-friendly**: Runs as a daemon on Linux servers with no GUI.
- **Programmable**: Full REST API and CLI for automated setup.

## Architecture

```
┌──────────────┐         ┌──────────────┐
│  Developer   │◄───────►│  Devbox 1    │
│  Laptop      │  sync   │  (agent)     │
│              │         └──────────────┘
│  ~/jw-       │         ┌──────────────┐
│  artifact-   │◄───────►│  Devbox 2    │
│  stash/      │  sync   │  (agent)     │
│              │         └──────────────┘
│  SyncThing   │         ┌──────────────┐
│  (introducer)│◄───────►│  Devbox 3    │
│              │  sync   │  (agent)     │
└──────────────┘         └──────────────┘
```

### Topology: Laptop as Hub

The developer's **laptop is the hub**. Every devbox syncs only with the laptop.
Devboxes do not sync directly with each other.

Why this works:

1. **Sync only matters when the developer is involved.** The developer views,
   edits, and reviews artifacts on their laptop. Agents don't need each other's
   files in real-time — they work on separate artifacts.
2. **Offline laptop is fine.** Agents keep working on their local copies. When
   the laptop comes online, everything syncs up.
3. **Simple pairing.** Each devbox only needs one peer: the laptop. The laptop
   needs N peers (one per active devbox), managed by the `thopter` CLI.

### Layers: SyncThing + Git (optional)

```
┌─────────────────────────────────┐
│         SyncThing               │  Real-time file sync (working tree)
│    ~/your-folder/               │
├─────────────────────────────────┤
│         Git (optional)          │  Version control (explicit commits)
│    .git/ excluded from sync     │
└─────────────────────────────────┘
```

- **SyncThing** syncs the working tree files in real-time.
- The sync folder can be anything — a git repo, a plain directory, whatever.
- If using git: `.git/` is excluded from sync (each machine has its own clone).
  Commit from any machine. Push to share via git.
- If not using git: files just sync. Simple as that.

## Connectivity

Runloop devboxes are not directly addressable from the internet (SSH goes
through a proxy). SyncThing handles this transparently:

1. **Global discovery**: Each SyncThing instance registers with public
   discovery servers. Peers find each other by device ID.
2. **Relay fallback**: If direct connection fails (NAT, firewalls), data routes
   through SyncThing community relay servers. Data is end-to-end encrypted —
   relays cannot read it.
3. **No port forwarding needed.** Both the laptop and devboxes initiate
   outbound connections. No inbound ports need to be opened.

Performance through relays is slightly slower than direct connections, but for
document-sized artifacts (not gigabytes), it's more than adequate.

## Configuration

All SyncThing config lives in `~/.thopter.json` under the `syncthing` key:

```json
{
  "syncthing": {
    "deviceId": "MFZWI3D-BONSEZ7-...",
    "folderName": "my-sync-folder"
  }
}
```

| Field | Description |
|-------|-------------|
| `deviceId` | This laptop's SyncThing device ID (auto-detected) |
| `folderName` | Folder name — becomes `~/folderName` on all machines, and the SyncThing folder ID |

Each developer has their own `~/.thopter.json`, so each can have their own
folder name. The folder lives at `~/folderName` on the laptop and all devboxes.
It can be anything — a git repo, a plain directory, a collection of markdown
docs. Git is optional, not required.

## .stignore

A `.stignore` file in the sync folder root tells SyncThing what to skip:

```
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

// Editor state
*.swp
*.swo
*~
```

This file is itself synced (it's just a file in the folder), so all peers share
the same ignore rules.

## Setup Steps

### 1. Laptop Setup (one-time)

**Option A: Automated script** (does everything in one go):

```bash
# Install SyncThing first
brew install syncthing          # macOS
# or: sudo apt install syncthing  # Linux

# Run the setup script
bash scripts/laptop-syncthing-setup.sh my-sync-folder
```

**Option B: Manual / step-by-step:**

```bash
# 1. Install & start SyncThing
brew install syncthing && brew services start syncthing

# 2. Create your sync folder (can be a git repo or just a directory)
mkdir -p ~/my-sync-folder

# 3. Configure thopter (auto-detects your SyncThing device ID)
thopter sync init
# Prompts for: device ID, folder name

# 4. Verify
thopter sync show
thopter config get
```

#### macOS: Ensure SyncThing runs on login

```bash
brew services start syncthing
```

#### Linux: Ensure SyncThing runs as a service

```bash
sudo systemctl enable syncthing@$USER
sudo systemctl start syncthing@$USER
```

### 2. Devbox Provisioning (automated)

SyncThing is installed on each devbox during provisioning. This is handled by
`scripts/install-syncthing.sh`, which runs as part of `thopter create`.

What the script does:
1. Downloads the SyncThing binary
2. Generates config and keys
3. Adds the laptop as a known device (device ID from `~/.thopter.json`)
4. Configures the shared folder at `~/folderName`
5. Creates the folder directory
6. Starts SyncThing as a systemd user service
7. Outputs the devbox's device ID for pairing

### 3. Pairing (automated by thopter CLI)

After the devbox is running and SyncThing is started:

1. The `thopter create` command reads `~/.thopter.json` syncthing config
2. It passes the laptop device ID, folder ID, and remote path to the devbox
3. The devbox configures SyncThing and reports its device ID back
4. The CLI adds the devbox's device ID to the laptop's local SyncThing via
   the REST API at `localhost:8384`
5. Both sides now know about each other → sync begins

If the `thopter` CLI is NOT running on the laptop (e.g., running from another
devbox), pairing must be done manually:
- Get the devbox device ID: `thopter exec <name> syncthing --device-id`
- Add it in the laptop's SyncThing web UI at `http://localhost:8384`

### 4. Golden Snapshot

For the fastest workflow, add SyncThing to the golden snapshot:

1. Create a devbox with SyncThing installed
2. Snapshot it
3. New devboxes from the snapshot already have SyncThing — they just need
   identity regeneration and pairing

The provisioning script handles this: on snapshot-based creates, it regenerates
the SyncThing device identity (so each devbox is unique) and re-configures the
laptop peer.

## CLI Integration

### New commands

```bash
# One-time: configure SyncThing in ~/.thopter.json
thopter sync init

# Show current SyncThing config
thopter sync show

# Install SyncThing on a devbox and pair with the laptop
thopter sync pair <name>

# Show a devbox's SyncThing device ID
thopter sync device-id <name>

# Remove a devbox from the laptop's SyncThing
thopter sync unpair <name>

# Remove SyncThing config from ~/.thopter.json
thopter sync clear
```

### Modified commands

`thopter create` auto-enables SyncThing when `syncthing` is present in
`~/.thopter.json`. Use `--no-sync` to skip:
- Reads config from `~/.thopter.json`
- Installs SyncThing on the devbox with the right folder ID and paths
- Pairs with the laptop automatically via local REST API

## Suspend / Resume Behavior

- **Suspend**: SyncThing stops when the VM freezes. No action needed.
- **Resume**: SyncThing restarts automatically (systemd service or cron).
  It reconnects to the laptop and syncs any changes that occurred while
  suspended. The devbox's device ID is stable across suspend/resume.

## Conflict Handling

Since the developer avoids having two agents edit the same file:

- **Normal case**: One writer at a time per file → no conflicts, clean sync.
- **If conflicts occur**: SyncThing keeps the newer version as canonical and
  saves the other as `filename.sync-conflict-YYYYMMDD-HHMMSS-DEVICEID.ext`.
  Nothing is lost. Clean up manually.
- **Practical advice**: Use directory-per-agent conventions in the artifact
  stash to avoid overlap entirely.

## Security

- All SyncThing traffic is TLS-encrypted end-to-end.
- Device IDs are derived from TLS certificates — you explicitly trust each peer.
- Relay servers (if used) cannot decrypt the data.
- The device ID stored in `~/.thopter.json` is a public identifier (like a
  fingerprint), not a private key. It's safe to store in config files.

## Ports

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 22000 | TCP/UDP | Outbound | Sync protocol (BEP) |
| 21027 | UDP | Local only | LAN discovery (not used) |
| 8384 | TCP | localhost | REST API / Web UI |

No inbound ports need to be opened on either the laptop or devboxes.

## Future Enhancements

- **Multiple folders**: Extend `~/.thopter.json` to support an array of sync
  folders (e.g., one for artifacts, one for shared config).
- **Selective sync**: Use SyncThing's per-folder device lists to give specific
  agents access to specific subsets of files.
- **Direct connections**: If Runloop adds port forwarding, configure SyncThing
  to use direct TCP connections instead of relays for better performance.
- **Golden snapshot with SyncThing**: Pre-install SyncThing in the golden
  snapshot so devbox provisioning only needs to regenerate identity and pair.
