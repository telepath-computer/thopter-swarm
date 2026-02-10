import { useStore } from '@/store'
import { ThopterCard } from './ThopterCard'
import { Loader2, WifiOff } from 'lucide-react'

export function Dashboard() {
  const thopters = useStore((s) => s.thopters)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const refreshThopters = useStore((s) => s.refreshThopters)

  const list = Object.values(thopters)

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

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
          <p className="text-lg">No thopters running</p>
          <p className="text-sm">Click "Run New Thopter" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((t) => (
            <ThopterCard key={t.name} thopter={t} />
          ))}
        </div>
      )}
    </div>
  )
}
