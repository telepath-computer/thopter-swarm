'use strict';

/* global Terminal, FitAddon */

/**
 * Create a tmux CC terminal UI inside a container element.
 *
 * @param {HTMLElement} container - The DOM element to render into
 * @param {Object} adapter - TmuxAdapter (or IPC bridge) with EventEmitter-style on() + command methods
 * @param {Object} [options]
 * @param {typeof Terminal} [options.Terminal] - xterm.js Terminal class
 * @param {Object} [options.FitAddon] - FitAddon module (with .FitAddon property or itself a constructor)
 * @param {Object} [options.theme] - xterm.js theme override
 * @param {string} [options.fontFamily] - font family override
 * @param {number} [options.fontSize] - font size override
 * @param {Object} [options.linkHandler] - xterm.js linkHandler for OSC 8 hyperlinks ({ activate(event, uri) })
 * @param {Object} [options.WebLinksAddon] - WebLinksAddon module (with .WebLinksAddon property or class itself)
 * @param {Function} [options.onWebLinkClick] - callback for plain-text URL clicks: (event, uri) => void
 * @returns {Object} Control interface: { destroy(), newWindow(), ... }
 */
function createTmuxTerminal(container, adapter, options = {}) {
  // Resolve Terminal and FitAddon
  const TerminalClass = options.Terminal || (typeof Terminal !== 'undefined' ? Terminal : null);
  const FitAddonModule = options.FitAddon || (typeof FitAddon !== 'undefined' ? FitAddon : null);
  if (!TerminalClass) throw new Error('Terminal class not provided');
  if (!FitAddonModule) throw new Error('FitAddon not provided');

  // FitAddon may be { FitAddon: class } (script tag) or the class itself (import)
  const FitAddonClass = FitAddonModule.FitAddon || FitAddonModule;

  // State
  const panes = new Map();
  const tabs = new Map();
  let activeWindowId = null;
  let _suppressResize = false;
  const _pendingOutputBuffer = new Map();

  // Create internal DOM structure
  const tabBar = document.createElement('div');
  tabBar.id = 'tab-bar';
  tabBar.innerHTML = `
    <div id="tabs"></div>
    <button id="new-tab-btn" title="New window">+</button>
    <div id="spacer"></div>
    <button id="detach-btn" title="Detach from tmux">Detach</button>
    <button id="connect-btn" title="Reconnect" style="display:none;">Connect</button>
  `;
  const statusBar = document.createElement('div');
  statusBar.id = 'status-bar';
  statusBar.innerHTML = '<span id="status-text">Connecting...</span>';
  const terminalContainer = document.createElement('div');
  terminalContainer.id = 'terminal-container';

  container.appendChild(tabBar);
  container.appendChild(statusBar);
  container.appendChild(terminalContainer);

  // DOM refs (scoped to our container)
  const tabsContainer = tabBar.querySelector('#tabs');
  const statusText = statusBar.querySelector('#status-text');
  const newTabBtn = tabBar.querySelector('#new-tab-btn');
  const detachBtn = tabBar.querySelector('#detach-btn');
  const connectBtn = tabBar.querySelector('#connect-btn');

  // Terminal options
  const termTheme = options.theme || {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#585b7066',
  };
  const termFontFamily = options.fontFamily || "'IosevkaTerm Nerd Font Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
  const termFontSize = options.fontSize || 14;
  const termLinkHandler = options.linkHandler || undefined;

  // WebLinksAddon for plain-text URL detection (lower priority than OSC 8 links)
  const WebLinksAddonModule = options.WebLinksAddon || null;
  const WebLinksAddonClass = WebLinksAddonModule
    ? (WebLinksAddonModule.WebLinksAddon || WebLinksAddonModule)
    : null;
  const onWebLinkClick = options.onWebLinkClick || null;

  // ── Helpers ──

  function setStatus(msg) {
    statusText.textContent = msg;
  }

  let _lastClientCols = 0;
  let _lastClientRows = 0;

  function sendClientSize() {
    if (!activeWindowId) return;
    const tab = tabs.get(activeWindowId);
    if (!tab) return;

    let cols, rows;

    if (tab.paneIds.length === 1) {
      const pane = panes.get(tab.paneIds[0]);
      if (!pane) return;
      cols = pane.term.cols;
      rows = pane.term.rows;
    } else if (tab.paneLayout && tab.paneLayout.length >= 2) {
      const pl = tab.paneLayout;
      const withTerms = pl.map((p) => ({ ...p, pane: panes.get(p.paneId) }))
        .filter((p) => p.pane);

      if (withTerms.length < 2) return;

      const allSameTop = withTerms.every((p) => p.top === withTerms[0].top);
      const allSameLeft = withTerms.every((p) => p.left === withTerms[0].left);

      if (allSameTop) {
        const sorted = withTerms.sort((a, b) => a.left - b.left);
        cols = sorted.reduce((sum, p) => sum + p.pane.term.cols, 0)
          + (sorted.length - 1);
        rows = Math.max(...sorted.map((p) => p.pane.term.rows));
      } else if (allSameLeft) {
        const sorted = withTerms.sort((a, b) => a.top - b.top);
        cols = Math.max(...sorted.map((p) => p.pane.term.cols));
        rows = sorted.reduce((sum, p) => sum + p.pane.term.rows, 0)
          + (sorted.length - 1);
      } else {
        let maxRight = 0, maxBottom = 0;
        for (const p of withTerms) {
          maxRight = Math.max(maxRight, p.left + p.pane.term.cols);
          maxBottom = Math.max(maxBottom, p.top + p.pane.term.rows);
        }
        cols = maxRight;
        rows = maxBottom;
      }
    } else {
      return;
    }

    if (cols > 0 && rows > 0 && (cols !== _lastClientCols || rows !== _lastClientRows)) {
      _lastClientCols = cols;
      _lastClientRows = rows;
      adapter.resize(cols, rows);
    }
  }

  function createTerminalPane(paneId, windowId, name) {
    const termOpts = {
      cursorBlink: true,
      fontSize: termFontSize,
      fontFamily: termFontFamily,
      theme: termTheme,
      scrollback: 5000,
      allowProposedApi: true,
    };
    if (termLinkHandler) termOpts.linkHandler = termLinkHandler;
    const term = new TerminalClass(termOpts);

    const fitAddon = new FitAddonClass();
    term.loadAddon(fitAddon);

    // Load WebLinksAddon for plain-text URL detection (won't fire on OSC 8 links)
    if (WebLinksAddonClass) {
      const webLinksAddon = onWebLinkClick
        ? new WebLinksAddonClass(onWebLinkClick)
        : new WebLinksAddonClass();
      term.loadAddon(webLinksAddon);
    }

    let tab = tabs.get(windowId);
    let windowWrapper;
    if (tab) {
      windowWrapper = tab.windowWrapper;
    } else {
      windowWrapper = document.createElement('div');
      windowWrapper.className = 'window-wrapper';
      windowWrapper.id = `window-${windowId}`;
      terminalContainer.appendChild(windowWrapper);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-wrapper';
    wrapper.id = `term-${paneId}`;
    windowWrapper.appendChild(wrapper);

    term.open(wrapper);
    fitAddon.fit();

    term.onData((data) => {
      adapter.sendKeys(paneId, data);
    });

    term.textarea.addEventListener('focus', () => {
      const t = tabs.get(windowId);
      if (t && t.paneIds.length > 1 && t.activePaneId !== paneId) {
        t.activePaneId = paneId;
        adapter.selectPane(paneId);
      }
    });

    panes.set(paneId, { term, fitAddon, windowId, wrapper });

    if (_pendingOutputBuffer.has(paneId)) {
      const buffered = _pendingOutputBuffer.get(paneId);
      for (const data of buffered) {
        term.write(data);
      }
      _pendingOutputBuffer.delete(paneId);
    }

    if (!tab) {
      createTab(windowId, paneId, name);
    } else {
      tab.paneIds.push(paneId);
    }

    return { term, fitAddon, wrapper };
  }

  function createTab(windowId, paneId, name) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.windowId = windowId;

    const label = document.createElement('span');
    label.textContent = name || windowId;

    const splitHBtn = document.createElement('span');
    splitHBtn.className = 'split-btn';
    splitHBtn.textContent = '\u2503';
    splitHBtn.title = 'Split horizontal';
    splitHBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = tabs.get(windowId);
      if (tab) adapter.splitPane(tab.activePaneId, 'v');
    });

    const splitVBtn = document.createElement('span');
    splitVBtn.className = 'split-btn';
    splitVBtn.textContent = '\u2501';
    splitVBtn.title = 'Split vertical';
    splitVBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = tabs.get(windowId);
      if (tab) adapter.splitPane(tab.activePaneId, 'h');
    });

    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adapter.closeWindow(windowId);
    });

    tabEl.appendChild(label);
    tabEl.appendChild(splitHBtn);
    tabEl.appendChild(splitVBtn);
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => {
      activateTab(windowId);
    });

    let windowWrapper = terminalContainer.querySelector(`#window-${CSS.escape(windowId)}`);
    if (!windowWrapper) {
      windowWrapper = document.createElement('div');
      windowWrapper.className = 'window-wrapper';
      windowWrapper.id = `window-${windowId}`;
      terminalContainer.appendChild(windowWrapper);
    }

    tabsContainer.appendChild(tabEl);
    tabs.set(windowId, {
      tabEl,
      paneIds: [paneId],
      activePaneId: paneId,
      name,
      windowWrapper,
    });
  }

  function activateTab(windowId) {
    if (activeWindowId === windowId) return;

    if (activeWindowId) {
      const oldTab = tabs.get(activeWindowId);
      if (oldTab) {
        oldTab.tabEl.classList.remove('active');
        oldTab.windowWrapper.classList.remove('active');
      }
    }

    activeWindowId = windowId;
    const tab = tabs.get(windowId);
    if (tab) {
      tab.tabEl.classList.add('active');
      tab.windowWrapper.classList.add('active');
      setTimeout(() => {
        for (const pid of tab.paneIds) {
          const pane = panes.get(pid);
          if (pane) pane.fitAddon.fit();
        }
        sendClientSize();
        const activePane = panes.get(tab.activePaneId);
        if (activePane) activePane.term.focus();
      }, 10);
    }
  }

  function removePane(paneId) {
    const pane = panes.get(paneId);
    if (!pane) return;

    pane.term.dispose();
    pane.wrapper.remove();
    panes.delete(paneId);
    _pendingOutputBuffer.delete(paneId);

    const tab = tabs.get(pane.windowId);
    if (tab) {
      const idx = tab.paneIds.indexOf(paneId);
      if (idx !== -1) tab.paneIds.splice(idx, 1);
      if (tab.activePaneId === paneId) {
        tab.activePaneId = tab.paneIds[0] || null;
      }
      if (tab.paneIds.length === 1) {
        const remaining = panes.get(tab.paneIds[0]);
        if (remaining) {
          remaining.wrapper.style.cssText = '';
          remaining.wrapper.classList.add('active');
          remaining.fitAddon.fit();
        }
      }
    }
  }

  function removeWindow(windowId) {
    const tab = tabs.get(windowId);
    if (!tab) return;

    for (const pid of [...tab.paneIds]) {
      const pane = panes.get(pid);
      if (pane) {
        pane.term.dispose();
        pane.wrapper.remove();
        panes.delete(pid);
      }
    }

    tab.windowWrapper.remove();
    tab.tabEl.remove();
    tabs.delete(windowId);

    if (activeWindowId === windowId) {
      activeWindowId = null;
      const remaining = Array.from(tabs.keys());
      if (remaining.length > 0) {
        activateTab(remaining[0]);
      }
    }
  }

  function clearAll() {
    for (const [, pane] of panes) {
      pane.term.dispose();
      pane.wrapper.remove();
    }
    panes.clear();
    _pendingOutputBuffer.clear();

    for (const [, tab] of tabs) {
      tab.tabEl.remove();
      tab.windowWrapper.remove();
    }
    tabs.clear();

    activeWindowId = null;
  }

  function applyPaneLayout(windowId, paneList) {
    const tab = tabs.get(windowId);
    if (!tab) return;

    const isVisible = windowId === activeWindowId;
    _suppressResize = true;

    try {
      if (paneList.length <= 1) {
        for (const pid of tab.paneIds) {
          const p = panes.get(pid);
          if (p) {
            p.wrapper.style.cssText = '';
            p.wrapper.classList.add('active');
            p.wrapper.classList.remove('split-pane', 'active-pane');
            if (isVisible) p.fitAddon.fit();
          }
        }
        return;
      }

      let maxRight = 0;
      let maxBottom = 0;
      for (const pl of paneList) {
        maxRight = Math.max(maxRight, pl.left + pl.width);
        maxBottom = Math.max(maxBottom, pl.top + pl.height);
      }

      const totalW = maxRight || 1;
      const totalH = maxBottom || 1;

      for (const pl of paneList) {
        const pane = panes.get(pl.paneId);
        if (!pane) continue;

        const leftPct = (pl.left / totalW) * 100;
        const topPct = (pl.top / totalH) * 100;
        const widthPct = (pl.width / totalW) * 100;
        const heightPct = (pl.height / totalH) * 100;

        pane.wrapper.style.position = 'absolute';
        pane.wrapper.style.left = `${leftPct}%`;
        pane.wrapper.style.top = `${topPct}%`;
        pane.wrapper.style.width = `${widthPct}%`;
        pane.wrapper.style.height = `${heightPct}%`;
        pane.wrapper.style.right = 'auto';
        pane.wrapper.style.bottom = 'auto';
        pane.wrapper.style.display = 'block';

        pane.wrapper.classList.add('split-pane');
        if (pl.active) {
          pane.wrapper.classList.add('active-pane');
        } else {
          pane.wrapper.classList.remove('active-pane');
        }

        if (isVisible) pane.fitAddon.fit();
      }
    } finally {
      _suppressResize = false;
    }
  }

  function buildModeRestoreSequence(paneState) {
    let seq = '';
    if (!paneState.cursorVisible) {
      seq += '\x1b[?25l';
    }
    const regionLower = paneState.scrollRegionLower;
    const paneHeight = paneState.paneHeight;
    if (paneState.scrollRegionUpper > 0 || (regionLower > 0 && regionLower < paneHeight - 1)) {
      seq += `\x1b[${paneState.scrollRegionUpper + 1};${regionLower + 1}r`;
    }
    if (paneState.keypadCursorFlag) {
      seq += '\x1b[?1h';
    }
    if (paneState.keypadFlag) {
      seq += '\x1b=';
    }
    if (paneState.mouseStandardFlag) {
      seq += '\x1b[?1000h';
    }
    if (paneState.mouseButtonFlag) {
      seq += '\x1b[?1002h';
    }
    if (paneState.mouseAnyFlag) {
      seq += '\x1b[?1003h';
    }
    if (paneState.mouseSgrFlag) {
      seq += '\x1b[?1006h';
    }
    if (paneState.wrapFlag === false) {
      seq += '\x1b[?7l';
    }
    if (paneState.insertFlag) {
      seq += '\x1b[4h';
    }
    return seq;
  }

  // ── ResizeObserver ──

  const resizeObserver = new ResizeObserver(() => {
    if (activeWindowId) {
      const tab = tabs.get(activeWindowId);
      if (tab) {
        for (const pid of tab.paneIds) {
          const pane = panes.get(pid);
          if (pane) pane.fitAddon.fit();
        }
      }
    }
    sendClientSize();
  });
  resizeObserver.observe(terminalContainer);

  // ── Event Handlers (adapter uses EventEmitter .on()) ──

  let _layoutChangeCounter = 0;
  let _layoutCounting = false;

  adapter.on('connected', (windows, connInfo) => {
    clearAll();
    const target = connInfo
      ? `${connInfo.target} [${connInfo.session}]`
      : '';
    const windowCount = new Set(windows.map((w) => w.windowId)).size;
    setStatus(`Connected ${target} - ${windowCount} window(s)`);

    connectBtn.style.display = 'none';
    detachBtn.style.display = '';

    for (const win of windows) {
      const { term } = createTerminalPane(win.paneId, win.windowId, win.name);

      if (win.paneState) {
        const {
          scrollback, screen, alternateOn, cursorX, cursorY,
        } = win.paneState;

        if (alternateOn) {
          const lines = screen.split('\r\n');
          let cmd = '\x1b[?1049h';
          const rowsToWrite = Math.min(lines.length, term.rows);
          for (let i = 0; i < rowsToWrite; i++) {
            cmd += `\x1b[${i + 1};1H${lines[i]}`;
          }
          cmd += `\x1b[${cursorY + 1};${cursorX + 1}H`;
          cmd += buildModeRestoreSequence(win.paneState);
          term.write(cmd);
        } else {
          const screenLines = screen.split('\r\n');
          while (screenLines.length > cursorY + 1 && screenLines[screenLines.length - 1].trim() === '') {
            screenLines.pop();
          }

          let data = '';
          if (scrollback) {
            data += scrollback + '\r\n';
          }
          data += screenLines.join('\r\n');
          term.write(data);

          const scrollbackLineCount = scrollback ? scrollback.split('\r\n').length : 0;
          const totalLines = scrollbackLineCount + screenLines.length;
          const paneRows = win.paneState.paneHeight || term.rows;
          const baseY = Math.max(0, totalLines - paneRows);
          const cursorViewportY = (scrollbackLineCount + cursorY) - baseY;
          term.write(`\x1b[${cursorViewportY + 1};${cursorX + 1}H`);

          term.write(buildModeRestoreSequence(win.paneState));
        }

        if (win.pendingOutput) {
          term.write(win.pendingOutput);
        }

        continue;
      }
    }

    if (windows.length > 0) {
      activateTab(windows[0].windowId);
    }

    setTimeout(() => sendClientSize(), 50);
  });

  adapter.on('output', (paneId, data) => {
    const pane = panes.get(paneId);
    if (pane) {
      pane.term.write(data);
    } else {
      if (!_pendingOutputBuffer.has(paneId)) {
        _pendingOutputBuffer.set(paneId, []);
      }
      _pendingOutputBuffer.get(paneId).push(data);
    }
  });

  adapter.on('window-add', (win) => {
    if (win && win.paneId && !panes.has(win.paneId)) {
      createTerminalPane(win.paneId, win.windowId, win.name);
      activateTab(win.windowId);
      setStatus(`${tabs.size} window(s)`);
    }
  });

  adapter.on('window-close', (windowId) => {
    removeWindow(windowId);
    const remaining = tabs.size;
    setStatus(`Window closed - ${remaining} window(s) remaining`);
  });

  adapter.on('layout-change', (windowId, paneList) => {
    if (_layoutCounting) _layoutChangeCounter++;
    const tab = tabs.get(windowId);
    if (!tab) return;

    for (const pl of paneList) {
      if (!panes.has(pl.paneId)) {
        createTerminalPane(pl.paneId, windowId, tab.name);
      }
    }

    const paneIdsInLayout = new Set(paneList.map((pl) => pl.paneId));
    for (const pid of [...tab.paneIds]) {
      if (!paneIdsInLayout.has(pid)) {
        removePane(pid);
      }
    }

    const activePl = paneList.find((pl) => pl.active);
    if (activePl) {
      tab.activePaneId = activePl.paneId;
      const activePane = panes.get(activePl.paneId);
      if (activePane && windowId === activeWindowId) {
        activePane.term.focus();
      }
    }

    tab.paneLayout = paneList;
    applyPaneLayout(windowId, paneList);
    setTimeout(() => sendClientSize(), 20);
  });

  adapter.on('window-pane-changed', (windowId, paneId) => {
    const tab = tabs.get(windowId);
    if (tab) {
      if (tab.paneIds.length > 1) {
        for (const pid of tab.paneIds) {
          const p = panes.get(pid);
          if (p) {
            if (pid === paneId) {
              p.wrapper.classList.add('active-pane');
            } else {
              p.wrapper.classList.remove('active-pane');
            }
          }
        }
      }
      tab.activePaneId = paneId;
      const pane = panes.get(paneId);
      if (pane) pane.term.focus();
    }
  });

  adapter.on('disconnected', (reason) => {
    setStatus(`Disconnected: ${reason}`);
    connectBtn.style.display = '';
    detachBtn.style.display = 'none';
  });

  // ── Button handlers ──

  newTabBtn.addEventListener('click', () => {
    adapter.newWindow();
  });

  detachBtn.addEventListener('click', () => {
    adapter.detach();
  });

  connectBtn.addEventListener('click', () => {
    setStatus('Connecting...');
    adapter.connect();
  });

  // ── Return control interface ──

  const api = {
    destroy() {
      resizeObserver.disconnect();
      clearAll();
      container.innerHTML = '';
    },
    newWindow() {
      adapter.newWindow();
    },

    // Test helpers (exposed for Playwright)
    _getActiveTerminalBuffer() {
      if (!activeWindowId) return '';
      const tab = tabs.get(activeWindowId);
      if (!tab) return '';
      const pane = panes.get(tab.activePaneId);
      if (!pane) return '';
      const buffer = pane.term.buffer.active;
      const lines = [];
      for (let i = 0; i <= buffer.baseY + buffer.cursorY; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      return lines.join('\n');
    },
    _getTabCount() { return tabs.size; },
    _getActiveWindowId() { return activeWindowId; },
    _getPaneIds() { return Array.from(panes.keys()); },
    _getActivePaneId() {
      if (!activeWindowId) return null;
      const tab = tabs.get(activeWindowId);
      return tab ? tab.activePaneId : null;
    },
    _getPaneCountForWindow(windowId) {
      const wid = windowId || activeWindowId;
      const tab = tabs.get(wid);
      return tab ? tab.paneIds.length : 0;
    },
    _getPaneIdsForWindow(windowId) {
      const wid = windowId || activeWindowId;
      const tab = tabs.get(wid);
      return tab ? [...tab.paneIds] : [];
    },
    _getCursorPosition() {
      if (!activeWindowId) return null;
      const tab = tabs.get(activeWindowId);
      if (!tab) return null;
      const pane = panes.get(tab.activePaneId);
      if (!pane) return null;
      const buffer = pane.term.buffer.active;
      return { x: buffer.cursorX, y: buffer.cursorY };
    },
    _getCursorPositionForPane(paneId) {
      const pane = panes.get(paneId);
      if (!pane) return null;
      const buffer = pane.term.buffer.active;
      return { x: buffer.cursorX, y: buffer.cursorY };
    },
    _isCursorVisible() {
      if (!activeWindowId) return null;
      const tab = tabs.get(activeWindowId);
      if (!tab) return null;
      const pane = panes.get(tab.activePaneId);
      if (!pane) return null;
      const core = pane.term._core;
      if (core) {
        if (core._coreService && core._coreService.decPrivateModes) {
          const modes = core._coreService.decPrivateModes;
          if ('cursorHidden' in modes) return !modes.cursorHidden;
        }
        if (core._inputHandler && '_cursorHidden' in core._inputHandler) {
          return !core._inputHandler._cursorHidden;
        }
      }
      const rows = pane.wrapper.querySelectorAll('.xterm-cursor-layer canvas, .xterm-cursor-block');
      for (const el of rows) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
      }
      return null;
    },
    _getBufferRows() {
      if (!activeWindowId) return [];
      const tab = tabs.get(activeWindowId);
      if (!tab) return [];
      const pane = panes.get(tab.activePaneId);
      if (!pane) return [];
      const buffer = pane.term.buffer.active;
      const rows = [];
      for (let i = 0; i <= buffer.baseY + buffer.cursorY; i++) {
        const line = buffer.getLine(i);
        if (line) rows.push(line.translateToString(true));
      }
      return rows;
    },
    _getTerminalBufferForPane(paneId) {
      const pane = panes.get(paneId);
      if (!pane) return '';
      const buffer = pane.term.buffer.active;
      const lines = [];
      for (let i = 0; i <= buffer.baseY + buffer.cursorY; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      return lines.join('\n');
    },
    _getBufferRowsForPane(paneId) {
      const pane = panes.get(paneId);
      if (!pane) return [];
      const buffer = pane.term.buffer.active;
      const rows = [];
      const totalRows = buffer.baseY + pane.term.rows;
      for (let i = 0; i < totalRows; i++) {
        const line = buffer.getLine(i);
        rows.push(line ? line.translateToString(true) : '');
      }
      return rows;
    },
    _getTerminalRowsForPane(paneId) {
      const pane = panes.get(paneId);
      return pane ? pane.term.rows : 0;
    },
    _getTerminalColsForPane(paneId) {
      const pane = panes.get(paneId);
      return pane ? pane.term.cols : 0;
    },
    _startLayoutCounter() {
      _layoutChangeCounter = 0;
      _layoutCounting = true;
    },
    _getLayoutChangeCount() {
      _layoutCounting = false;
      return _layoutChangeCounter;
    },
    _getLastClientSize() {
      return { cols: _lastClientCols, rows: _lastClientRows };
    },
  };

  return api;
}

// ── Standalone mode: when loaded as a script in the POC's index.html ──
// The preload.js exposes window.tmux with onXxx/sendKeys/etc.
// We create an EventEmitter-like adapter from it.
if (typeof window !== 'undefined' && window.tmux) {
  const tmux = window.tmux;

  // Build an adapter that bridges window.tmux (IPC) to EventEmitter-style API
  const ipcAdapter = {
    _listeners: {},
    on(event, callback) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
    },
    emit(event, ...args) {
      const cbs = this._listeners[event] || [];
      for (const cb of cbs) cb(...args);
    },
    // Command methods
    sendKeys: (paneId, data) => tmux.sendKeys(paneId, data),
    resize: (cols, rows) => tmux.resize(cols, rows),
    newWindow: () => tmux.newWindow(),
    closeWindow: (windowId) => tmux.closeWindow(windowId),
    splitPane: (paneId, direction) => tmux.splitPane(paneId, direction),
    selectPane: (paneId) => tmux.selectPane(paneId),
    killPane: (paneId) => tmux.killPane(paneId),
    detach: () => tmux.detach(),
    connect: () => tmux.connect(),
  };

  // Wire IPC events to adapter
  tmux.onConnected((windows, connInfo) => ipcAdapter.emit('connected', windows, connInfo));
  tmux.onOutput((paneId, data) => ipcAdapter.emit('output', paneId, data));
  tmux.onWindowAdd((win) => ipcAdapter.emit('window-add', win));
  tmux.onWindowClose((windowId) => ipcAdapter.emit('window-close', windowId));
  tmux.onLayoutChange((windowId, paneList) => ipcAdapter.emit('layout-change', windowId, paneList));
  tmux.onWindowPaneChanged((windowId, paneId) => ipcAdapter.emit('window-pane-changed', windowId, paneId));
  tmux.onDisconnected((reason) => ipcAdapter.emit('disconnected', reason));

  // The standalone index.html has a container with specific structure.
  // We create the tmux terminal inside the body (clearing existing content).
  const container = document.getElementById('terminal-container');
  // In standalone mode, we need to clear the existing HTML structure and
  // use the body as our container since createTmuxTerminal builds its own DOM.
  const standaloneContainer = document.createElement('div');
  standaloneContainer.style.cssText = 'display:flex;flex-direction:column;height:100%;width:100%';
  document.body.innerHTML = '';
  document.body.appendChild(standaloneContainer);

  const api = createTmuxTerminal(standaloneContainer, ipcAdapter);

  // Expose test helpers on window for Playwright
  window._getActiveTerminalBuffer = () => api._getActiveTerminalBuffer();
  window._getTabCount = () => api._getTabCount();
  window._getActiveWindowId = () => api._getActiveWindowId();
  window._getPaneIds = () => api._getPaneIds();
  window._getActivePaneId = () => api._getActivePaneId();
  window._getPaneCountForWindow = (wid) => api._getPaneCountForWindow(wid);
  window._getPaneIdsForWindow = (wid) => api._getPaneIdsForWindow(wid);
  window._getCursorPosition = () => api._getCursorPosition();
  window._getCursorPositionForPane = (pid) => api._getCursorPositionForPane(pid);
  window._isCursorVisible = () => api._isCursorVisible();
  window._getBufferRows = () => api._getBufferRows();
  window._getTerminalBufferForPane = (pid) => api._getTerminalBufferForPane(pid);
  window._getBufferRowsForPane = (pid) => api._getBufferRowsForPane(pid);
  window._getTerminalRowsForPane = (pid) => api._getTerminalRowsForPane(pid);
  window._getTerminalColsForPane = (pid) => api._getTerminalColsForPane(pid);
  window._startLayoutCounter = () => api._startLayoutCounter();
  window._getLayoutChangeCount = () => api._getLayoutChangeCount();
  window._getLastClientSize = () => api._getLastClientSize();
}

// Export for CommonJS (used by thopter-swarm React integration)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTmuxTerminal };
}
