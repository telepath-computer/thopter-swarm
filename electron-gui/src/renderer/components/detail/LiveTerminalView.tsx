import { useEffect, useRef, useState, useCallback } from 'react'
import { getService } from '@/services'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// node-pty loaded via Electron's native require (nodeIntegration: true)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = (window as any).require as NodeRequire
const pty = nodeRequire('node-pty')

interface Props {
  name: string
  visible?: boolean
  spawnInfo?: { command: string; args: string[] }
}

type ViewState = 'connecting' | 'connected' | 'error' | 'exited'

export function LiveTerminalView({ name, visible = true, spawnInfo: spawnInfoProp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const ptyRef = useRef<ReturnType<typeof pty.spawn> | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [state, setState] = useState<ViewState>('connecting')
  const [errorMsg, setErrorMsg] = useState('')

  const connect = useCallback(async () => {
    const container = containerRef.current
    if (!container) return

    setState('connecting')
    setErrorMsg('')

    // Clean up any existing session
    if (ptyRef.current) {
      try { ptyRef.current.kill() } catch { /* ignore */ }
      ptyRef.current = null
    }
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }
    if (fitAddonRef.current) {
      fitAddonRef.current = null
    }
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    // Clear container
    container.innerHTML = ''

    // Create xterm.js terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#c9d1d9',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Defer initial fit to next frame so the DOM has fully laid out
    await new Promise((r) => requestAnimationFrame(r))
    fitAddon.fit()

    // Get SSH spawn info from prop or service
    let spawnInfo: { command: string; args: string[] }
    try {
      spawnInfo = spawnInfoProp ?? await getService().getSSHSpawn(name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setState('error')
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      return
    }

    // Re-fit right before spawning in case layout shifted during the async call
    fitAddon.fit()

    // Spawn PTY
    const ptyProcess = pty.spawn(spawnInfo.command, spawnInfo.args, {
      name: 'xterm-256color',
      cols: term.cols,
      rows: term.rows,
      cwd: process.env.HOME,
      env: process.env,
    })
    ptyRef.current = ptyProcess

    // Wire data: pty → terminal
    ptyProcess.onData((data: string) => {
      term.write(data)
    })

    // Wire data: terminal → pty (keyboard input + SGR mouse events)
    term.onData((data: string) => {
      ptyProcess.write(data)
    })

    // Wire binary data: terminal → pty (non-SGR mouse events including scroll)
    // Without this, mouse scroll events are silently dropped when tmux uses
    // the basic mouse protocol (bytes > 0x7F go through onBinary, not onData).
    term.onBinary((data: string) => {
      const bytes = new Uint8Array(data.length)
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff
      }
      ptyProcess.write(Buffer.from(bytes))
    })

    // Handle exit
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      ptyRef.current = null
      if (exitCode === 0) {
        setState('exited')
      } else {
        setErrorMsg(`Process exited with code ${exitCode}`)
        setState('error')
      }
    })

    setState('connected')
    term.focus()

    // Resize observer: fit terminal to container and update PTY dimensions
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        fitAddonRef.current.fit()
        if (ptyRef.current) {
          ptyRef.current.resize(termRef.current.cols, termRef.current.rows)
        }
      }
    })
    observer.observe(container)
    observerRef.current = observer
  }, [name, spawnInfoProp])

  // Re-fit and re-focus when becoming visible (after being hidden via display:none)
  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      if (fitAddonRef.current && termRef.current) {
        fitAddonRef.current.fit()
        if (ptyRef.current) {
          ptyRef.current.resize(termRef.current.cols, termRef.current.rows)
        }
        termRef.current.focus()
      }
    })
  }, [visible])

  // Connect on mount, clean up on unmount
  useEffect(() => {
    connect()

    return () => {
      if (ptyRef.current) {
        try { ptyRef.current.kill() } catch { /* ignore */ }
        ptyRef.current = null
      }
      if (termRef.current) {
        termRef.current.dispose()
        termRef.current = null
      }
      fitAddonRef.current = null
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [connect])

  return (
    <div className="flex-1 relative bg-[#0d1117]">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Connecting overlay */}
      {state === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/90 z-10">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Connecting to {name}...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {state === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/90 z-10">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <span className="text-sm text-red-400">{errorMsg || 'Connection failed'}</span>
            <button
              onClick={connect}
              className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Exited overlay */}
      {state === 'exited' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/90 z-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-sm text-muted-foreground">Session ended</span>
            <button
              onClick={connect}
              className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
