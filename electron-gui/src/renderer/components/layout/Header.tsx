import { useCallback } from 'react'
import { Plus, KeyRound, LayoutDashboard, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { statusDotColor } from '@/lib/status-config'
import { useStore } from '@/store'

const SPECIAL_TAB_PREFIXES: { prefix: string; label: string; Icon: typeof Plus }[] = [
  { prefix: '__run__', label: 'Run New Thopter', Icon: Plus },
  { prefix: '__reauth__', label: 'Re-Authenticate', Icon: KeyRound },
]

function getSpecialTab(tab: string) {
  return SPECIAL_TAB_PREFIXES.find((s) => tab.startsWith(s.prefix))
}

let runTabCounter = 0

export function Header() {
  const activeTab = useStore((s) => s.activeTab)
  const openTabs = useStore((s) => s.openTabs)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const openTab = useStore((s) => s.openTab)
  const closeTab = useStore((s) => s.closeTab)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const thopters = useStore((s) => s.thopters)
  const thopterNotifications = useStore((s) => s.thopterNotifications)

  const openNewRunTab = useCallback(() => {
    openTab(`__run__${++runTabCounter}`)
  }, [openTab])

  return (
    <header className="flex items-center gap-1 px-2 py-1 border-b bg-card overflow-x-auto">
      {/* Dashboard tab */}
      <button
        role="tab"
        aria-selected={activeTab === 'dashboard'}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-sm rounded-md cursor-pointer transition-colors shrink-0',
          activeTab === 'dashboard'
            ? 'bg-background font-medium shadow-sm'
            : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
        )}
        onClick={() => setActiveTab('dashboard')}
      >
        <LayoutDashboard className="size-3.5" />
        Dashboard
      </button>

      {/* Open tabs */}
      {openTabs.map((tab) => {
        const special = getSpecialTab(tab)
        const label = special?.label ?? tab
        const Icon = special?.Icon
        const hasUnread = !special && thopterNotifications[tab]?.unread
        const thopterStatus = !special ? thopters[tab]?.status : null

        return (
          <div
            key={tab}
            className={cn(
              'flex items-center gap-0.5 rounded-md transition-colors group shrink-0',
              activeTab === tab
                ? 'bg-background shadow-sm'
                : 'hover:bg-background/50'
            )}
          >
            <button
              role="tab"
              aria-selected={activeTab === tab}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-sm cursor-pointer',
                activeTab === tab ? 'font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab(tab)}
            >
              {Icon ? (
                <Icon className="size-3.5" />
              ) : (
                <span className={cn('size-2 rounded-full shrink-0', statusDotColor(thopterStatus ?? null))} />
              )}
              {label}
              {hasUnread && (
                <span className="size-1.5 rounded-full bg-destructive shrink-0 animate-pulse" />
              )}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${label} tab`}
              className={cn(
                'mr-0.5 transition-opacity',
                activeTab === tab
                  ? 'opacity-60 hover:opacity-100'
                  : 'opacity-0 group-hover:opacity-100'
              )}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab)
              }}
            >
              <X />
            </Button>
          </div>
        )
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection status */}
      {connectionStatus === 'error' && (
        <Badge variant="destructive" className="text-[10px] shrink-0">disconnected</Badge>
      )}
      {connectionStatus === 'loading' && (
        <Badge variant="secondary" className="text-[10px] shrink-0">loading...</Badge>
      )}

      {/* Global actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="default" size="sm" className="h-7 text-xs" onClick={openNewRunTab}>
          <Plus className="size-3.5" />
          Run
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openTab('__reauth__')}>
              <KeyRound className="size-3.5" />
              Re-Auth
            </Button>
          </TooltipTrigger>
          <TooltipContent>Update Claude Code credentials</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
