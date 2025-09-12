import { ThopterState, OrphanStatus } from './types';

/**
 * Get the work branch name for a thopter (derived field)
 */
export function getWorkBranch(thopter: ThopterState): string | undefined {
  return thopter.github ? `thopter/${thopter.github.issueNumber}--${thopter.fly.id}` : undefined;
}

/**
 * Get the web terminal URL for a thopter (derived field)
 */
export function getWebTerminalUrl(thopter: ThopterState, appName: string, port: number = 7681): string {
  return `http://${thopter.fly.id}.vm.${appName}.internal:${port}/`;
}

/**
 * Get the repository for a thopter (derived field)
 */
export function getRepository(thopter: ThopterState): string | undefined {
  return thopter.github?.repository;
}

/**
 * Get the source for a thopter (derived field)
 */
export function getSource(thopter: ThopterState): 'github' | undefined {
  return thopter.github ? 'github' : undefined;
}

/**
 * Check if a machine name follows the valid thopter pattern
 */
export function isValidThopterPattern(machineName: string): boolean {
  // Matches existing logic in status.sh - thopter machines should start with "thopter-"
  return machineName.startsWith('thopter-');
}

/**
 * Compute orphan status for a thopter (derived field, never stored)
 */
export function getOrphanStatus(thopter: ThopterState): OrphanStatus {
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
  return { isOrphan: false };
}

/**
 * Dashboard data categories based on fly state + orphan status
 */
export interface DashboardData {
  // Primary categories based on fly state + orphan status
  healthyThopters: ThopterState[];    // fly.machineState === 'started' && !isOrphan
  orphanedThopters: ThopterState[];   // isOrphan === true (any reason)
  stoppedThopters: ThopterState[];    // fly.machineState !== 'started'
}

/**
 * Categorize thopters for dashboard display
 */
export function categorizeThopters(thopters: ThopterState[]): DashboardData {
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

/**
 * Group thopters by mentionAuthor (or 'unknown' if no GitHub context)
 */
export function groupThoptersByUser(thopters: ThopterState[]): Map<string, ThopterState[]> {
  const groupedThopters = new Map<string, ThopterState[]>();
  
  for (const thopter of thopters) {
    const mentionAuthor = thopter.github?.mentionAuthor || 'unknown';
    if (!groupedThopters.has(mentionAuthor)) {
      groupedThopters.set(mentionAuthor, []);
    }
    groupedThopters.get(mentionAuthor)!.push(thopter);
  }
  
  return groupedThopters;
}

