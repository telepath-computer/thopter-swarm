// ThopterService interface and all data types for the Electron GUI.
// Modeled after the CLI's Redis data model (status.ts, tail.ts, config.ts).

// --- Core data types ---

export type ThopterStatus = 'running' | 'waiting' | 'done' | 'inactive';

export type DevboxStatus =
  | 'running'
  | 'suspended'
  | 'provisioning'
  | 'initializing'
  | 'suspending'
  | 'resuming'
  | 'shutdown';

export interface ThopterInfo {
  name: string;
  owner: string | null;
  id: string | null;
  status: ThopterStatus | null;
  task: string | null;
  heartbeat: string | null; // ISO 8601
  alive: boolean;
  claudeRunning: boolean;
  lastMessage: string | null;
  devboxStatus: DevboxStatus;
}

export type TranscriptRole = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';

export interface TranscriptEntry {
  ts: string; // ISO 8601
  role: TranscriptRole;
  summary: string;
  full?: string; // Optional full markdown content
}

export interface SnapshotInfo {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
}

export interface RepoConfig {
  repo: string; // owner/repo format
  branch?: string;
}

export interface RunThopterOpts {
  repo: string;
  branch?: string;
  prompt: string;
  name?: string;
  snapshotId?: string;
  keepAliveMinutes?: number;
}

export type ReauthMachine = 'existing' | 'snapshot' | 'fresh';

export interface ReauthOpts {
  machine: ReauthMachine;
  devboxName?: string;
  snapshotName: string;
}

export interface AppConfig {
  defaultRepo?: string;
  defaultBranch?: string;
  defaultSnapshot?: string;
  ntfyChannel?: string;
  repos: RepoConfig[];
  stopNotifications: boolean;
  stopNotificationQuietPeriod: number;
}

// --- Notification types (ntfy.sh) ---

export interface NtfyNotification {
  id: string;
  time: number; // Unix epoch seconds
  event: string;
  topic: string;
  title?: string;
  message: string;
  tags?: string[];
}

// --- Service interface ---

export type Unsubscribe = () => void;

export interface ClaudeReadyStatus {
  tmux: boolean;
  claude: boolean;
}

export interface ThopterService {
  // Queries
  listThopters(): Promise<ThopterInfo[]>;
  getThopterStatus(name: string): Promise<ThopterInfo>;
  getTranscript(name: string, lines?: number): Promise<TranscriptEntry[]>;
  subscribeTranscript(name: string, onEntry: (entry: TranscriptEntry) => void): Unsubscribe;
  listSnapshots(): Promise<SnapshotInfo[]>;
  listRepos(): Promise<RepoConfig[]>;
  getConfig(): Promise<AppConfig>;
  checkClaude(name: string): Promise<ClaudeReadyStatus>;
  getScreenDump(name: string): Promise<string | null>;

  // SSH
  getSSHSpawn(name: string): Promise<{ command: string; args: string[] }>;

  // Mutations
  runThopter(opts: RunThopterOpts): Promise<{ name: string }>;
  tellThopter(name: string, message: string, interrupt?: boolean): Promise<void>;
  destroyThopter(name: string): Promise<void>;
  suspendThopter(name: string): Promise<void>;
  resumeThopter(name: string): Promise<void>;
  updateTask(name: string, task: string): Promise<void>;
  attachThopter(name: string): void;
  reauth(opts: ReauthOpts): Promise<void>;
}
