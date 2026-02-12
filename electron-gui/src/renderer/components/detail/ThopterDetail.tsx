import { useEffect } from 'react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { StatusPanel } from './StatusPanel'
import { TranscriptView } from './TranscriptView'
import { TerminalView } from './TerminalView'
import { LiveTerminalView } from './LiveTerminalView'
import { ActionBar } from './ActionBar'

interface Props {
  tabName: string
}

export function ThopterDetail({ tabName }: Props) {
  const activeTab = useStore((s) => s.activeTab)
  const thopter = useStore((s) => s.thopters[tabName])
  const claudeReady = useStore((s) => s.claudeReady[tabName])
  const viewMode = useStore((s) => s.detailViewMode[tabName] ?? 'transcript')
  const liveTerminals = useStore((s) => s.liveTerminals)
  const setDetailViewMode = useStore((s) => s.setDetailViewMode)
  const fetchTranscript = useStore((s) => s.fetchTranscript)
  const subscribeTranscript = useStore((s) => s.subscribeTranscript)
  const unsubscribeTranscript = useStore((s) => s.unsubscribeTranscript)
  const checkClaude = useStore((s) => s.checkClaude)

  const isVisible = activeTab === tabName

  // Fetch transcript on mount and subscribe to live updates
  useEffect(() => {
    fetchTranscript(tabName)
    subscribeTranscript(tabName)
    return () => unsubscribeTranscript(tabName)
  }, [tabName, fetchTranscript, subscribeTranscript, unsubscribeTranscript])

  // Check tmux/Claude readiness when tab opens (only for running devboxes).
  // If not ready, poll every 5s until it is.
  useEffect(() => {
    if (thopter?.devboxStatus !== 'running') return
    checkClaude(tabName)
  }, [tabName, thopter?.devboxStatus, checkClaude])

  const isClaudeReady = claudeReady?.tmux && claudeReady?.claude
  useEffect(() => {
    if (thopter?.devboxStatus !== 'running') return
    if (isClaudeReady) return
    const interval = setInterval(() => checkClaude(tabName), 5_000)
    return () => clearInterval(interval)
  }, [tabName, thopter?.devboxStatus, isClaudeReady, checkClaude])

  const hasLiveTerminal = liveTerminals.includes(tabName)
  const liveVisible = isVisible && viewMode === 'live'

  if (!thopter) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Thopter "{tabName}" not found. It may have been destroyed.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <StatusPanel thopter={thopter} />

      {/* View mode toggle */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-muted/30">
        <button
          onClick={() => setDetailViewMode(tabName, 'transcript')}
          className={cn(
            'px-2.5 py-1 text-xs rounded font-medium transition-colors',
            viewMode === 'transcript'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          Transcript
        </button>
        <button
          onClick={() => setDetailViewMode(tabName, 'terminal')}
          className={cn(
            'px-2.5 py-1 text-xs rounded font-medium transition-colors',
            viewMode === 'terminal'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          Screen
        </button>
        <button
          onClick={() => setDetailViewMode(tabName, 'live')}
          className={cn(
            'px-2.5 py-1 text-xs rounded font-medium transition-colors',
            viewMode === 'live'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          Live
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Transcript and Screen unmount when not active (stateless) */}
        {viewMode === 'transcript' && <TranscriptView name={thopter.name} />}
        {viewMode === 'terminal' && <TerminalView name={thopter.name} />}

        {/* Live terminal stays mounted once activated, hidden/shown via CSS */}
        {hasLiveTerminal && (
          <div
            className="absolute inset-0"
            style={{ display: liveVisible ? 'flex' : 'none' }}
          >
            <LiveTerminalView name={thopter.name} visible={liveVisible} />
          </div>
        )}
      </div>

      {viewMode === 'terminal' && (
        <ActionBar name={thopter.name} status={thopter.status} devboxStatus={thopter.devboxStatus} claudeReady={claudeReady} />
      )}
    </div>
  )
}
