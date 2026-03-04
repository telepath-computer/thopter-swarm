import { useCallback } from 'react'
import { Plus, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useStore } from '@/store'

let runTabCounter = 0

export function Header() {
  const openTab = useStore((s) => s.openTab)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const thopterNotifications = useStore((s) => s.thopterNotifications)

  const unreadCount = Object.values(thopterNotifications).filter((n) => n.unread).length

  const openNewRunTab = useCallback(() => {
    openTab(`__run__${++runTabCounter}`)
  }, [openTab])

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
        {unreadCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {unreadCount} alert{unreadCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="default" size="sm" onClick={openNewRunTab}>
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
      </div>
    </header>
  )
}
