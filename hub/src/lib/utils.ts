/**
 * Utility functions for the dashboard service
 */

/**
 * Format a timestamp as compact relative time (e.g., ":12", "3:12", "4:3:12")
 */
export function formatRelativeTime(timestamp: string | Date): string {
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    if (diffMs < 0) {
      return ':0';
    }
    
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    // Format as h:m:s but drop leading zeros
    if (hours > 0) {
      return `${hours}:${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    } else if (minutes > 0) {
      return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    } else {
      return `:${seconds < 10 ? '0' + seconds : seconds}`;
    }
  } catch (error) {
    console.warn('Failed to parse timestamp:', timestamp, error);
    return 'unknown';
  }
}

/**
 * Format a timestamp for absolute display (e.g., "2025-08-27T21:30:00Z")
 */
export function formatAbsoluteTime(timestamp: string | Date): string {
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return date.toISOString();
  } catch (error) {
    console.warn('Failed to parse timestamp:', timestamp, error);
    return 'invalid timestamp';
  }
}

/**
 * Get CSS class for thopter state
 */
export function getStateClass(state: string): string {
  switch (state?.toLowerCase()) {
    case 'running':
      return 'state-running';
    case 'idle':
      return 'state-idle';
    case 'provisioning':
      return 'state-provisioning';
    case 'orphaned':
      return 'state-orphaned';
    case 'killing':
      return 'state-killing';
    case 'failed':
    case 'error':
      return 'state-failed';
    default:
      return 'state-unknown';
  }
}

/**
 * Get CSS class for operating mode
 */
export function getModeClass(mode: string): string {
  switch (mode?.toLowerCase()) {
    case 'starting':
      return 'mode-starting';
    case 'running':
      return 'mode-running';
    case 'paused':
      return 'mode-paused';
    case 'stopping':
      return 'mode-stopping';
    default:
      return 'mode-unknown';
  }
}

/**
 * Get CSS class for request status
 */
export function getRequestStatusClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'pending':
      return 'status-pending';
    case 'processing':
      return 'status-processing';
    case 'completed':
      return 'status-completed';
    case 'failed':
      return 'status-failed';
    default:
      return 'status-unknown';
  }
}

/**
 * Get CSS class for log level
 */
export function getLogLevelClass(level: string): string {
  switch (level?.toLowerCase()) {
    case 'info':
      return 'log-info';
    case 'warn':
      return 'log-warn';
    case 'error':
      return 'log-error';
    case 'debug':
      return 'log-debug';
    default:
      return 'log-unknown';
  }
}

/**
 * Generate a unique request ID for operations
 */
export function generateRequestId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`;
}

/**
 * Generate web terminal URL for a thopter using fly.io internal networking
 */
export function generateTerminalUrl(thopterId: string, appName: string, port: number): string {
  return `http://${thopterId}.vm.${appName}.internal:${port}/`;
}

/**
 * Format idle duration in compact format
 */
export function formatIdleDuration(idle_since: string | Date | undefined, state: string): string {
  if (state !== 'idle' || !idle_since) {
    return '';
  }
  
  try {
    const idleStart = idle_since instanceof Date ? idle_since : new Date(idle_since);
    const now = new Date();
    const diffMs = now.getTime() - idleStart.getTime();
    
    if (diffMs < 0) {
      return '';
    }
    
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    // Format as h:m:s but drop leading zeros
    if (hours > 0) {
      return `${hours}:${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    } else if (minutes > 0) {
      return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    } else {
      return `:${seconds < 10 ? '0' + seconds : seconds}`;
    }
  } catch (error) {
    console.warn('Failed to parse idle_since timestamp:', idle_since, error);
    return '';
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Parse GitHub URL from repository string
 */
export function getGitHubUrl(repository: string, issueNumber?: string): string {
  const baseUrl = `https://github.com/${repository}`;
  if (issueNumber) {
    return `${baseUrl}/issues/${issueNumber}`;
  }
  return baseUrl;
}

/**
 * Generate GitHub tree URL for repository branch
 */
export function getGitHubTreeUrl(repository: string, branch: string): string {
  return `https://github.com/${repository}/tree/${branch}`;
}

/**
 * Get the service discovery URL for the hub dashboard
 */
export function getDashboardUrl(): string {
  const appName = process.env.APP_NAME || 'swarm1';
  const hubPort = process.env.HUB_PORT || '8080';
  
  // Use fly.io service discovery
  return `http://1.hub.kv._metadata.${appName}.internal:${hubPort}`;
}