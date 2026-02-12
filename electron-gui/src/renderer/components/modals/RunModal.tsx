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
import { ChevronDown, ChevronUp, ChevronRight, Loader2, Check, Rocket, X, Plus, Home, GitBranch } from 'lucide-react'

type WorkMode = 'repo' | 'home'
type Step = 'mode' | 'repos' | 'prompt' | 'review'

interface CheckoutEntry {
  repo: string
  branch: string
}

export function RunModal() {
  const isOpen = useStore((s) => s.isRunModalOpen)
  const closeRunModal = useStore((s) => s.closeRunModal)
  const runThopter = useStore((s) => s.runThopter)
  const openTab = useStore((s) => s.openTab)

  const [step, setStep] = useState<Step>('mode')
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])

  // Form state
  const [mode, setMode] = useState<WorkMode>('repo')
  const [repo, setRepo] = useState('')
  const [customRepo, setCustomRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [checkouts, setCheckouts] = useState<CheckoutEntry[]>([])
  const [addingRepo, setAddingRepo] = useState(false)
  const [newCheckoutRepo, setNewCheckoutRepo] = useState('')
  const [newCheckoutCustomRepo, setNewCheckoutCustomRepo] = useState('')
  const [newCheckoutBranch, setNewCheckoutBranch] = useState('')
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
    setStep('mode')
    setMode('repo')
    setRepo('')
    setCustomRepo('')
    setBranch('')
    setCheckouts([])
    setAddingRepo(false)
    setNewCheckoutRepo('')
    setNewCheckoutCustomRepo('')
    setNewCheckoutBranch('')
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

  function handleSelectMode(m: WorkMode) {
    setMode(m)
    setError(null)
    setStep('repos')
  }

  function handleNextFromRepos() {
    if (mode === 'repo' && !effectiveRepo) {
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

  function handleAddCheckout() {
    const checkoutRepo = newCheckoutRepo === '__custom__' ? newCheckoutCustomRepo : newCheckoutRepo
    if (!checkoutRepo) return
    const checkoutBranch = newCheckoutBranch || 'main'
    setCheckouts([...checkouts, { repo: checkoutRepo, branch: checkoutBranch }])
    setNewCheckoutRepo('')
    setNewCheckoutCustomRepo('')
    setNewCheckoutBranch('')
    setAddingRepo(false)
  }

  function handleRemoveCheckout(idx: number) {
    setCheckouts(checkouts.filter((_, i) => i !== idx))
  }

  async function handleLaunch() {
    setIsLaunching(true)
    setError(null)
    try {
      let name: string
      if (mode === 'home') {
        name = await runThopter({
          homeDir: true,
          checkouts: checkouts.length > 0
            ? checkouts.map((c) => ({ repo: c.repo, branch: c.branch || undefined }))
            : undefined,
          prompt: prompt.trim(),
          name: customName || undefined,
          snapshotId: snapshotId || undefined,
          keepAliveMinutes: keepAlive ? parseInt(keepAlive, 10) : undefined,
        })
      } else {
        name = await runThopter({
          repo: effectiveRepo,
          branch: branch || undefined,
          prompt: prompt.trim(),
          name: customName || undefined,
          snapshotId: snapshotId || undefined,
          keepAliveMinutes: keepAlive ? parseInt(keepAlive, 10) : undefined,
        })
      }
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

  const STEP_LABELS: { key: Step; label: string }[] = [
    { key: 'mode', label: 'Mode' },
    { key: 'repos', label: mode === 'home' ? 'Checkouts' : 'Repository' },
    { key: 'prompt', label: 'Task' },
    { key: 'review', label: 'Launch' },
  ]

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
            {STEP_LABELS.map((s, i) => (
              <span key={s.key} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3" />}
                <span className={step === s.key ? 'text-primary font-medium' : ''}>{s.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Step 1: Mode selection */}
        {step === 'mode' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose how Claude should work on this task.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="flex flex-col items-center gap-2 rounded-lg border-2 border-border p-4 text-center transition-colors hover:border-primary hover:bg-accent"
                onClick={() => handleSelectMode('repo')}
              >
                <GitBranch className="size-6 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Single Repository</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Clone and work in one repo</p>
                </div>
              </button>
              <button
                className="flex flex-col items-center gap-2 rounded-lg border-2 border-border p-4 text-center transition-colors hover:border-primary hover:bg-accent"
                onClick={() => handleSelectMode('home')}
              >
                <Home className="size-6 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Home Directory</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Work from /home/user with optional repos</p>
                </div>
              </button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Repository / Checkouts */}
        {step === 'repos' && mode === 'repo' && (
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
              <Button variant="outline" onClick={() => { setError(null); setStep('mode') }}>Back</Button>
              <Button onClick={handleNextFromRepos}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {step === 'repos' && mode === 'home' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pre-checkout Repositories</Label>
              <p className="text-xs text-muted-foreground">
                Optionally clone repositories before starting. Claude will work from /home/user.
              </p>
            </div>

            {/* Checkout list */}
            {checkouts.length > 0 && (
              <div className="space-y-2">
                {checkouts.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="font-mono text-xs">
                      {c.repo} <span className="text-muted-foreground">({c.branch})</span>
                    </span>
                    <button
                      onClick={() => handleRemoveCheckout(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add repo inline form */}
            {addingRepo ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Repository</Label>
                  <select
                    value={newCheckoutRepo}
                    onChange={(e) => setNewCheckoutRepo(e.target.value)}
                    className={selectClass}
                    autoFocus
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

                {newCheckoutRepo === '__custom__' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Custom repo (owner/name)</Label>
                    <Input
                      value={newCheckoutCustomRepo}
                      onChange={(e) => setNewCheckoutCustomRepo(e.target.value)}
                      placeholder="owner/repo"
                      className="h-8 text-xs"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Branch</Label>
                  <Input
                    value={newCheckoutBranch}
                    onChange={(e) => setNewCheckoutBranch(e.target.value)}
                    placeholder="main (default)"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAddingRepo(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddCheckout}
                    disabled={!(newCheckoutRepo === '__custom__' ? newCheckoutCustomRepo : newCheckoutRepo)}
                  >
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingRepo(true)}
                className="gap-1.5"
              >
                <Plus className="size-3.5" />
                Add Repository
              </Button>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setError(null); setStep('mode') }}>Back</Button>
              <Button onClick={handleNextFromRepos}>
                {checkouts.length === 0 ? 'Skip' : 'Next'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Task prompt */}
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
                className="font-mono text-sm max-h-[40vh] overflow-y-auto [field-sizing:fixed]"
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
              <Button variant="outline" onClick={() => { setError(null); setStep('repos') }}>Back</Button>
              <Button onClick={handleNextFromPrompt}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Review & Launch */}
        {step === 'review' && !isDone && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode</span>
                <span className="text-xs">{mode === 'home' ? 'Home directory' : 'Single repository'}</span>
              </div>
              {mode === 'repo' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Repository</span>
                  <span className="font-mono text-xs">{effectiveRepo}</span>
                </div>
              )}
              {mode === 'repo' && branch && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-mono text-xs">{branch}</span>
                </div>
              )}
              {mode === 'home' && checkouts.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Checkouts</span>
                  <div className="mt-1 space-y-0.5">
                    {checkouts.map((c, i) => (
                      <p key={i} className="font-mono text-xs text-muted-foreground">
                        {c.repo} ({c.branch})
                      </p>
                    ))}
                  </div>
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
