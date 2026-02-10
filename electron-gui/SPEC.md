# Thopter Swarm Electron GUI - Mini-Spec

## Overview

Desktop Electron application providing a GUI dashboard and command-and-control interface for Thopter Swarm. Replaces the CLI-based status monitoring and control workflow with a rich HTML interface.

## Core Architecture Decisions

- **Merged context Electron**: Uses `nodeIntegration: true` / `contextIsolation: false` so renderer code can directly call Node.js APIs (child_process, ioredis, fs). No IPC/RPC bridge needed.
- **React + shadcn/ui + Tailwind CSS**: Modern component library with utility-first CSS.
- **Zustand state management**: Store separates internal state (data from services) from display state (UI selections, modal open/close). React components are purely a function of display state.
- **ThopterService interface**: Abstraction layer over thopter operations. Has two implementations:
  - **MockThopterService**: Generates fake data for development and Playwright testing.
  - **RealThopterService**: Calls CLI via async exec or connects to Redis directly depending on the operation.
- **Mac OS target**: Runs on macOS. Attach operations open iTerm2.

## Views & Layout

### Global Header
- App title: "Thopter Swarm"
- "Run New Thopter" button (opens modal)
- "Re-Authenticate" button (opens modal)
- Notification bell icon with unread count (opens sidebar)

### Dashboard View (default)
- Grid of cards, one per thopter
- Each card shows:
  - Name (bold)
  - Status badge (color-coded: running=green, waiting=yellow, done=blue, inactive/dead=red)
  - Task description
  - Heartbeat relative time ("5m ago")
  - Last message preview (truncated)
  - Claude running indicator
- Click card to open thopter detail tab
- Auto-refreshes every 5 seconds

### Thopter Detail Tab
- Tab bar at top: Dashboard tab + one tab per opened thopter
- Header: thopter name, status badge, owner
- Status panel: devbox status, agent status, task, heartbeat, claude running
- **Transcript viewer** (main area):
  - Full scrollable message history
  - Color-coded by role: user (green), assistant (cyan), tool_use (yellow), tool_result (dim gray)
  - Timestamps (HH:MM:SS)
  - Markdown rendering for assistant messages
  - Auto-scrolls to bottom on new messages
  - Live-updating via Redis subscription
- **Action bar**:
  - Tell input: text area + send button + interrupt checkbox
  - Operation buttons: Suspend, Resume, Destroy (with confirmation), Attach (opens iTerm2)

### Run New Thopter Modal
Multi-step form:
1. **Repository**: Select from predefined repos dropdown, or enter custom `owner/repo`
2. **Branch**: Text input with default from repo config or global default
3. **Task/Prompt**: Large textarea for the Claude prompt
4. **Options** (collapsible): Custom name, snapshot selection, keep-alive duration
5. **Review & Launch**: Summary of selections, "Launch" button
- Shows progress during creation
- On success: closes modal, opens new thopter's detail tab

### Re-Auth Modal
Multi-step form (mirrors CLI reauth wizard):
1. **Choose machine**: Radio group - existing devbox / from snapshot / fresh
2. **Snapshot name**: Text input for the output snapshot name
3. **SSH instructions**: Shows the SSH command to run in terminal, "Open Terminal" button
4. **Finalize**: "Create Snapshot & Save as Default" button

### Notification Sidebar
- Collapsible right-side panel
- Subscribes to ntfy.sh channel via SSE (EventSource)
- Each notification: timestamp, title, message
- Click to expand full message
- Unread count badge in header
- Clear all / dismiss individual

## State Management (Zustand)

### Internal State (data layer)
```
thopters: Record<string, ThopterData>    // All thopter info from service
transcripts: Record<string, TranscriptEntry[]>  // Transcript per thopter
notifications: Notification[]             // ntfy.sh notifications
repos: RepoConfig[]                       // Predefined repos
snapshots: Snapshot[]                     // Available snapshots
config: AppConfig                         // Current config
connectionStatus: 'connected' | 'error' | 'loading'
```

### Display State (UI layer)
```
activeTab: 'dashboard' | string           // 'dashboard' or thopter name
openTabs: string[]                        // List of open thopter tab names
isRunModalOpen: boolean
runModalStep: number
isReauthModalOpen: boolean
reauthModalStep: number
isSidebarOpen: boolean
unreadNotificationCount: number
```

### Actions
```
// Data actions
refreshThopters(): void
fetchTranscript(name: string): void
subscribeTranscript(name: string): void
unsubscribeTranscript(name: string): void

// Thopter operations
runThopter(opts: RunOpts): Promise<string>
tellThopter(name: string, message: string, interrupt?: boolean): Promise<void>
destroyThopter(name: string): Promise<void>
suspendThopter(name: string): Promise<void>
resumeThopter(name: string): Promise<void>
attachThopter(name: string): void

// UI actions
setActiveTab(tab: string): void
openTab(name: string): void
closeTab(name: string): void
openRunModal(): void
closeRunModal(): void
setRunModalStep(step: number): void
openReauthModal(): void
closeReauthModal(): void
toggleSidebar(): void
markNotificationsRead(): void
```

## ThopterService Interface

```typescript
interface ThopterService {
  // Queries
  listThopters(): Promise<ThopterInfo[]>
  getThopterStatus(name: string): Promise<ThopterDetail>
  getTranscript(name: string, lines?: number): Promise<TranscriptEntry[]>
  subscribeTranscript(name: string, onEntry: (entry: TranscriptEntry) => void): Unsubscribe
  listSnapshots(): Promise<SnapshotInfo[]>
  listRepos(): Promise<RepoConfig[]>
  getConfig(): Promise<AppConfig>

  // Mutations
  runThopter(opts: RunThopterOpts): Promise<{ name: string }>
  tellThopter(name: string, message: string, interrupt?: boolean): Promise<void>
  destroyThopter(name: string): Promise<void>
  suspendThopter(name: string): Promise<void>
  resumeThopter(name: string): Promise<void>
  attachThopter(name: string): void
  reauth(opts: ReauthOpts): Promise<void>
}
```

### Mock Implementation
- Generates 3-5 fake thopters with realistic names (using friendly-words style)
- Each has randomized status, task, heartbeat
- Generates transcript entries over time (simulates Claude working)
- Operations have artificial 1-3s delays
- Toggled via `THOPTER_MOCK=1` env var or `--mock` flag

### Real Implementation
- **listThopters / getThopterStatus**: Redis MGET for batch status queries (efficient, like CLI status)
- **getTranscript / subscribeTranscript**: Redis LRANGE + polling (like CLI tail)
- **runThopter / destroyThopter / suspendThopter / resumeThopter / tellThopter**: async child_process.exec of CLI commands
- **attachThopter**: spawn iTerm2 with `osascript` AppleScript to open new tab with SSH command
- **listSnapshots / listRepos / getConfig**: Read from ~/.thopter.json or call CLI

## Testing (Playwright)

- Electron-specific Playwright setup using `electron` fixture
- All tests run against MockThopterService
- Test scenarios:
  - Dashboard loads and displays thopter cards
  - Click card opens detail tab
  - Transcript view shows entries
  - Tell input sends message
  - Run modal workflow: open, fill steps, submit
  - Destroy with confirmation dialog
  - Notification sidebar opens/closes
  - Tab management (open, switch, close)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Electron (merged context) |
| UI framework | React 18 |
| Components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS |
| State | Zustand |
| Build | electron-vite (Vite-based) |
| Testing | Playwright (Electron mode) |
| Redis client | ioredis |
| CLI execution | Node.js child_process |
| Markdown | marked + marked-terminal or react-markdown |

## File Structure

```
electron-gui/
  package.json
  electron.vite.config.ts
  tailwind.config.js
  tsconfig.json
  postcss.config.js

  src/
    main/                    # Electron main process
      index.ts               # Window creation, app lifecycle

    renderer/                # React app (merged context)
      index.html
      main.tsx               # React entry
      App.tsx                # Root layout

      components/
        layout/
          Header.tsx         # Global header bar
          TabBar.tsx         # Tab navigation
          NotificationSidebar.tsx
        dashboard/
          Dashboard.tsx      # Dashboard grid view
          ThopterCard.tsx    # Individual thopter card
        detail/
          ThopterDetail.tsx  # Full thopter detail view
          TranscriptView.tsx # Transcript message list
          ActionBar.tsx      # Tell input + operation buttons
          StatusPanel.tsx    # Status info display
        modals/
          RunModal.tsx       # Run new thopter workflow
          ReauthModal.tsx    # Re-auth workflow
          ConfirmDialog.tsx  # Generic confirmation
        ui/                  # shadcn/ui components

      store/
        index.ts             # Zustand store definition
        types.ts             # State & action types

      services/
        types.ts             # ThopterService interface & data types
        mock.ts              # MockThopterService
        real.ts              # RealThopterService
        index.ts             # Service factory (mock vs real)
        ntfy.ts              # ntfy.sh SSE subscription

      lib/
        utils.ts             # Tailwind cn() helper, formatting utils

  e2e/
    app.spec.ts              # Playwright tests
    playwright.config.ts
```
