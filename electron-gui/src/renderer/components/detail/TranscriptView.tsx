import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import type { TranscriptRole } from '@/services/types'

const roleConfig: Record<TranscriptRole, { label: string; color: string; border: string }> = {
  user: { label: 'user', color: 'text-emerald-400', border: 'border-l-emerald-500' },
  assistant: { label: 'assistant', color: 'text-cyan-400', border: 'border-l-cyan-500' },
  tool_use: { label: 'tool', color: 'text-amber-400', border: 'border-l-amber-500' },
  tool_result: { label: 'result', color: 'text-zinc-500', border: 'border-l-zinc-600' },
  system: { label: 'system', color: 'text-purple-400', border: 'border-l-purple-500' },
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface Props {
  name: string
}

export function TranscriptView({ name }: Props) {
  const entries = useStore((s) => s.transcripts[name] ?? [])
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  // Track whether user is scrolled near the bottom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      wasAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 60
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll only when user is already at bottom
  useEffect(() => {
    if (wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries.length])

  return (
    <div
      ref={containerRef}
      role="log"
      aria-label="Transcript"
      aria-live="polite"
      className="flex-1 overflow-y-auto p-4 space-y-0.5 font-mono text-xs"
    >
      {entries.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm font-sans">
          No transcript entries yet. Waiting for activity...
        </p>
      ) : (
        entries.map((entry, i) => {
          const cfg = roleConfig[entry.role] ?? roleConfig.system
          const showMarkdown = entry.role === 'assistant' && entry.full

          return (
            <div
              key={`${entry.ts}-${i}`}
              className={cn(
                'flex gap-2 py-1 px-2 rounded-sm border-l-2 hover:bg-muted/30 -mx-1',
                cfg.border,
                entry.role === 'tool_result' && 'opacity-60',
              )}
            >
              <span className="text-zinc-600 shrink-0 select-none leading-5 tabular-nums">
                {formatTime(entry.ts)}
              </span>
              <span className={cn('shrink-0 w-14 text-right select-none leading-5 font-medium', cfg.color)}>
                {cfg.label}
              </span>
              <div className="min-w-0 flex-1 break-words leading-5">
                {showMarkdown ? (
                  <div className="prose prose-invert prose-sm max-w-none [&_p]:my-0.5 [&_pre]:my-1 [&_pre]:bg-background/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-primary/80 [&_ol]:my-0.5 [&_ul]:my-0.5 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs font-sans text-sm">
                    <ReactMarkdown>{entry.full!}</ReactMarkdown>
                  </div>
                ) : (
                  <span className={cn(
                    entry.role === 'tool_result' && 'text-zinc-500',
                    entry.role === 'assistant' && 'text-foreground',
                  )}>
                    {entry.summary}
                  </span>
                )}
              </div>
            </div>
          )
        })
      )}
      <div ref={bottomRef} />
    </div>
  )
}
