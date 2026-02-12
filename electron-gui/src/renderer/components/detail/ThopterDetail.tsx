import { useEffect } from 'react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { StatusPanel } from './StatusPanel'
import { TranscriptView } from './TranscriptView'
import { TerminalView } from './TerminalView'
import { LiveTerminalView } from './LiveTerminalView'
import { ActionBar } from './ActionBar'

export function ThopterDetail() {
  const activeTab = useStore((s) => s.activeTab)
  const thopter = useStore((s) => s.thopters[s.activeTab])
  const claudeReady = useStore((s) => s.claudeReady[s.activeTab])
  const viewMode = useStore((s) => s.detailViewMode[s.activeTab] ?? 'transcript')
  const setDetailViewMode = useStore((s) => s.setDetailViewMode)
  const fetchTranscript = useStore((s) => s.fetchTranscript)
  const subscribeTranscript = useStore((s) => s.subscribeTranscript)
  const unsubscribeTranscript = useStore((s) => s.unsubscribeTranscript)
  const checkClaude = useStore((s) => s.checkClaude)

  // Fetch transcript on mount and subscribe to live updates
  useEffect(() => {
    if (activeTab === 'dashboard') return
    fetchTranscript(activeTab)
    subscribeTranscript(activeTab)
    return () => unsubscribeTranscript(activeTab)
  }, [activeTab, fetchTranscript, subscribeTranscript, unsubscribeTranscript])

  // Check tmux/Claude readiness when tab opens (only for running devboxes).
  // If not ready, poll every 5s until it is.
  useEffect(() => {
    if (activeTab === 'dashboard') return
    if (thopter?.devboxStatus !== 'running') return
    checkClaude(activeTab)
  }, [activeTab, thopter?.devboxStatus, checkClaude])

  const isClaudeReady = claudeReady?.tmux && claudeReady?.claude
  useEffect(() => {
    if (activeTab === 'dashboard') return
    if (thopter?.devboxStatus !== 'running') return
    if (isClaudeReady) return
    const interval = setInterval(() => checkClaude(activeTab), 5_000)
    return () => clearInterval(interval)
  }, [activeTab, thopter?.devboxStatus, isClaudeReady, checkClaude])

  if (!thopter) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Thopter "{activeTab}" not found. It may have been destroyed.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <StatusPanel thopter={thopter} />

      {/* View mode toggle */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-muted/30">
        <button
          onClick={() => setDetailViewMode(activeTab, 'transcript')}
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
          onClick={() => setDetailViewMode(activeTab, 'terminal')}
          className={cn(
            'px-2.5 py-1 text-xs rounded font-medium transition-colors',
            viewMode === 'terminal'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          Terminal
        </button>
        <button
          onClick={() => setDetailViewMode(activeTab, 'live')}
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

      {viewMode === 'transcript' ? (
        <TranscriptView name={thopter.name} />
      ) : viewMode === 'terminal' ? (
        <TerminalView name={thopter.name} />
      ) : (
        <LiveTerminalView name={thopter.name} />
      )}

      <ActionBar name={thopter.name} status={thopter.status} devboxStatus={thopter.devboxStatus} claudeReady={claudeReady} />
    </div>
  )
}
