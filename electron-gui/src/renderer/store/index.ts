import { create } from 'zustand'
import type { Store } from './types'
import type { ThopterInfo, Unsubscribe } from '../services/types'
import { getService } from '../services'

const transcriptSubs = new Map<string, Unsubscribe>()

export const useStore = create<Store>((set, get) => ({
  // Internal state
  thopters: {},
  transcripts: {},
  notifications: [],
  repos: [],
  snapshots: [],
  config: null,
  connectionStatus: 'loading',

  // Display state
  activeTab: 'dashboard',
  openTabs: [],
  isRunModalOpen: false,
  runModalStep: 0,
  isReauthModalOpen: false,
  reauthModalStep: 0,
  isSidebarOpen: false,
  unreadNotificationCount: 0,

  // Data actions
  refreshThopters: async () => {
    try {
      const service = getService()
      const list = await service.listThopters()
      const thopters: Record<string, ThopterInfo> = {}
      for (const t of list) thopters[t.name] = t
      set({ thopters, connectionStatus: 'connected' })
    } catch (err) {
      console.error('[store] refreshThopters failed:', err)
      set({ connectionStatus: 'error' })
    }
  },

  fetchTranscript: async (name: string) => {
    const service = getService()
    const entries = await service.getTranscript(name)
    set((s) => ({ transcripts: { ...s.transcripts, [name]: entries } }))
  },

  subscribeTranscript: (name: string) => {
    // Clean up existing subscription
    const existing = transcriptSubs.get(name)
    if (existing) existing()

    const service = getService()
    const unsub = service.subscribeTranscript(name, (entry) => {
      set((s) => ({
        transcripts: {
          ...s.transcripts,
          [name]: [...(s.transcripts[name] || []), entry],
        },
      }))
    })
    transcriptSubs.set(name, unsub)
  },

  unsubscribeTranscript: (name: string) => {
    const unsub = transcriptSubs.get(name)
    if (unsub) {
      unsub()
      transcriptSubs.delete(name)
    }
  },

  // Thopter operations
  runThopter: async (opts) => {
    const service = getService()
    const result = await service.runThopter(opts)
    get().refreshThopters()
    return result.name
  },

  tellThopter: async (name, message, interrupt) => {
    const service = getService()
    await service.tellThopter(name, message, interrupt)
  },

  destroyThopter: async (name) => {
    const service = getService()
    await service.destroyThopter(name)
    get().unsubscribeTranscript(name)
    get().closeTab(name)
    get().refreshThopters()
  },

  suspendThopter: async (name) => {
    const service = getService()
    await service.suspendThopter(name)
    get().refreshThopters()
  },

  resumeThopter: async (name) => {
    const service = getService()
    await service.resumeThopter(name)
    get().refreshThopters()
  },

  attachThopter: (name) => {
    const service = getService()
    service.attachThopter(name)
  },

  // UI actions
  setActiveTab: (tab) => set({ activeTab: tab }),

  openTab: (name) => {
    set((s) => ({
      openTabs: s.openTabs.includes(name) ? s.openTabs : [...s.openTabs, name],
      activeTab: name,
    }))
  },

  closeTab: (name) => {
    set((s) => {
      const openTabs = s.openTabs.filter((t) => t !== name)
      const activeTab =
        s.activeTab === name
          ? openTabs[openTabs.length - 1] || 'dashboard'
          : s.activeTab
      return { openTabs, activeTab }
    })
  },

  openRunModal: () => set({ isRunModalOpen: true, runModalStep: 0 }),
  closeRunModal: () => set({ isRunModalOpen: false, runModalStep: 0 }),
  setRunModalStep: (step) => set({ runModalStep: step }),

  openReauthModal: () => set({ isReauthModalOpen: true, reauthModalStep: 0 }),
  closeReauthModal: () => set({ isReauthModalOpen: false, reauthModalStep: 0 }),

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  markNotificationsRead: () => set({ unreadNotificationCount: 0 }),

  addNotification: (notification) => {
    set((s) => ({
      notifications: [notification, ...s.notifications],
      unreadNotificationCount: s.unreadNotificationCount + 1,
    }))
  },

  removeNotification: (id) => {
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    }))
  },

  clearNotifications: () => {
    set({ notifications: [], unreadNotificationCount: 0 })
  },
}))
