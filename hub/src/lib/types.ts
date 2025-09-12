// GitHub comment for conversation thread
export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

// GitHub context - grouped together
export interface GitHubContext {
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

// Future: Slack context later

// Status updates from observers (authoritative source)
export interface ThopterStatusUpdate {
  // Core status
  agent_id: string;
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

// Internal agent state
export interface AgentState {
  id: string;
  machineId: string;
  state: 'provisioning' | 'running' | 'idle' | 'failed' | 'orphaned' | 'killing';
  
  // Core fields
  repository?: string;
  workBranch?: string;
  spawnedAt?: Date;
  lastActivity?: Date;
  idle_since?: Date;
  screenDump?: string;
  webTerminalUrl?: string;
  hasObserver: boolean;  // False = orphaned
  
  // Source tracking
  source?: 'github';  // Optional for orphaned machines
  github?: GitHubContext;  // Optional for orphaned machines
}

// Golden Claude state tracking
export interface GoldenClaudeState {
  id: string;
  name: string;  // e.g. "default", "josh", "xyz"
  machineId: string;
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
  agentId?: string;  // Set after agent is created
  
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
  
  // Target agent
  agentId: string;
  reason?: string;  // Why destroying (idle, user request, etc)
}

// System logging
export interface LogEvent {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  agentId?: string;
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