import { useEffect, useRef, useState, useCallback } from 'react'
import { getService } from '@/services'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import iosevkaRegular from '@/assets/fonts/IosevkaTermNerdFont-Regular.ttf'
import iosevkaBold from '@/assets/fonts/IosevkaTermNerdFont-Bold.ttf'
import iosevkaItalic from '@/assets/fonts/IosevkaTermNerdFont-Italic.ttf'
import iosevkaBoldItalic from '@/assets/fonts/IosevkaTermNerdFont-BoldItalic.ttf'

// node-pty loaded via Electron's native require (nodeIntegration: true)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = (window as any).require as NodeRequire
const pty = nodeRequire('node-pty')
const { shell } = nodeRequire('electron') as typeof import('electron')

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
  const wheelCleanupRef = useRef<(() => void) | null>(null)
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

    // Load bundled IosevkaTerm Nerd Font before creating the terminal.
    // xterm.js measures cell dimensions on creation, so the font must be
    // ready first or the metrics will be wrong.
    const fontName = 'IosevkaTerm Nerd Font'
    if (!document.fonts.check(`14px "${fontName}"`)) {
      const faces = [
        new FontFace(fontName, `url(${iosevkaRegular})`, { weight: '400', style: 'normal' }),
        new FontFace(fontName, `url(${iosevkaBold})`, { weight: '700', style: 'normal' }),
        new FontFace(fontName, `url(${iosevkaItalic})`, { weight: '400', style: 'italic' }),
        new FontFace(fontName, `url(${iosevkaBoldItalic})`, { weight: '700', style: 'italic' }),
      ]
      await Promise.all(faces.map(f => f.load().then(loaded => document.fonts.add(loaded))))
    }

    // Create xterm.js terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'IosevkaTerm Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
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
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      shell.openExternal(uri)
    }))
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

    // Handle OSC 52 clipboard sequences from tmux/neovim.
    // When tmux copies text in copy-mode (with set-clipboard on), it emits
    // OSC 52: \e]52;c;BASE64\a — xterm.js doesn't handle this by default.
    // We decode the base64 payload and write to the system clipboard.
    term.parser.registerOscHandler(52, (data: string) => {
      // Format: "c;BASE64" or "p;BASE64" (c=clipboard, p=primary selection)
      const idx = data.indexOf(';')
      if (idx === -1) return false
      const b64 = data.slice(idx + 1)
      if (b64 === '?') return false // query request, ignore
      try {
        // Decode base64 → bytes → UTF-8 text
        const text = new TextDecoder().decode(
          Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        )
        navigator.clipboard.writeText(text)
      } catch { /* ignore decode errors */ }
      return true // signal we handled it
    })

    // Wire binary data: terminal → pty (non-SGR mouse events)
    // Some mouse protocols encode button/coordinate bytes > 0x7F which xterm.js
    // emits through onBinary instead of onData.
    term.onBinary((data: string) => {
      const bytes = new Uint8Array(data.length)
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff
      }
      ptyProcess.write(Buffer.from(bytes))
    })

    // Custom wheel → SGR mouse scroll handler.
    // xterm.js's CoreMouseService handles clicks but NOT wheel events. The
    // Viewport consumes wheel events internally: in alternate screen without
    // mouse tracking it sends arrow keys; with mouse tracking it does nothing.
    // This handler intercepts wheel events on .xterm-screen and generates SGR
    // mouse scroll sequences routed through triggerDataEvent (the same code
    // path click events use). See docs/xterm-tmux-scroll.md for full details.
    const xtermScreen = container.querySelector('.xterm-screen') as HTMLElement | null
    const wheelHandler = (e: WheelEvent) => {
      const currentTerm = termRef.current
      if (!currentTerm) return

      // Only act when in the alternate buffer (tmux, vim, less, etc.).
      // In normal buffer, xterm.js handles scrollback natively.
      if (currentTerm.buffer.active !== currentTerm.buffer.alternate) return

      // Convert pixel position to 1-based terminal cell coordinates.
      // tmux uses these to determine which pane the scroll targets.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const cellWidth = rect.width / currentTerm.cols
      const cellHeight = rect.height / currentTerm.rows
      const col = Math.min(currentTerm.cols, Math.max(1, Math.floor((e.clientX - rect.left) / cellWidth) + 1))
      const row = Math.min(currentTerm.rows, Math.max(1, Math.floor((e.clientY - rect.top) / cellHeight) + 1))

      const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 25))
      const button = e.deltaY < 0 ? 64 : 65 // SGR: 64=scroll-up, 65=scroll-down
      const seq = `\x1b[<${button};${col};${row}M`

      // Route through xterm.js's internal data event — the same path that
      // click events use (CoreMouseService → triggerDataEvent → onData → pty.write).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const core = (currentTerm as any)._core
      for (let i = 0; i < lines; i++) {
        if (core?.coreService?.triggerDataEvent) {
          core.coreService.triggerDataEvent(seq, true)
        }
      }
      e.preventDefault()
      e.stopPropagation()
    }
    if (wheelCleanupRef.current) {
      wheelCleanupRef.current()
      wheelCleanupRef.current = null
    }
    if (xtermScreen) {
      xtermScreen.addEventListener('wheel', wheelHandler, { passive: false })
      wheelCleanupRef.current = () => xtermScreen.removeEventListener('wheel', wheelHandler)
    }

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
      if (wheelCleanupRef.current) {
        wheelCleanupRef.current()
        wheelCleanupRef.current = null
      }
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
      <div ref={containerRef} className="absolute inset-0" style={{ WebkitFontSmoothing: 'antialiased' }} />

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
