import { useStore } from '@/store'
import { ThopterCard } from './ThopterCard'
import { Loader2, WifiOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Dashboard() {
  const thopters = useStore((s) => s.thopters)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const refreshing = useStore((s) => s.refreshing)
  const refreshThopters = useStore((s) => s.refreshThopters)

  const list = Object.values(thopters)
  const running = list.filter((t) => t.devboxStatus !== 'suspended')
  const suspended = list.filter((t) => t.devboxStatus === 'suspended')

  if (connectionStatus === 'loading' && list.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>Loading thopters...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Connection error banner */}
      {connectionStatus === 'error' && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <WifiOff className="size-4 text-destructive shrink-0" />
          <span className="text-destructive-foreground/80">
            Unable to connect to the service. Data may be stale.
          </span>
          <button
            className="ml-auto text-xs text-primary hover:underline shrink-0"
            onClick={() => refreshThopters()}
          >
            Retry
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted-foreground/50">
          Auto-refreshing every 5s
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => refreshThopters()}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? 'size-3 animate-spin' : 'size-3'} />
          Refresh
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[calc(100%-3rem)] text-muted-foreground gap-2">
          <p className="text-lg">No thopters running</p>
          <p className="text-sm">Click "Run New Thopter" to get started.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Running section */}
          {running.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                Running
                <span className="ml-2 text-xs text-muted-foreground/60">{running.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {running.map((t) => (
                  <ThopterCard key={t.name} thopter={t} />
                ))}
              </div>
            </section>
          )}

          {/* Suspended section */}
          {suspended.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                Suspended
                <span className="ml-2 text-xs text-muted-foreground/60">{suspended.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 opacity-50">
                {suspended.map((t) => (
                  <ThopterCard key={t.name} thopter={t} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
