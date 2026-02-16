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

// Load tmux-cc-terminal modules via Node.js require (nodeIntegration: true).
// The tmux-cc-terminal/ directory is a sibling of electron-gui/ in the monorepo.
// process.cwd() in Electron is the electron-gui/ directory (both dev and prod).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = (window as any).require as NodeRequire
const nodePath = nodeRequire('path') as typeof import('path')
const tmuxCCRoot = nodePath.resolve(process.cwd(), '..', 'tmux-cc-terminal')
const { shell } = nodeRequire('electron') as typeof import('electron')
const { TmuxAdapter } = nodeRequire(nodePath.join(tmuxCCRoot, 'lib', 'tmux-adapter'))
const { createTmuxTerminal } = nodeRequire(nodePath.join(tmuxCCRoot, 'renderer', 'renderer'))

interface Props {
  name: string
  devboxId?: string | null
  visible?: boolean
  spawnInfo?: { command: string; args: string[] }
}

type ViewState = 'connecting' | 'connected' | 'error' | 'exited'

export function TmuxLiveTerminalView({ name, devboxId, visible = true, spawnInfo: spawnInfoProp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<InstanceType<typeof TmuxAdapter> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null)
  const [state, setState] = useState<ViewState>('connecting')
  const [errorMsg, setErrorMsg] = useState('')

  const connect = useCallback(async () => {
    const container = containerRef.current
    if (!container) return

    setState('connecting')
    setErrorMsg('')

    // Clean up any existing session
    if (apiRef.current) {
      apiRef.current.destroy()
      apiRef.current = null
    }
    if (adapterRef.current) {
      await adapterRef.current.destroy()
      adapterRef.current = null
    }

    // Clear container
    container.innerHTML = ''

    // Load bundled IosevkaTerm Nerd Font before creating terminals.
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

    // Get SSH spawn info from prop, devbox ID, or name lookup.
    // Prefer getSSHSpawnById (uses Runloop API directly) over getSSHSpawn
    // (queries Redis, which may not have data for this thopter).
    let spawnInfo: { command: string; args: string[] }
    try {
      if (spawnInfoProp) {
        spawnInfo = spawnInfoProp
      } else if (devboxId) {
        spawnInfo = await getService().getSSHSpawnById(devboxId)
      } else {
        spawnInfo = await getService().getSSHSpawn(name)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setState('error')
      return
    }

    // Build SSH args for the TmuxAdapter.
    // getSSHSpawn() returns { command: 'ssh', args: ['-tt', ...opts, 'user@host', 'bash -l'] }.
    // We need to replace the remote command ('bash -l') with the tmux CC command.
    const sessionName = name.replace(/[^a-zA-Z0-9_-]/g, '-')
    const tmuxCmd = `tmux -CC new-session -A -s ${sessionName} -x 120 -y 36`

    // Replace the last arg (remote command like 'bash -l') with tmux CC command
    const sshArgs = [...spawnInfo.args]
    if (sshArgs.length > 0) {
      sshArgs[sshArgs.length - 1] = tmuxCmd
    } else {
      sshArgs.push(tmuxCmd)
    }

    // Create TmuxAdapter with programmatic config.
    // spawnCommand: the SSH binary (usually 'ssh')
    // rawArgs: true — we've already assembled the full arg list including the tmux command
    const adapter = new TmuxAdapter({
      sshArgs,
      sessionName,
      targetLabel: name,
      spawnCommand: spawnInfo.command,
      rawArgs: true,
    })
    adapterRef.current = adapter

    // Create the tmux terminal UI
    const tmuxContainer = document.createElement('div')
    tmuxContainer.style.cssText = 'display:flex;flex-direction:column;height:100%;width:100%'
    container.appendChild(tmuxContainer)

    // Inject the POC's CSS into the document if not already present
    if (!document.getElementById('tmux-cc-styles')) {
      const style = document.createElement('style')
      style.id = 'tmux-cc-styles'
      style.textContent = getTmuxCCStyles()
      document.head.appendChild(style)
    }

    const api = createTmuxTerminal(tmuxContainer, adapter, {
      Terminal,
      FitAddon: { FitAddon },
      WebLinksAddon: { WebLinksAddon },
      linkHandler: {
        activate(_event: MouseEvent, uri: string) {
          shell.openExternal(uri)
        },
      },
      onWebLinkClick: (_event: MouseEvent, uri: string) => {
        shell.openExternal(uri)
      },
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
      fontFamily: "'IosevkaTerm Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    })
    apiRef.current = api

    adapter.on('connected', () => {
      setState('connected')
    })

    adapter.on('disconnected', (reason: string) => {
      if (reason === 'tmux exited' || reason.includes('exited')) {
        setState('exited')
      } else {
        setErrorMsg(reason)
        setState('error')
      }
    })

    try {
      await adapter.connect()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setState('error')
    }
  }, [name, devboxId, spawnInfoProp])

  // Re-fit when becoming visible
  useEffect(() => {
    if (!visible) return
    // Trigger a resize event so terminals re-fit
    requestAnimationFrame(() => {
      const container = containerRef.current
      if (container) {
        // ResizeObserver inside createTmuxTerminal handles fitting
        // Just trigger a layout recalc
        container.style.display = 'none'
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        container.offsetHeight // force reflow
        container.style.display = ''
      }
    })
  }, [visible])

  // Connect on mount, clean up on unmount
  useEffect(() => {
    connect()

    return () => {
      if (apiRef.current) {
        apiRef.current.destroy()
        apiRef.current = null
      }
      if (adapterRef.current) {
        adapterRef.current.destroy()
        adapterRef.current = null
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
            <span className="text-sm">Connecting to {name} (tmux CC)...</span>
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

/**
 * CSS for the tmux CC terminal UI (tab bar, status bar, pane layout).
 * Adapted from the POC's style.css to work inside a React component.
 */
function getTmuxCCStyles(): string {
  return `
    #tab-bar {
      display: flex;
      align-items: center;
      background: #161b22;
      height: 36px;
      padding: 0 8px;
      gap: 4px;
    }
    #tabs {
      display: flex;
      gap: 2px;
      overflow-x: auto;
    }
    .tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: #21262d;
      border: none;
      border-radius: 6px 6px 0 0;
      color: #8b949e;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
    }
    .tab:hover { background: #30363d; }
    .tab.active { background: #0d1117; color: #c9d1d9; }
    .tab .close-btn {
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.5;
    }
    .tab .close-btn:hover { opacity: 1; color: #f85149; }
    .tab .split-btn {
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.4;
      padding: 0 2px;
    }
    .tab .split-btn:hover { opacity: 1; color: #58a6ff; }
    #new-tab-btn, #detach-btn, #connect-btn {
      background: none;
      border: 1px solid #30363d;
      color: #8b949e;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    #new-tab-btn:hover, #detach-btn:hover, #connect-btn:hover {
      background: #30363d;
      color: #c9d1d9;
    }
    #spacer { flex: 1; }
    #status-bar {
      background: #010409;
      padding: 2px 12px;
      font-size: 12px;
      color: #484f58;
      height: 22px;
      display: flex;
      align-items: center;
    }
    #terminal-container {
      flex: 1;
      min-height: 0;
      background: #0d1117;
      position: relative;
      overflow: hidden;
    }
    .window-wrapper {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
    }
    .window-wrapper.active { display: block; }
    .terminal-wrapper {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: block;
      padding: 4px;
    }
    .terminal-wrapper.split-pane {
      border: 1px solid #30363d;
      padding: 1px;
    }
    .terminal-wrapper.split-pane.active-pane {
      border-color: #58a6ff;
    }
  `
}
