import type {
  ThopterInfo,
  TranscriptEntry,
  NtfyNotification,
  RepoConfig,
  SnapshotInfo,
  AppConfig,
  ClaudeReadyStatus,
  RunThopterOpts,
} from '../services/types'

export interface StoreState {
  // Internal state (data layer)
  thopters: Record<string, ThopterInfo>
  transcripts: Record<string, TranscriptEntry[]>
  notifications: NtfyNotification[]
  repos: RepoConfig[]
  snapshots: SnapshotInfo[]
  config: AppConfig | null
  connectionStatus: 'connected' | 'error' | 'loading'
  refreshing: boolean
  claudeReady: Record<string, ClaudeReadyStatus>
  screenDumps: Record<string, string | null>
  detailViewMode: Record<string, 'transcript' | 'terminal' | 'ssh' | 'tmux'>
  liveTerminals: string[] // thopter names with active live terminal sessions
  draftMessages: Record<string, string>

  // Display state (UI layer)
  activeTab: 'dashboard' | string
  openTabs: string[]
  isSidebarOpen: boolean
  autoRefresh: boolean
  unreadNotificationCount: number
}

export interface StoreActions {
  // Data actions
  refreshThopters(): void
  fetchTranscript(name: string): void
  subscribeTranscript(name: string): void
  unsubscribeTranscript(name: string): void

  // Thopter operations
  checkClaude(name: string): Promise<void>
  runThopter(opts: RunThopterOpts): Promise<string>
  tellThopter(name: string, message: string, interrupt?: boolean): Promise<void>
  updateTask(name: string, task: string): Promise<void>
  destroyThopter(name: string): Promise<void>
  suspendThopter(name: string): Promise<void>
  resumeThopter(name: string): Promise<void>
  attachThopter(name: string): void

  // Screen dump
  fetchScreenDump(name: string): Promise<void>
  setDetailViewMode(name: string, mode: 'transcript' | 'terminal' | 'ssh' | 'tmux'): void

  // UI actions
  setActiveTab(tab: string): void
  openTab(name: string): void
  closeTab(name: string): void
  toggleSidebar(): void
  setDraftMessage(name: string, message: string): void
  setAutoRefresh(enabled: boolean): void
  markNotificationsRead(): void
  addNotification(notification: NtfyNotification): void
  removeNotification(id: string): void
  clearNotifications(): void
}

export type Store = StoreState & StoreActions
