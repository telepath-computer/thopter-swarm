import { Activity, Clock, Server, User, Cpu } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn, relativeTime } from '@/lib/utils'
import type { ThopterInfo, ThopterStatus } from '@/services/types'

const statusConfig: Record<ThopterStatus, { label: string; color: string; dot: string }> = {
  running: {
    label: 'Running',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  waiting: {
    label: 'Waiting',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  done: {
    label: 'Done',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  inactive: {
    label: 'Inactive',
    color: 'bg-red-500/15 text-red-400 border-red-500/30',
    dot: 'bg-red-400',
  },
}

interface Props {
  thopter: ThopterInfo
}

export function StatusPanel({ thopter }: Props) {
  const status = thopter.status ?? 'inactive'
  const cfg = statusConfig[status] ?? statusConfig.inactive

  return (
    <div className="px-4 py-3 border-b bg-card/50">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold">{thopter.name}</h2>
          <Badge variant="outline" className={cn('text-[10px] gap-1.5 font-medium border', cfg.color)}>
            <span className={cn('size-1.5 rounded-full', cfg.dot)} />
            {cfg.label}
          </Badge>
        </div>

        <Separator orientation="vertical" className="h-5" />

        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {thopter.owner && (
            <span className="flex items-center gap-1">
              <User className="size-3" />
              {thopter.owner}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Server className="size-3" />
            {thopter.devboxStatus}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {relativeTime(thopter.heartbeat)}
          </span>
          <span className={cn('flex items-center gap-1', thopter.claudeRunning ? 'text-emerald-400' : 'text-muted-foreground')}>
            <Cpu className="size-3" />
            Claude {thopter.claudeRunning ? 'active' : 'stopped'}
          </span>
          {thopter.alive && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Activity className="size-3" />
              alive
            </span>
          )}
        </div>
      </div>

      {thopter.task && (
        <p className="text-xs text-muted-foreground mt-2">
          <span className="text-foreground/50 mr-1">Task:</span>
          {thopter.task}
        </p>
      )}
    </div>
  )
}
