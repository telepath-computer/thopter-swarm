import type {
  ThopterInfo,
  TranscriptEntry,
  NtfyNotification,
  RepoConfig,
  SnapshotInfo,
  AppConfig,
  ClaudeReadyStatus,
  RunThopterOpts,
  InfrastructureProvider,
} from '../services/types'

/** Per-thopter notification state: only the latest notification matters */
export interface ThopterNotificationState {
  latest: NtfyNotification // Most recent notification for this thopter
  unread: boolean // Whether attention is needed
}

export interface StoreState {
  // Internal state (data layer)
  thopters: Record<string, ThopterInfo>
  transcripts: Record<string, TranscriptEntry[]>
  /** Per-thopter notification state — keyed by thopterName */
  thopterNotifications: Record<string, ThopterNotificationState>
  /** Notifications that couldn't be associated with a thopter */
  unassociatedNotifications: NtfyNotification[]
  repos: RepoConfig[]
  snapshots: SnapshotInfo[]
  config: AppConfig | null
  connectionStatus: 'connected' | 'error' | 'loading'
  refreshing: boolean
  claudeReady: Record<string, ClaudeReadyStatus>
  screenDumps: Record<string, string | null>
  detailViewMode: Record<string, 'transcript' | 'terminal' | 'ssh'>
  liveTerminals: string[] // thopter names with active live terminal sessions
  draftMessages: Record<string, string>
  provider: InfrastructureProvider
  /** Timestamp of last user interaction per detail view, for smart dismissal */
  lastDetailInteraction: Record<string, number>
  /** Whether the app window is focused and visible (controls polling) */
  appFocused: boolean

  // Display state (UI layer)
  activeTab: 'dashboard' | string
  openTabs: string[]
  autoRefresh: boolean
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
  updateStatusLine(name: string, statusLine: string): Promise<void>
  updateNotes(name: string, notes: string): Promise<void>
  destroyThopter(name: string): Promise<void>
  suspendThopter(name: string): Promise<void>
  resumeThopter(name: string): Promise<void>
  attachThopter(name: string): void

  // Screen dump
  fetchScreenDump(name: string): Promise<void>
  setDetailViewMode(name: string, mode: 'transcript' | 'terminal' | 'ssh'): void

  // UI actions
  setActiveTab(tab: string): void
  openTab(name: string): void
  closeTab(name: string): void
  setDraftMessage(name: string, message: string): void
  setAutoRefresh(enabled: boolean): void
  setAppFocused(focused: boolean): void

  // Notification actions
  addNotification(notification: NtfyNotification): void
  dismissNotification(thopterName: string): void
  dismissAllNotifications(): void
  /** Record a user interaction on a detail view (for smart dismissal) */
  recordDetailInteraction(thopterName: string): void
}

export type Store = StoreState & StoreActions
