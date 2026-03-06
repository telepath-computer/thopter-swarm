import { useState, useEffect, useRef } from 'react'
import { Clock, User, Cpu, Pause, Play, Trash2, Pencil, Check, TerminalSquare, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { ShellCommandsModal } from '@/components/modals/ShellCommandsModal'
import { cn, relativeTime } from '@/lib/utils'
import { statusConfig } from '@/lib/status-config'
import { useStore } from '@/store'
import type { ThopterInfo } from '@/services/types'

interface Props {
  thopter: ThopterInfo
  viewMode: 'transcript' | 'terminal' | 'ssh'
  onViewModeChange: (mode: 'transcript' | 'terminal' | 'ssh') => void
}

function EditableTask({ name, task }: { name: string; task: string | null }) {
  const updateTask = useStore((s) => s.updateTask)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

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
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-muted-foreground/50 text-xs shrink-0">Task:</span>
        <Input
          ref={inputRef}
          className="text-xs h-6 min-w-0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setEditing(false); setDraft(task ?? '') }
          }}
          onBlur={save}
        />
        <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={save}>
          <Check className="size-3" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className="flex items-start gap-2 group cursor-pointer min-w-0 flex-1"
      onClick={() => setEditing(true)}
    >
      <span className="text-muted-foreground/50 text-xs shrink-0 leading-5">Task:</span>
      <span className="text-xs leading-5 break-words min-w-0">{task || <span className="text-muted-foreground/40 italic">No task set</span>}</span>
      <Pencil className="size-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
    </div>
  )
}

export function StatusPanel({ thopter, viewMode, onViewModeChange }: Props) {
  const suspendThopter = useStore((s) => s.suspendThopter)
  const resumeThopter = useStore((s) => s.resumeThopter)
  const destroyThopter = useStore((s) => s.destroyThopter)
  const provider = useStore((s) => s.provider)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [confirmResume, setConfirmResume] = useState(false)
  const [shellModalOpen, setShellModalOpen] = useState(false)

  const status = thopter.status ?? 'inactive'
  const cfg = statusConfig[status] ?? statusConfig.inactive
  const isSuspended = thopter.devboxStatus === 'suspended'
  const showSuspendResume = provider === 'runloop'

  const viewModes = [
    { key: 'ssh' as const, label: 'SSH' },
    { key: 'transcript' as const, label: 'Transcript' },
    { key: 'terminal' as const, label: 'Snapshot' },
  ]

  return (
    <div className="px-4 py-2 border-b bg-card/50 space-y-1.5">
      {/* Row 1: Name, badge, metadata, view toggle, actions menu */}
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-sm font-bold shrink-0">{thopter.name}</h2>
        <Badge variant="outline" className={cn('text-[10px] gap-1.5 font-medium border shrink-0', cfg.color)}>
          <span className={cn('size-1.5 rounded-full', cfg.dot)} />
          {cfg.label}
        </Badge>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground min-w-0">
          {thopter.owner && (
            <span className="flex items-center gap-1 shrink-0">
              <User className="size-3" />
              {thopter.owner}
            </span>
          )}
          <span className="flex items-center gap-1 shrink-0">
            <Clock className="size-3" />
            {relativeTime(thopter.heartbeat)}
          </span>
          <span className={cn('flex items-center gap-1 shrink-0', thopter.claudeRunning ? 'text-emerald-400' : 'text-muted-foreground')}>
            <Cpu className="size-3" />
            {thopter.claudeRunning ? 'Claude active' : 'Claude stopped'}
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 shrink-0">
          {viewModes.map((m) => (
            <button
              key={m.key}
              onClick={() => onViewModeChange(m.key)}
              className={cn(
                'px-2 py-0.5 text-[11px] rounded font-medium cursor-pointer transition-colors',
                viewMode === m.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-xs" className="shrink-0">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShellModalOpen(true)}>
              <TerminalSquare className="size-3.5 mr-2" />
              Shell Commands
            </DropdownMenuItem>
            {showSuspendResume && (
              <>
                <DropdownMenuSeparator />
                {isSuspended ? (
                  <DropdownMenuItem onClick={() => setConfirmResume(true)}>
                    <Play className="size-3.5 mr-2" />
                    Resume
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setConfirmSuspend(true)}>
                    <Pause className="size-3.5 mr-2" />
                    Suspend
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDestroy(true)}>
              <Trash2 className="size-3.5 mr-2" />
              Destroy
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2: Task (full width, wraps naturally) */}
      <EditableTask name={thopter.name} task={thopter.task} />

      {/* Confirmation dialogs */}
      {showSuspendResume && (
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
      )}
      {showSuspendResume && (
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
      )}
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
      <ShellCommandsModal open={shellModalOpen} name={thopter.name} provider={provider} onClose={() => setShellModalOpen(false)} />
    </div>
  )
}
