import { X, LayoutDashboard, Plus, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

const SPECIAL_TABS: Record<string, { label: string; Icon: typeof Plus }> = {
  __run__: { label: 'Run New Thopter', Icon: Plus },
  __reauth__: { label: 'Re-Authenticate', Icon: KeyRound },
}

export function TabBar() {
  const activeTab = useStore((s) => s.activeTab)
  const openTabs = useStore((s) => s.openTabs)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeTab = useStore((s) => s.closeTab)

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/30 overflow-x-auto" role="tablist">
      <button
        role="tab"
        aria-selected={activeTab === 'dashboard'}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors',
          activeTab === 'dashboard'
            ? 'bg-background font-medium shadow-sm'
            : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
        )}
        onClick={() => setActiveTab('dashboard')}
      >
        <LayoutDashboard className="size-3.5" />
        Dashboard
      </button>
      {openTabs.map((tab) => {
        const special = SPECIAL_TABS[tab]
        const label = special?.label ?? tab
        const Icon = special?.Icon

        return (
          <div
            key={tab}
            className={cn(
              'flex items-center gap-0.5 rounded-md transition-colors group',
              activeTab === tab
                ? 'bg-background shadow-sm'
                : 'hover:bg-background/50'
            )}
          >
            <button
              role="tab"
              aria-selected={activeTab === tab}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-sm',
                activeTab === tab ? 'font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab(tab)}
            >
              {Icon && <Icon className="size-3.5" />}
              {label}
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
    </div>
  )
}
