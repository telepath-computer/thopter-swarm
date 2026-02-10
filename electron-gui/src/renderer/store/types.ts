import type {
  ThopterInfo,
  TranscriptEntry,
  NtfyNotification,
  RepoConfig,
  SnapshotInfo,
  AppConfig,
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

  // Display state (UI layer)
  activeTab: 'dashboard' | string
  openTabs: string[]
  isRunModalOpen: boolean
  runModalStep: number
  isReauthModalOpen: boolean
  reauthModalStep: number
  isSidebarOpen: boolean
  unreadNotificationCount: number
}

export interface StoreActions {
  // Data actions
  refreshThopters(): void
  fetchTranscript(name: string): void
  subscribeTranscript(name: string): void
  unsubscribeTranscript(name: string): void

  // Thopter operations
  runThopter(opts: RunThopterOpts): Promise<string>
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
  addNotification(notification: NtfyNotification): void
  removeNotification(id: string): void
  clearNotifications(): void
}

export type Store = StoreState & StoreActions
