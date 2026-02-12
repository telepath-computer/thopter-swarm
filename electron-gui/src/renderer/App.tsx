import { useEffect } from 'react'
import { TooltipProvider } from './components/ui/tooltip'
import { Header } from './components/layout/Header'
import { TabBar } from './components/layout/TabBar'
import { NotificationSidebar } from './components/layout/NotificationSidebar'
import { Dashboard } from './components/dashboard/Dashboard'
import { ThopterDetail } from './components/detail/ThopterDetail'
import { RunModal } from './components/modals/RunModal'
import { ReauthModal } from './components/modals/ReauthModal'
import { useStore } from './store'
import { getService } from './services'
import { subscribeNtfy, subscribeMockNtfy } from './services/ntfy'

export default function App() {
  const activeTab = useStore((s) => s.activeTab)
  const openTabs = useStore((s) => s.openTabs)
  const refreshThopters = useStore((s) => s.refreshThopters)
  const autoRefresh = useStore((s) => s.autoRefresh)
  const addNotification = useStore((s) => s.addNotification)

  // Initial load + auto-refresh every 30 seconds (when enabled)
  useEffect(() => {
    refreshThopters()
  }, [refreshThopters])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(refreshThopters, 30_000)
    return () => clearInterval(id)
  }, [autoRefresh, refreshThopters])

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
        <TabBar />
        <main className="flex-1 overflow-hidden">
          <div className="h-full" style={{ display: activeTab === 'dashboard' ? undefined : 'none' }}>
            <Dashboard />
          </div>
          {openTabs.map((name) => (
            <div key={name} className="h-full" style={{ display: activeTab === name ? undefined : 'none' }}>
              <ThopterDetail tabName={name} />
            </div>
          ))}
        </main>
        <NotificationSidebar />
        <RunModal />
        <ReauthModal />
      </div>
    </TooltipProvider>
  )
}
