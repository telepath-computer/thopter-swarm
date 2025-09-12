# Orphan Thopters Detection and Management Proposal

## Current State Analysis

Currently, Thopter Swarm has these components for state management:

1. **State Manager** (`hub/src/lib/state-manager.ts:68-110`) - Bootstraps by querying `fly machines list` and adds thopter machines in 'orphaned' state
2. **Agent State Types** (`hub/src/lib/types.ts:51`) - Includes states: 'provisioning', 'running', 'idle', 'failed', 'orphaned', 'killing' 
3. **Status Script** (`fly/status.sh:161-183`) - Shows agent thopters by filtering `thopter-*` machines and detecting unknown machines
4. **Session Observer Mechanism** - Updates agent state from 'orphaned' to 'running'/'idle' when observers report in

## Problem Statement

Thopters can fail to fully provision due to startup failures, entering a "limbo state" where:
- They exist as fly machines but don't report to the hub dashboard
- They consume resources but aren't visible/manageable in the dashboard  
- They may be running but stuck, crashed, or have broken observers
- No mechanism exists to detect or clean up these orphaned instances

## Strategy Evaluation

### Strategy 1: Enhanced Status Tracking (Current Approach)
**Approach**: Extend current orphan detection in state manager with periodic cleanup
- **Pros**: Builds on existing architecture, minimal disruption
- **Cons**: Still reactive, complex state reconciliation logic, potential race conditions

### Strategy 2: Machine-Centric State Management 
**Approach**: Make fly machines list the single source of truth, derive agent state from machine state + observer data
- **Pros**: Eliminates state drift, simpler consistency model, naturally handles all machine states
- **Cons**: Requires significant refactoring, more fly API calls

### Strategy 3: Hybrid Observer + Machine State
**Approach**: Separate machine lifecycle from agent/Claude state, track both independently
- **Pros**: Clear separation of concerns, robust to observer failures, comprehensive visibility
- **Cons**: More complex data model, requires careful state synchronization

### Strategy 4: Active Health Monitoring
**Approach**: Add active health checks to detect non-responsive thopters
- **Pros**: Proactive detection, can catch stuck/crashed instances
- **Cons**: Adds complexity, potential false positives, network overhead

## Recommended Proposal: Fly-First State Management

### Core Concept

Refactor the agent tracking system to be **fly-centric** where fly machines are the single authoritative source of truth. All other data (session state, GitHub context) is best-effort metadata that enhances the core machine state but never contradicts it.

### Architecture Changes

#### 1. Clean Core State Model
Replace the current `AgentState` with a clean separation of concerns:

```typescript
interface ThopterState {
  // === FLY INFRASTRUCTURE (authoritative, always present) ===
  fly: {
    id: string;              // machine.id
    name: string;            // machine.name (e.g. "thopter-abc123")
    machineState: 'started' | 'stopped' | 'suspended' | 'destroyed';
    region: string;          // machine.region
    image: string;           // machine.image_ref.tag
    createdAt: Date;         // machine.created_at (actual spawn time)
  };
  
  // === HUB MANAGEMENT (ephemeral) ===
  hub: {
    killRequested: boolean;  // true when user requests kill, cleared on fail/timeout
  };
  
  // === THOPTER SESSION (nullable, best-effort from observer) ===
  session?: {
    claudeState: 'running' | 'idle';
    lastActivity: Date;
    idleSince?: Date;
    screenDump: string;
    hasObserver: true;
  };
  
  // === GITHUB CONTEXT (nullable, from provisioning) ===
  github?: GitHubContext;
}

// Enhanced GitHubContext with repository field
interface GitHubContext {
  repository: string;       // e.g. "owner/repo" - REQUIRED
  issueNumber: string;
  issueTitle: string;
  issueBody: string;
  issueUrl: string;
  issueAuthor: string;
  mentionCommentId?: number;
  mentionAuthor: string;
  mentionLocation: 'body' | 'comment';
  assignees?: string[];
  labels?: string[];
  comments?: GitHubComment[];
}

// All derived fields (computed on-demand, never stored)
function getWorkBranch(thopter: ThopterState): string | undefined {
  return thopter.github ? `${thopter.github.issueNumber}--${thopter.fly.id}` : undefined;
}

function getWebTerminalUrl(thopter: ThopterState, appName: string, port: number = 7681): string {
  return `http://${thopter.fly.id}.vm.${appName}.internal:${port}/`;
}

function getRepository(thopter: ThopterState): string | undefined {
  return thopter.github?.repository;
}

function getSource(thopter: ThopterState): 'github' | undefined {
  return thopter.github ? 'github' : undefined;
}
```

#### 2. Derived Orphan Status
Instead of storing 'orphaned' as a state, compute it dynamically based on the fly-first principle:

```typescript
interface OrphanStatus {
  isOrphan: boolean;
  reason: 'machine_stopped' | 'no_observer' | 'stale_session';
  lastSeen?: Date;
  secondsSinceLastUpdate?: number;
}

function getOrphanStatus(thopter: ThopterState): OrphanStatus {
  // Priority 1: Machine not started = definitely orphan (authoritative from fly)
  if (thopter.fly.machineState !== 'started') {
    return { isOrphan: true, reason: 'machine_stopped' };
  }
  
  // Priority 2: Machine started but no observer = orphan (broken provisioning/startup)
  // Grace period: newly created machines (<2 min) are still starting up
  if (!thopter.session) {
    const machineAgeMs = Date.now() - thopter.fly.createdAt.getTime();
    const startupGracePeriodMs = 2 * 60 * 1000; // 2 minutes
    
    if (machineAgeMs < startupGracePeriodMs) {
      // Still in startup grace period, not an orphan yet
      return { isOrphan: false };
    }
    
    return { isOrphan: true, reason: 'no_observer' };
  }
  
  // Priority 3: Observer present but stale (>2 minutes) = orphan (stuck/crashed)
  const staleThresholdMs = 2 * 60 * 1000;
  const timeSinceUpdate = Date.now() - thopter.session.lastActivity.getTime();
  if (timeSinceUpdate > staleThresholdMs) {
    return { 
      isOrphan: true, 
      reason: 'stale_session',
      lastSeen: thopter.session.lastActivity,
      secondsSinceLastUpdate: Math.floor(timeSinceUpdate / 1000)
    };
  }
  
  // Healthy: machine started and observer actively reporting
  return { isOrphan: false, reason: undefined };
}

function isValidThopterPattern(machineName: string): boolean {
  // Matches existing logic in status.sh - thopter machines should start with "thopter-"
  return machineName.startsWith('thopter-');
}
```

#### 3. Fly-First Reconciliation
Replace bootstrap with continuous reconciliation that treats fly machines as authoritative:

```typescript
class StateManager {
  private reconcileInterval: NodeJS.Timeout | null = null;
  private thopters: Map<string, ThopterState> = new Map();
  
  async startReconciliation(): Promise<void> {
    // Initial sync with fly
    await this.reconcileWithFly();
    
    // Continuous reconciliation every 30 seconds
    this.reconcileInterval = setInterval(() => {
      this.reconcileWithFly().catch(error => {
        logger.error(`Fly reconciliation failed: ${error.message}`, undefined, 'state-manager');
      });
    }, 30000);
  }
  
  private async reconcileWithFly(): Promise<void> {
    // Fly machines are the single source of truth
    const flyMachines = await this.getFlyMachines();
    const thopterMachines = flyMachines.filter(m => 
      m.name && isValidThopterPattern(m.name)
    );
    
    const newThopters = new Map<string, ThopterState>();
    
    // Build state from fly data + preserved session/context
    for (const machine of thopterMachines) {
      const existing = this.thopters.get(machine.id);
      
      const thopterState: ThopterState = {
        // === FLY DATA (authoritative) ===
        fly: {
          id: machine.id,
          name: machine.name,
          machineState: machine.state,
          region: machine.region,
          image: machine.image_ref?.tag || 'unknown',
          createdAt: new Date(machine.created_at)
        },
        
        // === HUB MANAGEMENT (preserve existing) ===
        hub: {
          killRequested: existing?.hub?.killRequested || false
        },
        
        // === SESSION STATE (preserve if valid, clear if stale) ===
        session: this.preserveValidSession(existing?.session),
        
        // === GITHUB CONTEXT (preserve existing) ===
        github: existing?.github
      };
      
      newThopters.set(machine.id, thopterState);
    }
    
    // Log changes and update
    this.logThopterChanges(this.thopters, newThopters);
    this.thopters = newThopters;
  }
  
  private preserveValidSession(session?: ThopterState['session']): ThopterState['session'] {
    if (!session) return undefined;
    
    // Clear stale sessions during reconciliation
    const staleThresholdMs = 5 * 60 * 1000; // 5 minutes for reconciliation
    const timeSinceUpdate = Date.now() - session.lastActivity.getTime();
    
    return timeSinceUpdate < staleThresholdMs ? session : undefined;
  }
}
```

#### 4. Observer Integration
Update the observer status handler to only populate session state and GitHub context:

```typescript
updateThopterFromStatus(status: ThopterStatusUpdate): void {
  let thopter = this.thopters.get(status.agent_id);
  
  if (!thopter) {
    logger.warn(`Received status for unknown thopter: ${status.agent_id}`, status.agent_id, 'state-manager');
    // Don't auto-create - fly reconciliation will discover it if it exists
    // This prevents phantom agents from bad status updates
    return;
  }
  
  // Update session state (best-effort metadata)
  thopter.session = {
    claudeState: status.state,
    lastActivity: new Date(status.last_activity),
    idleSince: status.idle_since ? new Date(status.idle_since) : undefined,
    screenDump: status.screen_dump,
    hasObserver: true
  };
  
  // Update GitHub context if provided (best-effort metadata)
  // Note: status.github should include repository field now
  if (status.github) {
    thopter.github = status.github;
  }
  
  // Log successful status update
  logger.debug(`Updated thopter session state: ${status.agent_id}`, status.agent_id, 'state-manager');
}
```

#### 5. Dashboard Enhancements
Update dashboard to clearly separate infrastructure status from session status:

```typescript
interface DashboardData {
  // Primary categories based on fly state + orphan status
  healthyThopters: ThopterState[];    // fly.machineState === 'started' && !isOrphan
  orphanedThopters: ThopterState[];   // isOrphan === true (any reason)
  stoppedThopters: ThopterState[];    // fly.machineState !== 'started'
}

// Dashboard view helpers
function categorizeThopters(thopters: ThopterState[]): DashboardData {
  const healthy: ThopterState[] = [];
  const orphaned: ThopterState[] = [];
  const stopped: ThopterState[] = [];
  
  for (const thopter of thopters) {
    if (thopter.fly.machineState !== 'started') {
      stopped.push(thopter);
    } else {
      const orphanStatus = getOrphanStatus(thopter);
      if (orphanStatus.isOrphan) {
        orphaned.push(thopter);
      } else {
        healthy.push(thopter);
      }
    }
  }
  
  return {
    healthyThopters: healthy,
    orphanedThopters: orphaned,
    stoppedThopters: stopped
  };
}
```


Note: maintain grouping of each section of thopters into subgroups by (github.mentionAuthor || 'unknown')

### Benefits

1. **Complete Visibility**: All thopter machines visible regardless of observer status
2. **Authoritative State**: Fly machines list as single source of truth eliminates state drift
3. **Robust Cleanup**: Can identify and clean up truly orphaned resources
4. **Operational Insight**: Clear separation between infrastructure and application state
5. **Simplified Logic**: Derived orphan status eliminates complex state transitions
6. **Scalable**: Periodic reconciliation scales better than reactive state management

## Implementation Files & Changes

each of these files must be carefully reviewed and updated to migrate from the
old to the new state schema, using helpers where needed for derived data, and
properly handling when a field might be nullable as well.

- `hub/src/lib/types.ts`
- New file: `hub/src/lib/thopter-utils.ts` helper functions:
  - `getWorkBranch()`
  - `getWebTerminalUrl()`
  - `getRepository()`
  - `getSource()`
  - `getOrphanStatus()`
  - `isValidThopterPattern()`
- `hub/src/lib/state-manager.ts`
- `hub/src/lib/agent-manager.ts`
- `hub/src/dashboard/index.ts`
- `hub/views/dashboard.ejs`
- `hub/views/agent-detail.ejs`
- `hub/src/collector/index.ts`
- `hub/src/lib/provisioner.ts`
- `hub/src/lib/github-polling-manager.ts`
- `hub/src/index.ts`
- `thopter/scripts/observer.sh`
- `fly/status.sh`

