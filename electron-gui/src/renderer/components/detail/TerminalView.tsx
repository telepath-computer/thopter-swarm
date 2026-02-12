import { useEffect, useRef } from 'react'
import { useStore } from '@/store'

interface Props {
  name: string
}

export function TerminalView({ name }: Props) {
  const screenDump = useStore((s) => s.screenDumps[name])
  const fetchScreenDump = useStore((s) => s.fetchScreenDump)
  const containerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  // Poll for screen dump updates every 5s while visible
  useEffect(() => {
    fetchScreenDump(name)
    const interval = setInterval(() => fetchScreenDump(name), 5_000)
    return () => clearInterval(interval)
  }, [name, fetchScreenDump])

  // Track scroll position
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

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (wasAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [screenDump])

  if (!screenDump) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No terminal data. The devbox may be suspended or not yet reporting.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto bg-[#0d1117] p-4"
    >
      <pre className="font-mono text-xs leading-5 text-[#c9d1d9] whitespace-pre">
        {screenDump}
      </pre>
    </div>
  )
}
