'use strict';

const { EventEmitter } = require('events');
const { SSHSession } = require('./ssh-session');

/**
 * High-level adapter around SSHSession that enriches raw tmux CC events
 * with pane geometry and state data.
 *
 * This encapsulates the orchestration logic that was originally in main.js:
 * - On `connected`: queries listPanes() for every pane
 * - On `layout-change`: queries listPanes() to get geometry data
 * - On `window-add`: queries listWindows() to get the pane ID
 *
 * Events emitted match the shape the renderer expects:
 *   'connected'            (allPanes[], connInfo, bootstrapByPane)
 *   'output'               (paneId, data)
 *   'window-add'           ({ windowId, paneId, name })
 *   'window-close'         (windowId)
 *   'layout-change'        (windowId, paneList[])
 *   'window-pane-changed'  (windowId, paneId)
 *   'disconnected'         (reason)
 *
 * @param {Object} [config]
 * @param {string[]} [config.sshArgs] - SSH args passed to SSHSession
 * @param {string} [config.sessionName] - tmux session name
 * @param {string} [config.targetLabel] - display label
 */
class TmuxAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this._config = config;
    this._session = null;
  }

  get connected() {
    return this._session ? this._session.connected : false;
  }

  async connect() {
    if (this._session) {
      await this._session.destroy();
    }

    const session = new SSHSession(this._config);
    this._session = session;

    // Pass-through events
    session.on('output', (paneId, data) => {
      this.emit('output', paneId, data);
    });

    session.on('window-close', (windowId) => {
      this.emit('window-close', windowId);
    });

    session.on('window-pane-changed', (windowId, paneId) => {
      this.emit('window-pane-changed', windowId, paneId);
    });

    session.on('disconnected', (reason) => {
      this.emit('disconnected', reason);
    });

    // Enriched events: window-add → look up pane ID
    session.on('window-add', async (windowId) => {
      try {
        const windows = await session.listWindows();
        const win = windows.find((w) => w.windowId === windowId);
        if (win) {
          this.emit('window-add', win);
        }
      } catch (e) {
        console.error('list-windows after window-add error:', e.message);
      }
    });

    // Enriched events: layout-change → query pane geometry
    session.on('layout-change', async (windowId) => {
      if (!session.connected) return;
      try {
        const paneList = await session.listPanes(windowId);
        this.emit('layout-change', windowId, paneList);
      } catch (e) {
        console.error('layout-change list-panes error:', e.message);
      }
    });

    const withTimeout = async (promise, timeoutMs, fallbackValue) => {
      let timer = null;
      try {
        return await Promise.race([
          promise,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    // Enriched events: connected → pane list + best-effort bootstrap state
    session.on('connected', async (windows, connInfo) => {
      const allPanes = [];
      const windowPaneLists = new Map();
      const bootstrapByPane = new Map();

      for (const win of windows) {
        let paneList;
        try {
          paneList = await session.listPanes(win.windowId);
        } catch (e) {
          console.error('listPanes error:', e.message);
          paneList = [{ paneId: win.paneId, active: true }];
        }
        windowPaneLists.set(win.windowId, paneList);

        for (const pl of paneList) {
          allPanes.push({
            windowId: win.windowId,
            paneId: pl.paneId,
            name: win.name,
          });
        }
      }

      await Promise.all(
        allPanes.map(async (pane) => {
          const bootstrap = await withTimeout(
            session.capturePaneBootstrap(pane.paneId, { scrollbackLines: 2000 }),
            1800,
            null
          );
          if (bootstrap) {
            bootstrapByPane.set(pane.paneId, bootstrap);
          }
        })
      );

      this.emit('connected', allPanes, connInfo, Object.fromEntries(bootstrapByPane));

      // Send layout for all windows so renderer gets authoritative pane geometry
      // immediately (including single-pane windows).
      for (const [windowId, paneList] of windowPaneLists) {
        this.emit('layout-change', windowId, paneList);
      }
    });

    try {
      await session.connect();
    } catch (err) {
      this.emit('disconnected', err.message);
      throw err;
    }
  }

  // Command pass-throughs
  async sendKeys(paneId, data) {
    if (this._session && this._session.connected) {
      return this._session.sendKeys(paneId, data);
    }
  }

  async resize(cols, rows) {
    if (this._session && this._session.connected) {
      return this._session.resize(cols, rows);
    }
  }

  async newWindow() {
    if (this._session && this._session.connected) {
      return this._session.newWindow();
    }
  }

  async closeWindow(windowId) {
    if (this._session && this._session.connected) {
      return this._session.killWindow(windowId);
    }
  }

  async splitPane(paneId, direction) {
    if (this._session && this._session.connected) {
      return this._session.splitWindow(paneId, direction);
    }
  }

  async selectPane(paneId) {
    if (this._session && this._session.connected) {
      return this._session.selectPane(paneId);
    }
  }

  async killPane(paneId) {
    if (this._session && this._session.connected) {
      return this._session.killPane(paneId);
    }
  }

  async resizePane(paneId, direction, amount) {
    if (this._session && this._session.connected) {
      return this._session.resizePane(paneId, direction, amount);
    }
  }

  async togglePaneZoom(paneId) {
    if (this._session && this._session.connected) {
      return this._session.togglePaneZoom(paneId);
    }
  }

  async selectPaneDirection(paneId, direction) {
    if (this._session && this._session.connected) {
      return this._session.selectPaneDirection(paneId, direction);
    }
  }

  detach() {
    if (this._session) {
      this._session.detach();
    }
  }

  async destroy() {
    if (this._session) {
      await this._session.destroy();
      this._session = null;
    }
  }
}

module.exports = { TmuxAdapter };
