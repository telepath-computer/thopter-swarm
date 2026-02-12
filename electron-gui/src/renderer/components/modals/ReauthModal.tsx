import { useState, useEffect, useCallback } from 'react'
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
import { LiveTerminalView } from '@/components/detail/LiveTerminalView'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Check, Loader2 } from 'lucide-react'

type Step = 'machine' | 'snapshot-name' | 'preparing' | 'ssh' | 'finalize'

export function ReauthModal() {
  const isOpen = useStore((s) => s.isReauthModalOpen)
  const closeReauthModal = useStore((s) => s.closeReauthModal)
  const thopters = useStore((s) => s.thopters)

  const [step, setStep] = useState<Step>('machine')
  const [machine, setMachine] = useState<ReauthMachine>('snapshot')
  const [devboxName, setDevboxName] = useState('')
  const [snapshotName, setSnapshotName] = useState('')
  const [defaultSnapshotName, setDefaultSnapshotName] = useState<string | null>(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [preparedDevbox, setPreparedDevbox] = useState<{ devboxName: string; devboxId: string } | null>(null)
  const [sshSpawnInfo, setSSHSpawnInfo] = useState<{ command: string; args: string[] } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)

  const runningThopters = Object.values(thopters).filter(
    (t: ThopterInfo) => t.devboxStatus === 'running' || t.devboxStatus === 'suspended'
  )

  // Load config on modal open to get default snapshot name.
  // The config value (defaultSnapshotName, with legacy defaultSnapshotId fallback)
  // is always a snapshot name, never an ID.
  useEffect(() => {
    if (!isOpen) return
    setConfigLoaded(false)
    getService().getConfig().then((config) => {
      if (config.defaultSnapshot) {
        setDefaultSnapshotName(config.defaultSnapshot)
        setSnapshotName(config.defaultSnapshot)
      } else {
        setDefaultSnapshotName(null)
      }
      setConfigLoaded(true)
    }).catch(() => setConfigLoaded(true))
  }, [isOpen])

  function handleClose() {
    closeReauthModal()
    // Reset state after close animation
    setTimeout(() => {
      setStep('machine')
      setMachine('snapshot')
      setDevboxName('')
      setSnapshotName('')
      setDefaultSnapshotName(null)
      setConfigLoaded(false)
      setPreparedDevbox(null)
      setSSHSpawnInfo(null)
      setShowConfirm(false)
      setIsWorking(false)
      setError(null)
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
    const effectiveName = snapshotName.trim() || defaultSnapshotName
    if (!effectiveName) {
      setError('Snapshot name is required')
      return
    }
    // Ensure snapshotName state has the resolved value
    if (!snapshotName.trim() && defaultSnapshotName) {
      setSnapshotName(defaultSnapshotName)
    }
    setError(null)
    setStep('preparing')
  }

  // Auto-run prepare when entering the preparing step
  const runPrepare = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    try {
      const service = getService()
      const result = await service.reauthPrepare({
        machine,
        devboxName: machine === 'existing' ? devboxName : undefined,
      })
      setPreparedDevbox(result)

      const spawn = await service.getSSHSpawnById(result.devboxId)
      setSSHSpawnInfo(spawn)

      setStep('ssh')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare devbox')
    } finally {
      setIsWorking(false)
    }
  }, [machine, devboxName])

  useEffect(() => {
    if (step === 'preparing') {
      runPrepare()
    }
  }, [step, runPrepare])

  async function handleFinalize() {
    if (!preparedDevbox) return
    const effectiveName = snapshotName.trim() || defaultSnapshotName
    if (!effectiveName) return

    setShowConfirm(false)
    setStep('finalize')
    setIsWorking(true)
    setError(null)
    try {
      await getService().reauthFinalize(preparedDevbox.devboxName, effectiveName)
      setIsDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save snapshot')
    } finally {
      setIsWorking(false)
    }
  }

  const preparingMessage =
    machine === 'existing'
      ? 'Resuming devbox...'
      : machine === 'snapshot'
        ? 'Creating devbox from snapshot...'
        : 'Creating fresh devbox...'

  const effectiveSnapshotName = snapshotName.trim() || defaultSnapshotName || ''

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className={step === 'ssh' ? 'sm:max-w-3xl' : 'sm:max-w-md'}>
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

            <div className="space-y-1.5">
              <Input
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                placeholder={
                  defaultSnapshotName
                    ? `Default: ${defaultSnapshotName}`
                    : 'Enter snapshot name'
                }
                autoFocus
                disabled={!configLoaded}
              />
              {configLoaded && defaultSnapshotName && !snapshotName.trim() && (
                <p className="text-xs text-muted-foreground">
                  Leave empty to use current default: <code className="font-mono">{defaultSnapshotName}</code>
                </p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setError(null); setStep('machine') }}>
                Back
              </Button>
              <Button onClick={handleNextFromSnapshotName} disabled={!configLoaded}>
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Preparing (auto-transition) */}
        {step === 'preparing' && (
          <div className="space-y-4">
            {isWorking ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{preparingMessage}</p>
              </div>
            ) : error ? (
              <>
                <p className="text-sm text-destructive">{error}</p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setError(null); setStep('snapshot-name') }}>
                    Back
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </div>
        )}

        {/* Step 4: SSH with embedded terminal */}
        {step === 'ssh' && preparedDevbox && sshSpawnInfo && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Authenticate via SSH</p>
              <p className="text-xs text-muted-foreground">
                Run <code className="font-mono">claude</code> to launch Claude Code and complete browser authentication. When done, click Save Snapshot.
              </p>
            </div>

            <div className="h-[400px] flex rounded-md overflow-hidden border border-border/50">
              <LiveTerminalView
                name={preparedDevbox.devboxName}
                spawnInfo={sshSpawnInfo}
              />
            </div>

            <DialogFooter>
              <Button onClick={() => setShowConfirm(true)}>
                Save Snapshot
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 5: Finalize */}
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
                      Snapshot &ldquo;{effectiveSnapshotName}&rdquo; saved as the new default.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleClose}>Done</Button>
                </DialogFooter>
              </>
            ) : isWorking ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Saving snapshot &ldquo;{effectiveSnapshotName}&rdquo;...</p>
              </div>
            ) : error ? (
              <>
                <p className="text-sm text-destructive">{error}</p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setError(null); setStep('ssh') }}>
                    Back
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>

      {/* Confirmation dialog before snapshotting */}
      <ConfirmDialog
        open={showConfirm}
        title="Save Snapshot"
        description={`Have you finished authenticating? This will close the SSH session and save snapshot "${effectiveSnapshotName}".`}
        confirmLabel="Save Snapshot"
        onConfirm={handleFinalize}
        onCancel={() => setShowConfirm(false)}
      />
    </Dialog>
  )
}
