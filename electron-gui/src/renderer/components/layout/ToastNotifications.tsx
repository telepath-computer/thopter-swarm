import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

function formatTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ToastCard({
  thopterName,
  message,
  time,
  onDismiss,
  onClick,
}: {
  thopterName: string
  message: string
  time: number
  onDismiss: () => void
  onClick: () => void
}) {
  const [entering, setEntering] = useState(true)

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group relative w-80 rounded-lg border bg-card shadow-lg shadow-black/20 p-3 cursor-pointer',
        'hover:border-primary/40 transition-all duration-200',
        entering ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight truncate text-foreground">
            {thopterName}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatTime(time)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          <X className="size-3" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
        {message}
      </p>
    </div>
  )
}

export function ToastNotifications() {
  const thopterNotifications = useStore((s) => s.thopterNotifications)
  const dismissNotification = useStore((s) => s.dismissNotification)
  const openTab = useStore((s) => s.openTab)

  // Only show unread notifications
  const unreadEntries = Object.entries(thopterNotifications).filter(
    ([, state]) => state.unread,
  )

  if (unreadEntries.length === 0) return null

  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {unreadEntries.map(([name, state]) => (
        <div key={name} className="pointer-events-auto">
          <ToastCard
            thopterName={name}
            message={state.latest.message}
            time={state.latest.time}
            onDismiss={() => dismissNotification(name)}
            onClick={() => {
              dismissNotification(name)
              openTab(name)
            }}
          />
        </div>
      ))}
    </div>
  )
}
