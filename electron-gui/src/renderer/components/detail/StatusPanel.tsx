import { useState, useEffect, useRef, useCallback } from 'react'
import { Clock, User, Cpu, Pause, Play, Trash2, TerminalSquare, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
// Radix DropdownMenu's floating-ui popper fails in Electron (isPositioned never
// becomes true). Use a simple CSS-positioned menu instead.
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

/**
 * Auto-saving textarea field with 250ms debounce.
 * Always editable — no static/edit toggle. Enter inserts newlines.
 */
function AutoSaveField({
  value,
  placeholder,
  label,
  onSave,
}: {
  value: string | null
  placeholder: string
  label: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedRef = useRef(value ?? '')
  const lastEditRef = useRef(0)

  // Suppress poll updates for debounce (250ms) + slosh (2s) after last keystroke.
  // This prevents stale Redis poll data from overwriting in-progress typing.
  const EDIT_GUARD_MS = 2500

  useEffect(() => {
    const incoming = value ?? ''
    if (incoming !== savedRef.current && Date.now() - lastEditRef.current > EDIT_GUARD_MS) {
      savedRef.current = incoming
      setDraft(incoming)
    }
  }, [value])

  const debouncedSave = useCallback(
    (text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (text !== savedRef.current) {
          savedRef.current = text
          onSave(text)
        }
      }, 250)
    },
    [onSave],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    lastEditRef.current = Date.now()
    setDraft(text)
    debouncedSave(text)
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
      <span className="text-muted-foreground/50 text-[10px] leading-none">{label}</span>
      <textarea
        className="text-xs leading-relaxed bg-transparent border-none outline-none resize-none w-full min-h-[1.5em] placeholder:text-muted-foreground/30 field-sizing-content"
        value={draft}
        placeholder={placeholder}
        onChange={onChange}
        spellCheck={false}
        rows={1}
      />
    </div>
  )
}

export function StatusPanel({ thopter, viewMode, onViewModeChange }: Props) {
  const suspendThopter = useStore((s) => s.suspendThopter)
  const resumeThopter = useStore((s) => s.resumeThopter)
  const destroyThopter = useStore((s) => s.destroyThopter)
  const updateStatusLine = useStore((s) => s.updateStatusLine)
  const updateNotes = useStore((s) => s.updateNotes)
  const provider = useStore((s) => s.provider)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [confirmResume, setConfirmResume] = useState(false)
  const [shellModalOpen, setShellModalOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  const status = thopter.status ?? 'inactive'
  const cfg = statusConfig[status] ?? statusConfig.inactive
  const isSuspended = thopter.devboxStatus === 'suspended'
  const showSuspendResume = provider === 'runloop'

  const viewModes = [
    { key: 'ssh' as const, label: 'SSH' },
    { key: 'transcript' as const, label: 'Transcript' },
    { key: 'terminal' as const, label: 'Snapshot' },
  ]

  // Close actions menu on click outside or Escape
  useEffect(() => {
    if (!actionsOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false)
      }
    }
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActionsOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [actionsOpen])

  const onSaveStatusLine = useCallback(
    (text: string) => updateStatusLine(thopter.name, text),
    [thopter.name, updateStatusLine],
  )

  const onSaveNotes = useCallback(
    (text: string) => updateNotes(thopter.name, text),
    [thopter.name, updateNotes],
  )

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

        {/* Actions menu — simple CSS-positioned dropdown (Radix floating-ui
             fails in Electron: isPositioned never becomes true) */}
        <div ref={actionsRef} className="relative shrink-0">
          <Button
            data-slot="dropdown-menu-trigger"
            variant="outline"
            size="icon-xs"
            onClick={() => setActionsOpen((v) => !v)}
          >
            <MoreHorizontal className="size-4" />
          </Button>
          {actionsOpen && (
            <div
              data-slot="dropdown-menu-content"
              className="absolute right-0 top-full mt-1 z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <button
                data-slot="dropdown-menu-item"
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => { setActionsOpen(false); setShellModalOpen(true) }}
              >
                <TerminalSquare className="size-3.5" />
                Shell Commands
              </button>
              {showSuspendResume && (
                <>
                  <div className="bg-border -mx-1 my-1 h-px" />
                  {isSuspended ? (
                    <button
                      data-slot="dropdown-menu-item"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
                      onClick={() => { setActionsOpen(false); setConfirmResume(true) }}
                    >
                      <Play className="size-3.5" />
                      Resume
                    </button>
                  ) : (
                    <button
                      data-slot="dropdown-menu-item"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
                      onClick={() => { setActionsOpen(false); setConfirmSuspend(true) }}
                    >
                      <Pause className="size-3.5" />
                      Suspend
                    </button>
                  )}
                </>
              )}
              <div className="bg-border -mx-1 my-1 h-px" />
              <button
                data-slot="dropdown-menu-item"
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-hidden select-none hover:bg-destructive/10"
                onClick={() => { setActionsOpen(false); setConfirmDestroy(true) }}
              >
                <Trash2 className="size-3.5" />
                Destroy
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Status line + Notes side by side */}
      <div className="flex gap-4 min-w-0">
        <AutoSaveField
          value={thopter.statusLine}
          placeholder="No status line set"
          label="Status line"
          onSave={onSaveStatusLine}
        />
        <div className="w-px bg-border shrink-0" />
        <AutoSaveField
          value={thopter.notes}
          placeholder="Add notes..."
          label="Notes"
          onSave={onSaveNotes}
        />
      </div>

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
