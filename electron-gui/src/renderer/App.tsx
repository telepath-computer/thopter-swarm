import { useEffect, useRef } from 'react'
import { TooltipProvider } from './components/ui/tooltip'
import { Header } from './components/layout/Header'
import { ToastNotifications } from './components/layout/ToastNotifications'
import { Dashboard } from './components/dashboard/Dashboard'
import { ThopterDetail } from './components/detail/ThopterDetail'
import { RunTab } from './components/modals/RunTab'
import { ReauthTab } from './components/modals/ReauthTab'
import { useStore } from './store'
import { getService } from './services'
import { subscribeNtfy, subscribeMockNtfy } from './services/ntfy'

export default function App() {
  const activeTab = useStore((s) => s.activeTab)
  const openTabs = useStore((s) => s.openTabs)
  const refreshThopters = useStore((s) => s.refreshThopters)
  const autoRefresh = useStore((s) => s.autoRefresh)
  const appFocused = useStore((s) => s.appFocused)
  const setAppFocused = useStore((s) => s.setAppFocused)
  const addNotification = useStore((s) => s.addNotification)

  // Track app visibility (window focus + page visibility)
  useEffect(() => {
    const onVisibilityChange = () => setAppFocused(!document.hidden)
    const onFocus = () => setAppFocused(true)
    const onBlur = () => setAppFocused(false)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [setAppFocused])

  // Initial load + auto-refresh every 30 seconds (when enabled and app is focused).
  // On refocus, refresh immediately if stale (>= 30s since last refresh).
  const lastRefreshAt = useRef(0)
  const doRefresh = () => {
    refreshThopters()
    lastRefreshAt.current = Date.now()
  }

  useEffect(() => {
    doRefresh()
  }, [refreshThopters])

  useEffect(() => {
    if (!autoRefresh || !appFocused) return
    if (Date.now() - lastRefreshAt.current >= 30_000) {
      doRefresh()
    }
    const id = setInterval(doRefresh, 30_000)
    return () => clearInterval(id)
  }, [autoRefresh, appFocused, refreshThopters])

  // Subscribe to ntfy.sh notifications
  useEffect(() => {
    const isMock = typeof process !== 'undefined' && (process.env.THOPTER_MOCK === '1' || process.argv.includes('--mock'))

    if (isMock) {
      return subscribeMockNtfy(addNotification)
    }

    // Real mode: get ntfy channel from config
    let unsub: (() => void) | undefined
    let aborted = false

    const startNtfy = async () => {
      try {
        const config = await getService().getConfig()
        if (config.ntfyChannel) {
          return subscribeNtfy(config.ntfyChannel, addNotification)
        }
      } catch {
        // Non-fatal — notifications are optional
      }
    }

    startNtfy().then((u) => {
      if (aborted) u?.()
      else unsub = u
    })

    return () => {
      aborted = true
      unsub?.()
    }
  }, [addNotification])

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-background text-foreground">
        <Header />
        <main className="flex-1 overflow-hidden relative">
          <div className="absolute inset-0" style={{ visibility: activeTab === 'dashboard' ? 'visible' : 'hidden', pointerEvents: activeTab === 'dashboard' ? undefined : 'none' }}>
            <Dashboard />
          </div>
          {openTabs.map((name) => (
            <div key={name} className="absolute inset-0" style={{ visibility: activeTab === name ? 'visible' : 'hidden', pointerEvents: activeTab === name ? undefined : 'none' }}>
              {name.startsWith('__run__') ? (
                <RunTab tabId={name} />
              ) : name.startsWith('__reauth__') ? (
                <ReauthTab />
              ) : (
                <ThopterDetail tabName={name} />
              )}
            </div>
          ))}
        </main>
        <ToastNotifications />
      </div>
    </TooltipProvider>
  )
}
