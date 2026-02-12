import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  name: string
  onClose: () => void
}

const COMMANDS: { label: string; command: (name: string) => string }[] = [
  { label: 'Attach (tmux)', command: (n) => `thopter attach ${n}` },
  { label: 'SSH', command: (n) => `thopter ssh ${n}` },
  { label: 'Tail (follow)', command: (n) => `thopter tail ${n} -f` },
  { label: 'Status', command: (n) => `thopter status ${n}` },
  { label: 'Suspend', command: (n) => `thopter suspend ${n}` },
  { label: 'Resume', command: (n) => `thopter resume ${n}` },
]

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono select-all">
          {value}
        </code>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={handleCopy}>
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}

export function ShellCommandsModal({ open, name, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Shell Commands</DialogTitle>
          <DialogDescription>
            CLI commands for <span className="font-mono font-medium text-foreground">{name}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {COMMANDS.map((c) => (
            <CopyField key={c.label} label={c.label} value={c.command(name)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
