import { useState } from 'react'
import { Send, TerminalSquare, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ShellCommandsModal } from '@/components/modals/ShellCommandsModal'
import { useStore } from '@/store'
import type { ThopterStatus, DevboxStatus } from '@/services/types'

interface Props {
  name: string
  status: ThopterStatus | null
  devboxStatus: DevboxStatus
}

export function ActionBar({ name }: Props) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [shellModalOpen, setShellModalOpen] = useState(false)
  const tellThopter = useStore((s) => s.tellThopter)

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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="xs" onClick={() => setShellModalOpen(true)}>
              <TerminalSquare />
              Shell Commands
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy CLI commands for this thopter</TooltipContent>
        </Tooltip>
      </div>

      <ShellCommandsModal open={shellModalOpen} name={name} onClose={() => setShellModalOpen(false)} />
    </div>
  )
}
