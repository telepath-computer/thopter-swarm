import { useState } from 'react'
import { useStore } from '@/store'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { X, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import type { NtfyNotification } from '@/services/types'

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

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: NtfyNotification
  onDismiss: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = notification.message.length > 120

  return (
    <div className="group relative rounded-md border bg-card p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {notification.title && (
            <p className="text-sm font-medium leading-tight truncate">
              {notification.title}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {formatTime(notification.time)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => onDismiss(notification.id)}
        >
          <X className="size-3" />
        </Button>
      </div>

      <p className={`text-sm text-muted-foreground ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
        {notification.message}
      </p>

      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {notification.tags && notification.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {notification.tags.map((tag, i) => (
            <span key={i} className="text-[10px] bg-muted rounded px-1.5 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function NotificationSidebar() {
  const isOpen = useStore((s) => s.isSidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markNotificationsRead)
  const removeNotification = useStore((s) => s.removeNotification)
  const clearNotifications = useStore((s) => s.clearNotifications)

  function handleOpenChange(open: boolean) {
    if (!open) {
      toggleSidebar()
      markRead()
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-80 sm:max-w-sm p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center justify-between">
            <SheetTitle>Notifications</SheetTitle>
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={clearNotifications}
              >
                <Trash2 className="size-3" />
                Clear all
              </Button>
            )}
          </div>
          <SheetDescription>
            Events from your thopter fleet.
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <p className="text-sm text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Events from your thopters will appear here.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onDismiss={removeNotification}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
