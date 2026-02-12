import { useState } from 'react'
import { Send, Zap, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useStore } from '@/store'
import type { ThopterStatus, DevboxStatus, ClaudeReadyStatus } from '@/services/types'

interface Props {
  name: string
  status: ThopterStatus | null
  devboxStatus: DevboxStatus
  claudeReady?: ClaudeReadyStatus
}

function getUnavailableReason(devboxStatus: DevboxStatus, claudeReady?: ClaudeReadyStatus): string | null {
  if (devboxStatus !== 'running') {
    return `Devbox is ${devboxStatus}. Cannot send messages.`
  }
  if (!claudeReady) {
    return null // Still checking, allow optimistically
  }
  if (!claudeReady.tmux) {
    return 'No tmux session on this thopter. Claude needs to be launched.'
  }
  if (!claudeReady.claude) {
    return 'tmux is running but Claude is not active in any pane.'
  }
  return null
}

export function ActionBar({ name, devboxStatus, claudeReady }: Props) {
  const message = useStore((s) => s.draftMessages[name] ?? '')
  const setMessage = useStore((s) => s.setDraftMessage)
  const [sending, setSending] = useState(false)
  const tellThopter = useStore((s) => s.tellThopter)
  const checkClaudeFn = useStore((s) => s.checkClaude)

  const unavailableReason = getUnavailableReason(devboxStatus, claudeReady)
  const disabled = sending || !!unavailableReason

  const handleSend = async (interrupt: boolean) => {
    if (!message.trim() || disabled) return
    setSending(true)
    try {
      await tellThopter(name, message, interrupt)
      setMessage(name, '')
    } finally {
      setSending(false)
      // Re-check Claude status after send (it may have exited)
      checkClaudeFn(name)
    }
  }

  return (
    <div className="px-4 py-3 border-t bg-card/50 space-y-3">
      {unavailableReason && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>{unavailableReason}</span>
          <span className="text-muted-foreground ml-1">SSH in to start Claude: <code className="font-mono text-[11px]">thopter ssh {name}</code></span>
          {devboxStatus === 'running' && (
            <button
              onClick={() => checkClaudeFn(name)}
              className="ml-auto shrink-0 text-amber-400 hover:text-amber-300 transition-colors p-0.5"
              title="Re-check tmux/Claude status"
            >
              <RefreshCw className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Textarea
          className="flex-1 text-sm resize-none min-h-[56px] font-mono"
          rows={2}
          placeholder={unavailableReason ? 'Claude is not running...' : 'Send a message to Claude... (experimental — pastes text then sends Enter; message may be lost if Claude is not waiting for input)'}
          value={message}
          onChange={(e) => setMessage(name, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend(false)
            }
          }}
          disabled={disabled}
        />
        <div className="flex flex-col gap-1.5">
          <Button size="default" onClick={() => handleSend(false)} disabled={!message.trim() || disabled}>
            <Send />
            {sending ? 'Sending...' : 'Send'}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={() => handleSend(true)}
                disabled={!message.trim() || disabled}
              >
                <Zap className="size-3" />
                Interrupt & Send
              </Button>
            </TooltipTrigger>
            <TooltipContent>Interrupt Claude first, then send message</TooltipContent>
          </Tooltip>
        </div>
      </div>

    </div>
  )
}
