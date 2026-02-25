import { Bell, Plus, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useStore } from '@/store'

export function Header() {
  const openTab = useStore((s) => s.openTab)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const unreadCount = useStore((s) => s.unreadNotificationCount)
  const connectionStatus = useStore((s) => s.connectionStatus)

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b bg-card">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">Thopter Swarm</h1>
        {connectionStatus === 'error' && (
          <Badge variant="destructive" className="text-[10px]">disconnected</Badge>
        )}
        {connectionStatus === 'loading' && (
          <Badge variant="secondary" className="text-[10px]">loading...</Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="default" size="sm" onClick={() => openTab('__run__')}>
          <Plus />
          Run New Thopter
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => openTab('__reauth__')}>
              <KeyRound />
              Re-Authenticate
            </Button>
          </TooltipTrigger>
          <TooltipContent>Update Claude Code credentials</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={toggleSidebar}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
            >
              <Bell />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[10px] rounded-full min-w-4 h-4 flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
