import { useState } from 'react'
import { useStore } from '@/store'
import { getService } from '@/services'
import type { ReauthMachine, ThopterInfo } from '@/services/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Copy, Terminal, Check, Loader2 } from 'lucide-react'

type Step = 'machine' | 'snapshot-name' | 'ssh' | 'finalize'

export function ReauthModal() {
  const isOpen = useStore((s) => s.isReauthModalOpen)
  const closeReauthModal = useStore((s) => s.closeReauthModal)
  const thopters = useStore((s) => s.thopters)

  const [step, setStep] = useState<Step>('machine')
  const [machine, setMachine] = useState<ReauthMachine>('snapshot')
  const [devboxName, setDevboxName] = useState('')
  const [snapshotName, setSnapshotName] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isDone, setIsDone] = useState(false)

  const runningThopters = Object.values(thopters).filter(
    (t: ThopterInfo) => t.devboxStatus === 'running' || t.devboxStatus === 'suspended'
  )

  function handleClose() {
    closeReauthModal()
    // Reset state after close animation
    setTimeout(() => {
      setStep('machine')
      setMachine('snapshot')
      setDevboxName('')
      setSnapshotName('')
      setIsWorking(false)
      setError(null)
      setCopied(false)
      setIsDone(false)
    }, 200)
  }

  function handleNextFromMachine() {
    if (machine === 'existing' && !devboxName) {
      setError('Please select a devbox')
      return
    }
    setError(null)
    setStep('snapshot-name')
  }

  function handleNextFromSnapshotName() {
    if (!snapshotName.trim()) {
      setError('Snapshot name is required')
      return
    }
    setError(null)
    setStep('ssh')
  }

  function handleCopyCommand() {
    const target = machine === 'existing' ? devboxName : 'the new devbox'
    const command = `thopter ssh ${target}`
    navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleOpenTerminal() {
    const service = getService()
    if (machine === 'existing' && devboxName) {
      service.attachThopter(devboxName)
    }
  }

  async function handleFinalize() {
    setIsWorking(true)
    setError(null)
    try {
      const service = getService()
      await service.reauth({
        machine,
        devboxName: machine === 'existing' ? devboxName : undefined,
        snapshotName: snapshotName.trim(),
      })
      setIsDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reauth failed')
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Re-Authenticate</DialogTitle>
          <DialogDescription>
            Update Claude Code credentials and save a new snapshot.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Choose machine */}
        {step === 'machine' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Choose a machine</p>
              <p className="text-xs text-muted-foreground">
                Where to perform the re-authentication.
              </p>
            </div>

            <RadioGroup value={machine} onValueChange={(v) => setMachine(v as ReauthMachine)}>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="existing" id="existing" className="mt-0.5" />
                <Label htmlFor="existing" className="flex flex-col cursor-pointer">
                  <span>Use an existing devbox</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    SSH into a running machine to re-authenticate
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="snapshot" id="snapshot" className="mt-0.5" />
                <Label htmlFor="snapshot" className="flex flex-col cursor-pointer">
                  <span>Create from snapshot</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    Boot a new machine from the default snapshot
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="fresh" id="fresh" className="mt-0.5" />
                <Label htmlFor="fresh" className="flex flex-col cursor-pointer">
                  <span>Create fresh</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    Start from scratch with a blank machine
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {machine === 'existing' && (
              <div className="space-y-2 pl-7">
                <Label htmlFor="devbox-select">Devbox</Label>
                {runningThopters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No running devboxes found.
                  </p>
                ) : (
                  <select
                    id="devbox-select"
                    value={devboxName}
                    onChange={(e) => setDevboxName(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs [&_option]:bg-popover [&_option]:text-popover-foreground"
                  >
                    <option value="">Select a devbox...</option>
                    {runningThopters.map((t: ThopterInfo) => (
                      <option key={t.name} value={t.name}>
                        {t.name} ({t.devboxStatus})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleNextFromMachine}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Snapshot name */}
        {step === 'snapshot-name' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Snapshot name</p>
              <p className="text-xs text-muted-foreground">
                Choose a name for the snapshot. If a snapshot with this name already exists, it will be replaced.
              </p>
            </div>

            <Input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="e.g. default"
              autoFocus
            />

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setError(null); setStep('machine') }}>
                Back
              </Button>
              <Button onClick={handleNextFromSnapshotName}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: SSH instructions */}
        {step === 'ssh' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Authenticate via SSH</p>
              <p className="text-xs text-muted-foreground">
                SSH into the devbox and authenticate Claude Code. When done, come back here and click "Create Snapshot".
              </p>
            </div>

            <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
              <code className="text-sm flex-1 font-mono">
                thopter ssh {machine === 'existing' ? devboxName : '<devbox-name>'}
              </code>
              <Button variant="ghost" size="icon-xs" onClick={handleCopyCommand}>
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            </div>

            {machine === 'existing' && devboxName && (
              <Button variant="outline" size="sm" className="w-full" onClick={handleOpenTerminal}>
                <Terminal className="size-4" />
                Open Terminal
              </Button>
            )}

            <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">In the SSH session:</p>
              <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
                <li>Run <code className="font-mono">claude</code> to launch Claude Code</li>
                <li>Complete the browser-based authentication</li>
                <li>Verify Claude Code works, then exit</li>
                <li>Exit the SSH session</li>
              </ol>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('snapshot-name')}>
                Back
              </Button>
              <Button onClick={() => setStep('finalize')}>
                Create Snapshot
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Finalize */}
        {step === 'finalize' && (
          <div className="space-y-4">
            {isDone ? (
              <>
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="rounded-full bg-green-500/10 p-3">
                    <Check className="size-6 text-green-500" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium">Re-authentication complete</p>
                    <p className="text-xs text-muted-foreground">
                      Snapshot "{snapshotName}" saved as the new default.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleClose}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Review & Finalize</p>
                  <p className="text-xs text-muted-foreground">
                    This will snapshot the devbox and set it as the default.
                  </p>
                </div>

                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Machine</span>
                    <span>
                      {machine === 'existing' ? devboxName : machine === 'snapshot' ? 'From snapshot' : 'Fresh'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Snapshot name</span>
                    <span>{snapshotName}</span>
                  </div>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setError(null); setStep('ssh') }} disabled={isWorking}>
                    Back
                  </Button>
                  <Button onClick={handleFinalize} disabled={isWorking}>
                    {isWorking && <Loader2 className="size-4 animate-spin" />}
                    {isWorking ? 'Creating Snapshot...' : 'Create Snapshot & Save as Default'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
