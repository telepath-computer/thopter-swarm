import { useState, useEffect, useRef } from 'react'
import { Activity, Clock, Server, User, Cpu, Pause, Play, Trash2, Pencil, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { cn, relativeTime } from '@/lib/utils'
import { useStore } from '@/store'
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

function EditableTask({ name, task }: { name: string; task: string | null }) {
  const updateTask = useStore((s) => s.updateTask)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync draft when task changes externally (e.g. from refresh)
  useEffect(() => {
    if (!editing) setDraft(task ?? '')
  }, [task, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const save = async () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== (task ?? '')) {
      await updateTask(name, trimmed)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="text-muted-foreground/50 text-sm shrink-0">Task:</span>
        <Input
          ref={inputRef}
          className="text-sm h-7"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setEditing(false); setDraft(task ?? '') }
          }}
          onBlur={save}
        />
        <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={save}>
          <Check className="size-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2 mt-2 group cursor-pointer"
      onClick={() => setEditing(true)}
    >
      <span className="text-muted-foreground/50 text-sm shrink-0">Task:</span>
      <span className="text-sm">{task || <span className="text-muted-foreground/40 italic">No task set</span>}</span>
      <Pencil className="size-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  )
}

export function StatusPanel({ thopter }: Props) {
  const suspendThopter = useStore((s) => s.suspendThopter)
  const resumeThopter = useStore((s) => s.resumeThopter)
  const destroyThopter = useStore((s) => s.destroyThopter)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [confirmResume, setConfirmResume] = useState(false)

  const status = thopter.status ?? 'inactive'
  const cfg = statusConfig[status] ?? statusConfig.inactive
  const isSuspended = thopter.devboxStatus === 'suspended'

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

        <div className="ml-auto flex items-center gap-1.5">
          {isSuspended ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="xs" className="cursor-pointer" onClick={() => setConfirmResume(true)}>
                  <Play />
                  Resume
                </Button>
              </TooltipTrigger>
              <TooltipContent>Resume suspended devbox</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="xs" className="cursor-pointer" onClick={() => setConfirmSuspend(true)}>
                  <Pause />
                  Suspend
                </Button>
              </TooltipTrigger>
              <TooltipContent>Suspend devbox (saves state)</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" className="cursor-pointer" onClick={() => setConfirmDestroy(true)}>
                <Trash2 />
                Destroy
              </Button>
            </TooltipTrigger>
            <TooltipContent>Permanently destroy this devbox</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <EditableTask name={thopter.name} task={thopter.task} />

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
    </div>
  )
}
