# Thopter Status Updates: Enhancement Plan

## Executive Summary

This document outlines the plan to enhance thopter status reporting by:
1. Renaming "state" to "tmuxState" to clarify that it tracks tmux session activity
2. Adding "claudeProcess" detection to verify Claude Code is actually running
3. Updating dashboard display to show comprehensive status information
4. Clarifying golden claude status reporting capabilities

## Current Architecture Analysis

### Current Status Schema (`ThopterStatusUpdate`)
- `state`: Currently tracks tmux session activity ('running' | 'idle')
- `screen_dump`: Terminal content snapshot
- `last_activity`: Last timestamp of activity detection
- `idle_since`: When the tmux session went idle

### Current Status Flow
1. **Observer Script** (`thopter/scripts/observer.js`):
   - Monitors tmux session for screen changes
   - Reports 'running' when screen changes, 'idle' after 60s threshold
   - Sends status to hub via HTTP POST to `/status`

2. **Collector** (`hub/src/collector/index.ts`):
   - Validates incoming status updates
   - Currently only accepts 'running' | 'idle' states
   - Calls `stateManager.updateThopterFromStatus()`

3. **State Manager** (`hub/src/lib/state-manager.ts`):
   - Updates `session.claudeState` from status.state
   - Stores in `ThopterState.session` object

4. **Dashboard** (`hub/views/dashboard.ejs` & `hub/views/agent-detail.ejs`):
   - Shows current "Status" column with tmux state
   - Detail page shows "Claude State" (which is actually tmux state)

### Golden Claude Status Handling
**Key Findings**: Golden claudes have multiple issues preventing status reporting:

#### Root Cause Analysis:
1. **Environment Variable Issues** (PRIMARY):
   - Golden claudes were missing `HUB_STATUS_PORT` environment variable
   - Golden claudes were missing `APP_NAME` environment variable  
   - Without these, observer script fails to connect to hub: "HUB_STATUS_PORT environment variable not set"
   - **FIXED**: Added both variables to `./fly/recreate-gc.sh`

2. **State Manager Routing Bug** (SECONDARY):
   - Golden claudes use the SAME Docker image and init scripts as regular thopters
   - Golden claudes DO run the observer script and (once env fixed) will send status updates to `/status`
   - **BUG**: The collector's `updateThopterFromStatus()` only looks in the `thopters` map, not `goldenClaudes`
   - Golden claudes with names starting with `gc-` are tracked separately in `GoldenClaudeState` map
   - Once env issues are fixed, golden claude status updates will trigger "Received status for unknown thopter" warnings

#### Observer Script Compatibility:
- ✅ Observer script gracefully handles missing GitHub issue context
- ✅ Golden claudes will send core status fields: `thopter_id`, `state`, `screen_dump`, `last_activity`, `timestamp`
- ✅ Observer designed to work without `issue.json` file ("report basic status only")

#### Current vs. Fixed State:
- **Before**: Golden claudes only tracked by Fly machine state (no session data)
- **After**: Golden claudes will report rich session data (tmux state, Claude process status, screen dumps)

## Proposed Changes

### 1. Schema Updates

#### Update `ThopterStatusUpdate` interface:
```typescript
export interface ThopterStatusUpdate {
  // Core status - CONVERT ALL TO camelCase for consistency
  thopterId: string;              // RENAMED from thopter_id
  tmuxState: 'active' | 'idle';   // RENAMED from 'state'
  claudeProcess: 'running' | 'notFound';  // NEW FIELD
  screenDump: string;             // RENAMED from screen_dump
  lastActivity: string;           // RENAMED from last_activity
  timestamp: string;
  idleSince?: string | null;      // RENAMED from idle_since
  spawnedAt?: string;             // RENAMED from spawned_at
  
  // Source-agnostic metadata - camelCase
  repository?: string;
  workBranch?: string;            // Already camelCase
  
  // Source-specific contexts
  github?: GitHubContext;
}
```

#### Update `ThopterState.session`:
```typescript
session?: {
  tmuxState: 'active' | 'idle';  // RENAMED from claudeState
  claudeProcess: 'running' | 'notFound';  // NEW FIELD
  lastActivity: Date;
  idleSince?: Date;
  screenDump: string;
};
```

#### Update `GoldenClaudeState` to support observer data:
```typescript
export interface GoldenClaudeState {
  machineId: string;
  name: string;
  state: 'running' | 'stopped';  // Fly machine state
  webTerminalUrl?: string;
  
  // NEW: Observer data (if golden claude runs observer)
  session?: {
    tmuxState: 'active' | 'idle';
    claudeProcess: 'running' | 'notFound';
    lastActivity: Date;
    idleSince?: Date;
    screenDump: string;
  };
}
```

### 2. Observer Script Updates

#### Add Claude process detection and fix field naming:
```javascript
async checkClaudeProcess() {
  try {
    // Check if exact 'claude' process is running (not claude-log-generator, etc.)
    // Using pgrep -x for exact match or pgrep with ^claude$ pattern
    execSync('pgrep -x claude', { encoding: 'utf8', timeout: 5000 });
    return 'running';
  } catch (error) {
    // pgrep returns non-zero exit code if no processes found
    return 'notFound';
  }
}

async checkActivity() {
  // ... existing tmux capture logic ...
  
  // NEW: Check Claude process
  const claudeProcess = await this.checkClaudeProcess();
  
  // Update payload - CONVERT ALL TO camelCase
  const payload = {
    thopterId: this.thopterId,        // RENAMED from thopter_id
    tmuxState: state,                 // RENAMED from 'state'
    claudeProcess: claudeProcess,     // NEW
    screenDump: currentScreen,        // RENAMED from screen_dump
    lastActivity: now,                // RENAMED from last_activity
    timestamp: now,
    idleSince: this.idle_since,       // RENAMED from idle_since
    spawnedAt: this.spawnedAt         // RENAMED from spawned_at
  };
}
```

### 3. Collector Updates

#### Update validation in `handleStatusUpdate`:
```typescript
// Update field validation - ALL camelCase
if (!statusUpdate.thopterId) {
  res.status(400).json({ error: 'Missing required field: thopterId' });
  return;
}

if (!statusUpdate.tmuxState) {
  res.status(400).json({ error: 'Missing required field: tmuxState' });
  return;
}

if (!['active', 'idle'].includes(statusUpdate.tmuxState)) {
  res.status(400).json({ error: 'Invalid tmuxState. Must be "active" or "idle"' });
  return;
}

if (!statusUpdate.claudeProcess) {
  res.status(400).json({ error: 'Missing required field: claudeProcess' });
  return;
}

if (!['running', 'notFound'].includes(statusUpdate.claudeProcess)) {
  res.status(400).json({ error: 'Invalid claudeProcess. Must be "running" or "notFound"' });
  return;
}
```

### 4. State Manager Updates

#### Update `updateThopterFromStatus` to handle both thopters and golden claudes:
```typescript
updateThopterFromStatus(status: ThopterStatusUpdate): void {
  let thopter = this.thopters.get(status.thopterId);  // UPDATED field name
  
  if (!thopter) {
    // NEW: Check if this is a golden claude reporting
    const goldenClaude = this.goldenClaudes.get(status.thopterId);  // UPDATED field name
    if (goldenClaude) {
      this.updateGoldenClaudeFromStatus(goldenClaude, status);
      return;
    }
    
    logger.warn(`Received status for unknown thopter: ${status.thopterId}`, status.thopterId, 'state-manager');
    return;
  }
  
  // Update session state for regular thopters - ALL camelCase
  thopter.session = {
    tmuxState: status.tmuxState,
    claudeProcess: status.claudeProcess,
    lastActivity: new Date(status.lastActivity),    // UPDATED field name
    idleSince: status.idleSince ? new Date(status.idleSince) : undefined,  // UPDATED field name
    screenDump: status.screenDump                   // UPDATED field name
  };
  
  // ... existing GitHub context update logic
}

// NEW METHOD: Handle golden claude status updates
updateGoldenClaudeFromStatus(goldenClaude: GoldenClaudeState, status: ThopterStatusUpdate): void {
  goldenClaude.session = {
    tmuxState: status.tmuxState,
    claudeProcess: status.claudeProcess,
    lastActivity: new Date(status.lastActivity),    // UPDATED field name
    idleSince: status.idleSince ? new Date(status.idleSince) : undefined,  // UPDATED field name
    screenDump: status.screenDump                   // UPDATED field name
  };
  
  logger.debug(`Updated golden claude session state: ${status.thopterId}`, status.thopterId, 'state-manager');
}
```

#### CRITICAL FIX: Update `bootstrapGoldenClaudes()` to preserve session data:
```typescript
async bootstrapGoldenClaudes(): Promise<void> {
  // ... existing fly machine fetching logic ...
  
  // Add each GC machine to our tracking
  for (const machine of gcMachines) {
    const name = machine.name.replace(/^gc-/, '');
    
    // PRESERVE existing session data if it exists
    const existing = this.goldenClaudes.get(machine.id);
    
    const gcState: GoldenClaudeState = {
      machineId: machine.id,
      name: name,
      state: machine.state === 'started' ? 'running' : 'stopped',
      webTerminalUrl: machine.state === 'started' 
        ? `http://${machine.id}.vm.${this.appName}.internal:${this.webTerminalPort}/`
        : undefined,
      // PRESERVE session data from observer updates
      session: existing?.session  // Keep existing session data if available
    };
    
    newGoldenClaudes.set(machine.id, gcState);
  }
  
  // ... rest of method unchanged ...
}
```

### 5. Dashboard Updates

#### Main Dashboard Table - Replace single "Status" column with combined multi-line status:
```html
<th>Status</th>
```

```html
<td class="status-cell">
  <div class="status-multiline">
    <div class="status-line">
      machine: <span class="machine-state <%= formatters.stateClass(thopter.fly.machineState) %>">
        <%= thopter.fly.machineState %>
      </span>
      (age: <%= formatters.relativeTime(thopter.fly.createdAt) %>)
      <% if (thopter.session?.lastActivity) { %>
        (last ping: <%= formatters.relativeTime(thopter.session.lastActivity) %>)
      <% } %>
    </div>
    <% if (thopter.session) { %>
      <div class="status-line">
        tmux: <span class="tmux-state <%= formatters.stateClass(thopter.session.tmuxState) %>">
          <%= thopter.session.tmuxState %>
        </span>
        <% if (thopter.session.idleSince) { %>
          (idle since: <%= formatters.relativeTime(thopter.session.idleSince) %>)
        <% } %>
      </div>
      <div class="status-line">
        claude process: <span class="claude-process <%= thopter.session.claudeProcess === 'running' ? 'process-running' : 'process-not-found' %>">
          <%= thopter.session.claudeProcess === 'running' ? 'running' : 'not found' %>
        </span>
      </div>
    <% } else { %>
      <div class="status-line no-session">tmux: no data</div>
      <div class="status-line no-session">claude process: no data</div>
    <% } %>
  </div>
</td>
```

#### Agent Detail Page Updates:
```html
<!-- Replace "Claude State" with "Tmux State" -->
<div class="detail-row">
  <div class="detail-label">Tmux State:</div>
  <div class="detail-value">
    <span class="tmux-state <%= formatters.stateClass(thopter.session.tmuxState) %>">
      <%= thopter.session.tmuxState %>
    </span>
  </div>
</div>

<!-- Add new "Claude Process" field -->
<div class="detail-row">
  <div class="detail-label">Claude Process:</div>
  <div class="detail-value">
    <span class="claude-process <%= thopter.session.claudeProcess === 'running' ? 'process-running' : 'process-not-found' %>">
      <%= thopter.session.claudeProcess === 'running' ? 'running' : 'not found' %>
    </span>
  </div>
</div>
```

#### Golden Claude Section Updates:
Apply the same multi-line status display to golden claudes with **INVERTED Claude process warning logic**:

```html
<td class="status-cell">
  <div class="status-multiline">
    <div class="status-line">
      machine: <span class="machine-state <%= gc.state === 'running' ? 'state-running' : 'state-stopped' %>">
        <%= gc.state %>
      </span>
      (age: available from fly machine data)
      <% if (gc.session?.lastActivity) { %>
        (last ping: <%= formatters.relativeTime(gc.session.lastActivity) %>)
      <% } %>
    </div>
    <% if (gc.session) { %>
      <div class="status-line">
        tmux: <span class="tmux-state <%= formatters.stateClass(gc.session.tmuxState) %>">
          <%= gc.session.tmuxState %>
        </span>
        <% if (gc.session.idleSince) { %>
          (idle since: <%= formatters.relativeTime(gc.session.idleSince) %>)
        <% } %>
      </div>
      <div class="status-line">
        claude process: <span class="claude-process <%= gc.session.claudeProcess === 'notFound' ? 'process-good' : 'process-warning' %>">
          <%= gc.session.claudeProcess === 'running' ? 'running' : 'not found' %>
          <% if (gc.session.claudeProcess === 'running') { %>
            <span class="warning-icon" title="Warning: Claude should be stopped in golden claudes for filesystem stability">⚠️</span>
          <% } %>
        </span>
      </div>
    <% } else { %>
      <div class="status-line no-session">tmux: no data</div>
      <div class="status-line no-session">claude process: no data</div>
    <% } %>
  </div>
</td>
```

### 6. CSS Updates

Add new CSS classes for the enhanced status display:
```css
.status-multiline {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.9em;
}

.status-line {
  white-space: nowrap;
}

.machine-state { /* existing styles */ }
.tmux-state { /* similar to existing state styles */ }

/* For regular thopters - Claude running is good */
.claude-process.process-running {
  color: #28a745;
  background-color: #d4edda;
}

.claude-process.process-not-found {
  color: #dc3545;
  background-color: #f8d7da;
}

/* For golden claudes - Claude NOT running is good */
.claude-process.process-good {
  color: #28a745;
  background-color: #d4edda;
}

.claude-process.process-warning {
  color: #856404;
  background-color: #fff3cd;
}

.warning-icon {
  margin-left: 4px;
  font-size: 0.9em;
}

.no-session {
  color: #6c757d;
  font-style: italic;
}
```

## Implementation Strategy - Single Pass

### Complete Implementation (All Changes Together):

1. **Environment Variables** ✅ **COMPLETED**:
   - Added `HUB_STATUS_PORT` and `APP_NAME` to golden claude creation

2. **Observer Script Updates**:
   - Add Claude process detection using `pgrep -x claude` (exact match only)
   - Convert ALL field names to camelCase: `thopter_id` → `thopterId`, `screen_dump` → `screenDump`, etc.
   - Update status payload to use `tmuxState` and `claudeProcess` fields

3. **TypeScript Schema Updates**:
   - Update `ThopterStatusUpdate` interface: convert all snake_case to camelCase + rename `state` → `tmuxState`, add `claudeProcess`
   - Update `ThopterState.session` interface: rename `claudeState` → `tmuxState`, add `claudeProcess`
   - Update `GoldenClaudeState` interface: add `session` object with same structure

4. **Collector Updates**:
   - Update validation to require camelCase field names: `thopterId`, `tmuxState`, `claudeProcess`
   - Remove validation for all old field names (snake_case and `state`)

5. **State Manager Updates**:
   - Update `updateThopterFromStatus()` to handle golden claude routing AND camelCase field names
   - Add `updateGoldenClaudeFromStatus()` method
   - Update session field mapping for new camelCase schema
   - **CRITICAL FIX**: Update `bootstrapGoldenClaudes()` to preserve existing session data during reconciliation

6. **Dashboard Updates**:
   - Replace single "Status" column with multi-line status display
   - Update agent detail page with separate tmux/claude process fields
   - Update golden claude section to show session data with INVERTED Claude process warnings
   - Add CSS styles for new status display including golden claude warning states

7. **Build and Verify**:
   - Run `npm run build` to verify TypeScript compilation
   - Ensure all code changes are implemented and compile successfully

**NOTE**: Actual deployment, server running, and testing will be handled separately by the user. Code implementation focuses on ensuring all changes compile and are ready for deployment.

## Deployment Notes

### No Backward Compatibility
- Complete schema change with no support for old field names
- All machines (thopters and golden claudes) will be recreated fresh
- Observer script only sends new `tmuxState` and `claudeProcess` fields
- Collector only accepts new field names

### Fresh Start Approach
- No persistent data migration needed (all status is ephemeral)
- All active machines recreated with new observer and environment variables
- Clean deployment with no legacy field support

## Risks & Mitigations

### Risk: Process detection failure or false positives
**Mitigation**: 
- Use `pgrep -x claude` for exact process name matching (avoids detecting claude-log-generator, etc.)
- Fallback to reporting 'notFound' if process check fails

## Success Metrics

1. **Golden Claude Status Reporting**: Golden claudes successfully send status updates to hub (no more "HUB_STATUS_PORT not set" errors)
2. **Status Update Routing**: Hub correctly routes golden claude status to `goldenClaudes` map (no more "unknown thopter" warnings)
3. **Enhanced Status Accuracy**: Both thopters and golden claudes correctly report Claude process status
4. **Dashboard Clarity**: Dashboard clearly distinguishes between tmux activity and Claude process status for both machine types
5. **Inverted Warning Logic**: 
   - Regular thopters show warning when Claude process is NOT running (bad for active work)
   - Golden claudes show warning when Claude process IS running (bad for filesystem stability)
6. **Usability**: Team can quickly identify problematic machines and inappropriate Claude process states from dashboard view

## Implementation Scope

### Code Changes (To Be Implemented):
1. **All TypeScript interface updates** for new camelCase schema
2. **Observer script modifications** to add Claude process detection and fix field naming
3. **Collector validation updates** for new field requirements
4. **State manager routing fixes** including golden claude support and session preservation
5. **Dashboard template updates** with multi-line status and golden claude warnings
6. **CSS updates** for new status display styling

### User Deployment Tasks:
1. **Deploy updated hub code** to production environment
2. **Recreate golden claudes** with fixed environment variables (APP_NAME, HUB_STATUS_PORT)
3. **Recreate regular thopters** to use new observer and schema
4. **Test end-to-end flow**: observer → collector → state manager → dashboard
5. **Verify golden claude warnings** appear correctly in dashboard

## Future Enhancements

1. **Health scoring**: Combine machine state + tmux state + claude process into single health score
2. **Alerting**: Notify when healthy machines don't have Claude running
3. **Auto-recovery**: Automatic restart of Claude process when detected as not running  
4. **Process details**: Show which Claude command/session is running
5. **Golden claude management**: Dashboard controls for golden claude lifecycle (restart, kill, etc.)