import { useState } from 'react'
import { Clock, MessageSquare, Cpu, Pause, Play, Trash2, User } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { cn, relativeTime } from '@/lib/utils'
import type { ThopterInfo, ThopterStatus } from '@/services/types'
import { useStore } from '@/store'

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

export function ThopterCard({ thopter }: Props) {
  const openTab = useStore((s) => s.openTab)
  const suspendThopter = useStore((s) => s.suspendThopter)
  const resumeThopter = useStore((s) => s.resumeThopter)
  const destroyThopter = useStore((s) => s.destroyThopter)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [confirmResume, setConfirmResume] = useState(false)
  const status = thopter.status ?? 'inactive'
  const cfg = statusConfig[status] ?? statusConfig.inactive
  const isSuspended = thopter.devboxStatus === 'suspended'
  const anyDialogOpen = confirmDestroy || confirmSuspend || confirmResume

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${thopter.name} - ${cfg.label}`}
      className="cursor-pointer hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-all duration-150 py-4 gap-3"
      onClick={() => { if (!anyDialogOpen) openTab(thopter.name) }}
      onKeyDown={(e) => {
        if (!anyDialogOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          openTab(thopter.name)
        }
      }}
    >
      <CardHeader className="gap-1.5 pb-0">
        <CardTitle className="text-sm">{thopter.name}</CardTitle>
        <CardAction>
          <Badge variant="outline" className={cn('text-[10px] gap-1.5 font-medium border', cfg.color)}>
            <span className={cn('size-1.5 rounded-full', cfg.dot)} />
            {cfg.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p className="line-clamp-2 text-foreground/80">{thopter.task ?? 'No task'}</p>
        <div className="flex items-center gap-3">
          {thopter.owner && (
            <span className="flex items-center gap-1">
              <User className="size-3" />
              {thopter.owner}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {relativeTime(thopter.heartbeat)}
          </span>
          {thopter.claudeRunning && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Cpu className="size-3" />
              Claude active
            </span>
          )}
          {!thopter.claudeRunning && thopter.alive && (
            <span className="flex items-center gap-1">
              <Cpu className="size-3" />
              Claude idle
            </span>
          )}
        </div>
        {thopter.lastMessage && (
          <div className="flex items-start gap-1">
            <MessageSquare className="size-3 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{thopter.lastMessage}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {isSuspended ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="xs" className="cursor-pointer" onClick={() => setConfirmResume(true)}>
                  <Play className="size-3" />
                  Resume
                </Button>
              </TooltipTrigger>
              <TooltipContent>Resume suspended devbox</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="xs" className="cursor-pointer" onClick={() => setConfirmSuspend(true)}>
                  <Pause className="size-3" />
                  Suspend
                </Button>
              </TooltipTrigger>
              <TooltipContent>Suspend devbox (saves state)</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" className="cursor-pointer" onClick={() => setConfirmDestroy(true)}>
                <Trash2 className="size-3" />
                Destroy
              </Button>
            </TooltipTrigger>
            <TooltipContent>Permanently destroy this devbox</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmResume}
        title="Resume Thopter"
        description={`This will resume "${thopter.name}" from its suspended state.`}
        confirmLabel="Resume"
        onConfirm={() => {
          setConfirmResume(false)
          resumeThopter(thopter.name)
        }}
        onCancel={() => setConfirmResume(false)}
      />
      <ConfirmDialog
        open={confirmSuspend}
        title="Suspend Thopter"
        description={`This will suspend "${thopter.name}" and its devbox. The state will be saved and you can resume it later.`}
        confirmLabel="Suspend"
        onConfirm={() => {
          setConfirmSuspend(false)
          suspendThopter(thopter.name)
        }}
        onCancel={() => setConfirmSuspend(false)}
      />
      <ConfirmDialog
        open={confirmDestroy}
        title="Destroy Thopter"
        description={`This will permanently destroy "${thopter.name}" and its devbox. This action cannot be undone.`}
        confirmLabel="Destroy"
        destructive
        onConfirm={() => {
          setConfirmDestroy(false)
          destroyThopter(thopter.name)
        }}
        onCancel={() => setConfirmDestroy(false)}
      />
    </Card>
  )
}
