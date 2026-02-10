import { useState } from 'react'
import { Send, Pause, Play, Trash2, Terminal, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { useStore } from '@/store'
import type { ThopterStatus, DevboxStatus } from '@/services/types'

interface Props {
  name: string
  status: ThopterStatus | null
  devboxStatus: DevboxStatus
}

export function ActionBar({ name, status, devboxStatus }: Props) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const tellThopter = useStore((s) => s.tellThopter)
  const suspendThopter = useStore((s) => s.suspendThopter)
  const resumeThopter = useStore((s) => s.resumeThopter)
  const destroyThopter = useStore((s) => s.destroyThopter)
  const attachThopter = useStore((s) => s.attachThopter)

  const isSuspended = devboxStatus === 'suspended'

  const handleSend = async (interrupt: boolean) => {
    if (!message.trim() || sending) return
    setSending(true)
    try {
      await tellThopter(name, message, interrupt)
      setMessage('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="px-4 py-3 border-t bg-card/50 space-y-3">
      <div className="flex gap-2">
        <Textarea
          className="flex-1 text-sm resize-none min-h-[56px] font-mono"
          rows={2}
          placeholder="Send a message to Claude..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend(false)
            }
          }}
          disabled={sending}
        />
        <div className="flex flex-col gap-1.5">
          <Button size="default" onClick={() => handleSend(false)} disabled={!message.trim() || sending}>
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
                disabled={!message.trim() || sending}
              >
                <Zap className="size-3" />
                Interrupt & Send
              </Button>
            </TooltipTrigger>
            <TooltipContent>Interrupt Claude first, then send message</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {isSuspended ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={() => resumeThopter(name)}>
                <Play />
                Resume
              </Button>
            </TooltipTrigger>
            <TooltipContent>Resume suspended devbox</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={() => suspendThopter(name)}>
                <Pause />
                Suspend
              </Button>
            </TooltipTrigger>
            <TooltipContent>Suspend devbox (saves state)</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="xs" onClick={() => attachThopter(name)}>
              <Terminal />
              Attach
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open SSH session in terminal</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-4" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="destructive" size="xs" onClick={() => setConfirmDestroy(true)}>
              <Trash2 />
              Destroy
            </Button>
          </TooltipTrigger>
          <TooltipContent>Permanently destroy this devbox</TooltipContent>
        </Tooltip>
      </div>

      <ConfirmDialog
        open={confirmDestroy}
        title="Destroy Thopter"
        description={`This will permanently destroy "${name}" and its devbox. This action cannot be undone.`}
        confirmLabel="Destroy"
        destructive
        onConfirm={() => {
          setConfirmDestroy(false)
          destroyThopter(name)
        }}
        onCancel={() => setConfirmDestroy(false)}
      />
    </div>
  )
}
