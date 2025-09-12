// GitHub comment for conversation thread
export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

// GitHub context - grouped together with repository field required
export interface GitHubContext {
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
  comments?: GitHubComment[]; // Full conversation thread
}

// Status updates from observers (authoritative source)
export interface ThopterStatusUpdate {
  // Core status
  thopter_id: string;
  state: 'running' | 'idle';
  screen_dump: string;
  last_activity: string;
  timestamp: string;
  idle_since?: string | null;
  
  // Source-agnostic metadata
  repository?: string;
  workBranch?: string;
  spawned_at?: string;
  
  // Source-specific contexts
  github?: GitHubContext;
}

// New fly-first state structure
export interface ThopterState {
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
  };
  
  // === GITHUB CONTEXT (nullable, from provisioning) ===
  github?: GitHubContext;
}

// Orphan status (computed dynamically, never stored)
export interface OrphanStatus {
  isOrphan: boolean;
  reason?: 'machine_stopped' | 'no_observer' | 'stale_session';
  lastSeen?: Date;
  secondsSinceLastUpdate?: number;
}


// Golden Claude state tracking
export interface GoldenClaudeState {
  machineId: string;
  name: string;  // e.g. "default", "josh", "xyz"
  state: 'running' | 'stopped';
  webTerminalUrl?: string;
}

// Separate request types for provisioning and destroying
export interface ProvisionRequest {
  requestId: string;
  source: 'github';  // Only source for now
  createdAt: Date;
  completedAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  thopterId?: string;  // Set after thopter is created
  
  // Required for provisioning
  repository: string;
  workBranch?: string;
  gc?: string;  // Golden Claude to use (default: "default")
  prompt?: string;  // Prompt template to use (default: "default")
  
  // GitHub context (always present since only source)
  github: GitHubContext;
}

export interface DestroyRequest {
  requestId: string;
  source: 'dashboard' | 'api' | 'timeout';
  createdAt: Date;
  completedAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  
  // Target thopter
  thopterId: string;
  reason?: string;  // Why destroying (idle, user request, etc)
}

// System logging
export interface LogEvent {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  thopterId?: string;
  source?: string;
  context?: any;
}

// Operating modes for system state management
export type OperatingMode = 'initializing' | 'starting' | 'running' | 'paused' | 'stopping';

// GitHub Integration Configuration
export interface GitHubRepositoryConfig {
  issuesPAT: string;
  agentCoderPAT: string;
  userName: string;
  userEmail: string;
}

export interface GitHubIntegrationConfig {
  repositories: Record<string, GitHubRepositoryConfig>;
}