import { useEffect } from 'react'
import { useStore } from '@/store'
import { StatusPanel } from './StatusPanel'
import { TranscriptView } from './TranscriptView'
import { ActionBar } from './ActionBar'

export function ThopterDetail() {
  const activeTab = useStore((s) => s.activeTab)
  const thopter = useStore((s) => s.thopters[s.activeTab])
  const claudeReady = useStore((s) => s.claudeReady[s.activeTab])
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

  // Check tmux/Claude readiness when tab opens (only for running devboxes)
  useEffect(() => {
    if (activeTab === 'dashboard') return
    if (thopter?.devboxStatus === 'running') {
      checkClaude(activeTab)
    }
  }, [activeTab, thopter?.devboxStatus, checkClaude])

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
      <TranscriptView name={thopter.name} />
      <ActionBar name={thopter.name} status={thopter.status} devboxStatus={thopter.devboxStatus} claudeReady={claudeReady} />
    </div>
  )
}
