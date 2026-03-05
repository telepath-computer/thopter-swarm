import { create } from 'zustand'
import type { Store } from './types'
import type { ThopterInfo, Unsubscribe } from '../services/types'
import { getService } from '../services'

const transcriptSubs = new Map<string, Unsubscribe>()

export const useStore = create<Store>((set, get) => ({
  // Internal state
  thopters: {},
  transcripts: {},
  thopterNotifications: {},
  unassociatedNotifications: [],
  repos: [],
  snapshots: [],
  config: null,
  connectionStatus: 'loading',
  refreshing: false,
  claudeReady: {},
  screenDumps: {},
  detailViewMode: {},
  liveTerminals: [],
  draftMessages: {},
  provider: 'unknown',
  lastDetailInteraction: {},

  // Display state
  activeTab: 'dashboard',
  openTabs: [],
  autoRefresh: true,

  // Data actions
  refreshThopters: async () => {
    set({ refreshing: true })
    try {
      const service = getService()
      const [provider, list] = await Promise.all([service.getProvider(), service.listThopters()])
      const thopters: Record<string, ThopterInfo> = {}
      for (const t of list) thopters[t.name] = t
      set({ provider, thopters, connectionStatus: 'connected' })
    } catch (err) {
      console.error('[store] refreshThopters failed:', err)
      set({ provider: 'unknown', connectionStatus: 'error' })
    } finally {
      set({ refreshing: false })
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
  checkClaude: async (name) => {
    const service = getService()
    try {
      const result = await service.checkClaude(name)
      set((s) => ({ claudeReady: { ...s.claudeReady, [name]: result } }))
    } catch {
      set((s) => ({ claudeReady: { ...s.claudeReady, [name]: { claude: false } } }))
    }
  },

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

  updateTask: async (name, task) => {
    const service = getService()
    await service.updateTask(name, task)
    // Update local state immediately
    set((s) => {
      const thopter = s.thopters[name]
      if (!thopter) return s
      return { thopters: { ...s.thopters, [name]: { ...thopter, task } } }
    })
  },

  destroyThopter: async (name) => {
    const service = getService()
    await service.destroyThopter(name)
    get().unsubscribeTranscript(name)
    get().closeTab(name)
    get().dismissNotification(name) // Auto-clear on destroy
    get().refreshThopters()
  },

  suspendThopter: async (name) => {
    const service = getService()
    await service.suspendThopter(name)
    get().dismissNotification(name) // Auto-clear on suspend
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

  // Screen dump
  fetchScreenDump: async (name) => {
    const service = getService()
    try {
      const dump = await service.getScreenDump(name)
      set((s) => ({ screenDumps: { ...s.screenDumps, [name]: dump } }))
    } catch {
      // Ignore transient Redis errors
    }
  },

  setDetailViewMode: (name, mode) => {
    set((s) => {
      const update: Partial<typeof s> = { detailViewMode: { ...s.detailViewMode, [name]: mode } }
      // Track live terminal sessions so they persist across tab switches
      if (mode === 'ssh' && !s.liveTerminals.includes(name)) {
        update.liveTerminals = [...s.liveTerminals, name]
      }
      return update
    })
  },

  // UI actions
  setActiveTab: (tab) => {
    set({ activeTab: tab })
    // Smart dismissal: switching to a thopter tab clears its notifications
    get().dismissNotification(tab)
  },

  openTab: (name) => {
    set((s) => ({
      openTabs: s.openTabs.includes(name) ? s.openTabs : [...s.openTabs, name],
      activeTab: name,
    }))
    // Smart dismissal: switching to a thopter's detail view clears its notifications
    get().dismissNotification(name)
  },

  closeTab: (name) => {
    set((s) => {
      const openTabs = s.openTabs.filter((t) => t !== name)
      const activeTab =
        s.activeTab === name
          ? openTabs[openTabs.length - 1] || 'dashboard'
          : s.activeTab
      return {
        openTabs,
        activeTab,
        liveTerminals: s.liveTerminals.filter((t) => t !== name),
      }
    })
  },

  setDraftMessage: (name, message) => set((s) => ({ draftMessages: { ...s.draftMessages, [name]: message } })),

  setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),

  // Notification actions
  addNotification: (notification) => {
    const thopterName = notification.thopterName
    if (!thopterName) {
      // Can't associate — store separately
      set((s) => ({
        unassociatedNotifications: [notification, ...s.unassociatedNotifications].slice(0, 50),
      }))
      return
    }

    const state = get()
    // Smart dismissal: if user is currently viewing this thopter's detail
    // AND has interacted recently (within 10s), auto-dismiss
    const isViewingDetail = state.activeTab === thopterName
    const lastInteraction = state.lastDetailInteraction[thopterName] ?? 0
    const recentlyInteracted = Date.now() - lastInteraction < 10_000

    if (isViewingDetail && recentlyInteracted) {
      // User is actively looking at this thopter — don't create unread
      set((s) => ({
        thopterNotifications: {
          ...s.thopterNotifications,
          [thopterName]: { latest: notification, unread: false },
        },
      }))
      return
    }

    set((s) => ({
      thopterNotifications: {
        ...s.thopterNotifications,
        [thopterName]: { latest: notification, unread: true },
      },
    }))
  },

  dismissNotification: (thopterName) => {
    set((s) => {
      const existing = s.thopterNotifications[thopterName]
      if (!existing) return s
      return {
        thopterNotifications: {
          ...s.thopterNotifications,
          [thopterName]: { ...existing, unread: false },
        },
      }
    })
  },

  dismissAllNotifications: () => {
    set((s) => {
      const updated: typeof s.thopterNotifications = {}
      for (const [name, state] of Object.entries(s.thopterNotifications)) {
        updated[name] = { ...state, unread: false }
      }
      return { thopterNotifications: updated }
    })
  },

  recordDetailInteraction: (thopterName) => {
    set((s) => ({
      lastDetailInteraction: {
        ...s.lastDetailInteraction,
        [thopterName]: Date.now(),
      },
    }))
  },
}))
