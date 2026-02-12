import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { getService } from '@/services'
import type { RepoConfig, SnapshotInfo } from '@/services/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ChevronDown, ChevronUp, ChevronRight, Loader2, Check, Rocket } from 'lucide-react'

type Step = 'repo' | 'prompt' | 'options' | 'review'

export function RunModal() {
  const isOpen = useStore((s) => s.isRunModalOpen)
  const closeRunModal = useStore((s) => s.closeRunModal)
  const runThopter = useStore((s) => s.runThopter)
  const openTab = useStore((s) => s.openTab)

  const [step, setStep] = useState<Step>('repo')
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])

  // Form state
  const [repo, setRepo] = useState('')
  const [customRepo, setCustomRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [prompt, setPrompt] = useState('')
  const [customName, setCustomName] = useState('')
  const [snapshotId, setSnapshotId] = useState('')
  const [keepAlive, setKeepAlive] = useState('')
  const [showOptions, setShowOptions] = useState(false)

  // Status
  const [isLaunching, setIsLaunching] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [launchedName, setLaunchedName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectClass = 'h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs [&_option]:bg-popover [&_option]:text-popover-foreground'

  // Load repos and snapshots when modal opens
  useEffect(() => {
    if (!isOpen) return
    const load = async () => {
      try {
        const service = getService()
        const [repoList, snapList, config] = await Promise.all([
          service.listRepos(),
          service.listSnapshots(),
          service.getConfig(),
        ])
        setRepos(repoList)
        setSnapshots(snapList)
        if (config.defaultRepo) setRepo(config.defaultRepo)
        if (config.defaultBranch) setBranch(config.defaultBranch)
        if (config.defaultSnapshot) setSnapshotId(config.defaultSnapshot)
      } catch {
        // Non-fatal — user can still enter values manually
      }
    }
    load()
  }, [isOpen])

  const effectiveRepo = repo === '__custom__' ? customRepo : repo

  function handleClose() {
    closeRunModal()
    setTimeout(resetForm, 200)
  }

  function resetForm() {
    setStep('repo')
    setRepo('')
    setCustomRepo('')
    setBranch('')
    setPrompt('')
    setCustomName('')
    setSnapshotId('')
    setKeepAlive('')
    setShowOptions(false)
    setIsLaunching(false)
    setIsDone(false)
    setLaunchedName('')
    setError(null)
  }

  function handleNextFromRepo() {
    if (!effectiveRepo) {
      setError('Please select or enter a repository')
      return
    }
    setError(null)
    setStep('prompt')
  }

  function handleNextFromPrompt() {
    if (!prompt.trim()) {
      setError('Please enter a task description')
      return
    }
    setError(null)
    setStep('review')
  }

  async function handleLaunch() {
    setIsLaunching(true)
    setError(null)
    try {
      const name = await runThopter({
        repo: effectiveRepo,
        branch: branch || undefined,
        prompt: prompt.trim(),
        name: customName || undefined,
        snapshotId: snapshotId || undefined,
        keepAliveMinutes: keepAlive ? parseInt(keepAlive, 10) : undefined,
      })
      setLaunchedName(name)
      setIsDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed')
    } finally {
      setIsLaunching(false)
    }
  }

  function handleDone() {
    if (launchedName) openTab(launchedName)
    handleClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-5" />
            Run New Thopter
          </DialogTitle>
          <DialogDescription>
            Launch a new devbox with Claude Code working on a task.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        {!isDone && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={step === 'repo' ? 'text-primary font-medium' : ''}>Repository</span>
            <ChevronRight className="size-3" />
            <span className={step === 'prompt' ? 'text-primary font-medium' : ''}>Task</span>
            <ChevronRight className="size-3" />
            <span className={step === 'review' ? 'text-primary font-medium' : ''}>Launch</span>
          </div>
        )}

        {/* Step 1: Repository & Branch */}
        {step === 'repo' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Repository</Label>
              <select
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className={selectClass}
              >
                <option value="">Select a repository...</option>
                {repos.map((r) => (
                  <option key={r.repo} value={r.repo}>
                    {r.repo} {r.branch ? `(${r.branch})` : ''}
                  </option>
                ))}
                <option value="__custom__">Custom repository...</option>
              </select>
            </div>

            {repo === '__custom__' && (
              <div className="space-y-2">
                <Label>Custom repo (owner/name format)</Label>
                <Input
                  value={customRepo}
                  onChange={(e) => setCustomRepo(e.target.value)}
                  placeholder="owner/repo"
                  autoFocus
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Branch</Label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main (default)"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleNextFromRepo}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Task prompt */}
        {step === 'prompt' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Task Description</Label>
              <p className="text-xs text-muted-foreground">
                Describe what Claude should work on. This becomes the initial prompt.
              </p>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Implement the user authentication feature..."
                rows={6}
                className="font-mono text-sm"
                autoFocus
              />
            </div>

            {/* Collapsible options */}
            <div>
              <button
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowOptions(!showOptions)}
              >
                {showOptions ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                Advanced options
              </button>

              {showOptions && (
                <div className="mt-3 space-y-3 pl-1 border-l-2 border-border ml-1.5">
                  <div className="space-y-1.5 pl-3">
                    <Label className="text-xs">Custom name</Label>
                    <Input
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Auto-generated if empty"
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5 pl-3">
                    <Label className="text-xs">Snapshot</Label>
                    <select
                      value={snapshotId}
                      onChange={(e) => setSnapshotId(e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background text-foreground px-2 text-xs shadow-xs [&_option]:bg-popover [&_option]:text-popover-foreground"
                    >
                      <option value="">Default snapshot</option>
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.id.slice(0, 12)}...)</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5 pl-3">
                    <Label className="text-xs">Keep-alive (minutes)</Label>
                    <Input
                      type="number"
                      value={keepAlive}
                      onChange={(e) => setKeepAlive(e.target.value)}
                      placeholder="Default"
                      className="h-8 text-xs w-32"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setError(null); setStep('repo') }}>Back</Button>
              <Button onClick={handleNextFromPrompt}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Review & Launch */}
        {step === 'review' && !isDone && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Repository</span>
                <span className="font-mono text-xs">{effectiveRepo}</span>
              </div>
              {branch && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-mono text-xs">{branch}</span>
                </div>
              )}
              <Separator />
              <div>
                <span className="text-muted-foreground">Task</span>
                <p className="mt-1 text-xs whitespace-pre-wrap line-clamp-4">{prompt}</p>
              </div>
              {(customName || snapshotId || keepAlive) && (
                <>
                  <Separator />
                  {customName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name</span>
                      <span className="text-xs">{customName}</span>
                    </div>
                  )}
                  {snapshotId && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Snapshot</span>
                      <span className="text-xs font-mono">{snapshotId.slice(0, 16)}...</span>
                    </div>
                  )}
                  {keepAlive && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Keep-alive</span>
                      <span className="text-xs">{keepAlive} min</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setError(null); setStep('prompt') }} disabled={isLaunching}>
                Back
              </Button>
              <Button onClick={handleLaunch} disabled={isLaunching}>
                {isLaunching && <Loader2 className="size-4 animate-spin" />}
                {isLaunching ? 'Launching...' : 'Launch Thopter'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Success */}
        {isDone && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="rounded-full bg-emerald-500/10 p-3">
                <Check className="size-6 text-emerald-500" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Thopter launched!</p>
                <p className="text-xs text-muted-foreground font-mono">{launchedName}</p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleDone}>Open Detail Tab</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
