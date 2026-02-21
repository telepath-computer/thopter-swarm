'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { TmuxCCParser } = require('./tmux-cc-parser');
const { hexEncode } = require('./octal-decode');

const DEFAULT_SESSION_NAME = process.env.TMUX_SESSION || 'electron-tmux';

/**
 * Build the ssh command args from environment variables.
 *
 * If SSH_TARGET is set, use it as the ssh destination (respects ~/.ssh/config).
 * Otherwise, construct from SSH_HOST/SSH_PORT/SSH_USER/SSH_KEY.
 */
function buildSSHArgs() {
  const target = process.env.SSH_TARGET;
  if (target) {
    // Let the system ssh client resolve everything from ~/.ssh/config
    return ['-tt', target];
  }

  // Explicit connection details (fallback for environments without ssh config)
  const host = process.env.SSH_HOST || '127.0.0.1';
  const port = process.env.SSH_PORT || '22';
  const user = process.env.SSH_USER || os.userInfo().username;
  const key = process.env.SSH_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519');

  const args = ['-tt'];
  args.push('-p', port);
  args.push('-i', key);
  args.push('-o', 'StrictHostKeyChecking=accept-new');
  args.push('-l', user);
  args.push(host);
  return args;
}

function getTargetLabel() {
  if (process.env.SSH_TARGET) return process.env.SSH_TARGET;
  const host = process.env.SSH_HOST || '127.0.0.1';
  const port = process.env.SSH_PORT || '22';
  const user = process.env.SSH_USER || os.userInfo().username;
  return `${user}@${host}:${port}`;
}

/**
 * Manages an SSH connection running tmux in CC mode.
 *
 * Uses the system ssh client, so ~/.ssh/config, ssh-agent, ProxyJump,
 * FIDO keys, Kerberos, etc. all work automatically.
 *
 * Configure via environment variables:
 *   SSH_TARGET   - ssh destination (hostname or alias from ~/.ssh/config)
 *                  If set, SSH_HOST/PORT/USER/KEY are ignored.
 *   SSH_HOST     - SSH server hostname (default: 127.0.0.1)
 *   SSH_PORT     - SSH server port (default: 22)
 *   SSH_USER     - SSH username (default: current user)
 *   SSH_KEY      - Path to private key file (default: ~/.ssh/id_ed25519)
 *   TMUX_SESSION - tmux session name (default: electron-tmux)
 *
 * Events:
 *   'output'       (paneId, data)
 *   'window-add'   (windowId)
 *   'window-close'  (windowId)
 *   'layout-change' (windowId, layout)
 *   'connected'    (windowList, connInfo)
 *   'disconnected' (reason)
 *   'exit'         (reason)
 */
class SSHSession extends EventEmitter {
  /**
   * @param {Object} [config]
   * @param {string[]} [config.sshArgs] - SSH args (replaces buildSSHArgs())
   * @param {string} [config.sessionName] - tmux session name (replaces TMUX_SESSION env)
   * @param {string} [config.targetLabel] - display label for status messages
   * @param {string} [config.spawnCommand] - spawn command binary (default: 'ssh')
   * @param {boolean} [config.rawArgs] - if true, use sshArgs as-is (don't append tmux cmd)
   */
  constructor(config = {}) {
    super();
    this._config = config;
    this._proc = null;
    this._parser = null;
    this._pendingCommands = [];
    this._connected = false;
  }

  get connected() {
    return this._connected;
  }

  /**
   * Connect via the system ssh client and start tmux CC.
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const sshArgs = this._config.sshArgs || buildSSHArgs();
      const sessionName = this._config.sessionName || DEFAULT_SESSION_NAME;
      const spawnCommand = this._config.spawnCommand || 'ssh';

      let args;
      if (this._config.rawArgs) {
        // rawArgs mode: use sshArgs exactly as provided (caller already included tmux cmd)
        args = [...sshArgs];
      } else {
        const tmuxCmd = `tmux -CC new-session -A -s ${sessionName} -x 120 -y 36`;
        args = [...sshArgs, tmuxCmd];
      }

      const proc = spawn(spawnCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this._proc = proc;

      this._parser = new TmuxCCParser();

      // Forward parser events
      this._parser.on('output', (paneId, data) => {
        this.emit('output', paneId, data);
      });

      this._parser.on('window-add', (windowId) => {
        this.emit('window-add', windowId);
      });

      this._parser.on('window-close', (windowId) => {
        this.emit('window-close', windowId);
      });

      this._parser.on('layout-change', (windowId, layout) => {
        this.emit('layout-change', windowId, layout);
      });

      this._parser.on('window-pane-changed', (windowId, paneId) => {
        this.emit('window-pane-changed', windowId, paneId);
      });

      this._parser.on('block', (cmdNumber, lines) => {
        this._resolveCommand(lines, false);
      });

      this._parser.on('block-error', (cmdNumber, lines) => {
        this._resolveCommand(lines, true);
      });

      this._parser.on('exit', (reason) => {
        this._connected = false;
        this.emit('exit', reason);
        this.emit('disconnected', reason || 'tmux exited');
      });

      proc.stdout.on('data', (data) => {
        this._parser.feed(data.toString());
      });

      proc.stderr.on('data', (data) => {
        // SSH warnings/errors (host key notices, etc.)
        // Don't treat as fatal — only the process exit matters
        console.error('[ssh stderr]', data.toString().trim());
      });

      let exited = false;
      proc.on('error', (err) => {
        exited = true;
        this._connected = false;
        this.emit('disconnected', err.message);
        reject(err);
      });

      proc.on('close', (code) => {
        if (exited) return;
        exited = true;
        this._connected = false;
        this.emit('disconnected', `ssh exited (code ${code})`);
      });

      this._connected = true;

      // Wait briefly for tmux to send initial notifications, then
      // list windows to get the initial state
      setTimeout(async () => {
        if (!this._connected) {
          reject(new Error('SSH connection failed'));
          return;
        }
        try {
          const windows = await this.listWindows();
          this.emit('connected', windows, {
            target: this._config.targetLabel || getTargetLabel(),
            session: sessionName,
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      }, 500);
    });
  }

  /**
   * Send a tmux command and wait for the response block.
   * @returns {Promise<string[]>} Response lines
   */
  sendCommand(cmd) {
    return new Promise((resolve, reject) => {
      if (!this._proc || !this._connected) {
        return reject(new Error('Not connected'));
      }
      this._pendingCommands.push({ resolve, reject });
      this._proc.stdin.write(cmd + '\n');
    });
  }

  _resolveCommand(lines, isError) {
    const pending = this._pendingCommands.shift();
    if (!pending) return;
    if (isError) {
      pending.reject(new Error(lines.join('\n')));
    } else {
      pending.resolve(lines);
    }
  }

  /**
   * List tmux windows with their pane IDs.
   * @returns {Promise<Array<{windowId: string, paneId: string, name: string}>>}
   */
  async listWindows() {
    const lines = await this.sendCommand(
      `list-windows -F '#{window_id} #{pane_id} #{window_name}'`
    );
    return lines
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(' ');
        return {
          windowId: parts[0],
          paneId: parts[1],
          name: parts.slice(2).join(' ') || 'shell',
        };
      });
  }

  /**
   * Send keystrokes to a pane using hex encoding.
   */
  async sendKeys(paneId, data) {
    const hex = hexEncode(data);
    return this.sendCommand(`send-keys -H -t ${paneId} ${hex}`);
  }

  /**
   * Resize the tmux client.
   */
  async resize(cols, rows) {
    return this.sendCommand(`refresh-client -C ${cols},${rows}`);
  }

  /**
   * Create a new tmux window.
   */
  async newWindow() {
    return this.sendCommand('new-window');
  }

  /**
   * Kill a tmux window.
   */
  async killWindow(windowId) {
    return this.sendCommand(`kill-window -t ${windowId}`);
  }

  /**
   * Capture pane scrollback (with ANSI escapes preserved).
   * @param {string} paneId
   * @param {number} [lines=500] Number of scrollback lines
   * @returns {Promise<string>} Captured content
   */
  async capturePaneScrollback(paneId, lines = 500) {
    const result = await this.sendCommand(
      `capture-pane -pe -t ${paneId} -S -${lines}`
    );
    // Join with \r\n: CR returns cursor to column 0, LF moves to next row.
    // Without CR, xterm.js would staircase the output.
    // Using -pe (without -J) preserves original line wrapping.
    return result.join('\r\n');
  }

  /**
   * Capture full pane state including alternate screen, cursor position,
   * and terminal modes (cursor visibility, scroll region, keypad, mouse,
   * wrap, insert).
   *
   * @param {string} paneId
   * @param {number} [scrollbackLines=2000]
   * @returns {Promise<Object>} Pane state for renderer restoration
   */
  async capturePaneState(paneId, scrollbackLines = 2000) {
    // Query pane metadata: alternate screen flag, cursor position, terminal modes
    const meta = await this.sendCommand(
      `display-message -p -t ${paneId} '#{alternate_on} #{cursor_x} #{cursor_y} #{cursor_flag} #{scroll_region_upper} #{scroll_region_lower} #{keypad_cursor_flag} #{keypad_flag} #{mouse_any_flag} #{mouse_button_flag} #{mouse_standard_flag} #{mouse_sgr_flag} #{wrap_flag} #{insert_flag} #{pane_height}'`
    );
    const parts = meta[0].trim().split(' ');
    const alternateOn = parts[0] === '1';
    const cursorX = parseInt(parts[1], 10);
    const cursorY = parseInt(parts[2], 10);
    const cursorVisible = parts[3] !== '0';
    const scrollRegionUpper = parseInt(parts[4], 10);
    const scrollRegionLower = parseInt(parts[5], 10);
    const keypadCursorFlag = parts[6] === '1';
    const keypadFlag = parts[7] === '1';
    const mouseAnyFlag = parts[8] === '1';
    const mouseButtonFlag = parts[9] === '1';
    const mouseStandardFlag = parts[10] === '1';
    const mouseSgrFlag = parts[11] === '1';
    const wrapFlag = parts[12] !== '0';
    const insertFlag = parts[13] === '1';
    const paneHeight = parseInt(parts[14], 10);

    let scrollback = '';
    let screen = '';

    if (alternateOn) {
      // In alternate screen (vim, less, etc.): capture only the visible screen.
      // No scrollback in alternate mode.
      const screenLines = await this.sendCommand(
        `capture-pane -pe -t ${paneId}`
      );
      screen = screenLines.join('\r\n');
    } else {
      // Normal mode: capture scrollback (above visible area) + visible screen separately.
      // In tmux, line 0 is the first visible line; line -1 is the most recent
      // scrollback line (just above the visible area).  So -S -N -E -1
      // captures the last N lines of scrollback without overlapping the
      // visible screen (which is captured separately below).
      if (scrollbackLines > 0) {
        try {
          const sbLines = await this.sendCommand(
            `capture-pane -pe -t ${paneId} -S -${scrollbackLines} -E -1`
          );
          scrollback = sbLines.join('\r\n');
        } catch (_e) {
          // No scrollback available (e.g. fresh pane)
        }
      }

      // Visible screen
      const screenLines = await this.sendCommand(
        `capture-pane -pe -t ${paneId}`
      );
      screen = screenLines.join('\r\n');
    }

    return {
      scrollback, screen, alternateOn, cursorX, cursorY,
      cursorVisible, scrollRegionUpper, scrollRegionLower,
      keypadCursorFlag, keypadFlag,
      mouseAnyFlag, mouseButtonFlag, mouseStandardFlag, mouseSgrFlag,
      wrapFlag, insertFlag, paneHeight,
    };
  }

  /**
   * Capture any pending output that arrived between our snapshot and now.
   * Uses capture-pane -p -P -C to get pending output from the pane.
   *
   * @param {string} paneId
   * @returns {Promise<string>} Pending output data
   */
  async capturePendingOutput(paneId) {
    try {
      const lines = await this.sendCommand(
        `capture-pane -p -P -C -t ${paneId}`
      );
      return lines.join('\r\n');
    } catch (_e) {
      // No pending output or flag not supported
      return '';
    }
  }

  /**
   * List panes in a window with their geometry.
   * @param {string} windowId
   * @returns {Promise<Array<{paneId: string, active: boolean, left: number, top: number, width: number, height: number}>>}
   */
  async listPanes(windowId) {
    const lines = await this.sendCommand(
      `list-panes -t ${windowId} -F '#{pane_id} #{pane_active} #{pane_left} #{pane_top} #{pane_width} #{pane_height}'`
    );
    return lines
      .filter((l) => l.trim())
      .map((line) => {
        const p = line.trim().split(' ');
        return {
          paneId: p[0],
          active: p[1] === '1',
          left: parseInt(p[2], 10),
          top: parseInt(p[3], 10),
          width: parseInt(p[4], 10),
          height: parseInt(p[5], 10),
        };
      });
  }

  /**
   * Split a window pane.
   * @param {string} paneId Target pane to split
   * @param {'h'|'v'} direction 'h' for horizontal, 'v' for vertical
   */
  async splitWindow(paneId, direction = 'v') {
    const flag = direction === 'h' ? '-h' : '-v';
    return this.sendCommand(`split-window ${flag} -t ${paneId}`);
  }

  /**
   * Select (focus) a pane.
   * @param {string} paneId
   */
  async selectPane(paneId) {
    return this.sendCommand(`select-pane -t ${paneId}`);
  }

  /**
   * Kill (close) a pane.
   * @param {string} paneId
   */
  async killPane(paneId) {
    return this.sendCommand(`kill-pane -t ${paneId}`);
  }

  /**
   * Detach from tmux CC by sending an empty line.
   */
  detach() {
    if (this._proc && this._proc.stdin.writable) {
      this._proc.stdin.write('\n');
    }
  }

  /**
   * Close the SSH connection entirely.
   * Sends a tmux detach first so the remote tmux client process exits
   * cleanly instead of becoming an orphan.
   *
   * @param {Object} [opts]
   * @param {number} [opts.timeout=500] Max ms to wait for clean exit after detach
   * @returns {Promise<void>}
   */
  async destroy({ timeout = 500 } = {}) {
    if (this._proc) {
      const proc = this._proc;
      this._proc = null;

      // Detach from tmux CC (empty line) so the remote client exits cleanly.
      if (proc.stdin.writable) {
        proc.stdin.write('\n');
      }
      proc.stdin.end();

      // Wait for the process to exit on its own (the detach should cause
      // tmux to close the connection, which closes SSH).  If it doesn't
      // exit in time, kill it.
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          proc.kill();
          resolve();
        }, timeout);
        proc.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this._connected = false;
    this._pendingCommands.forEach((p) =>
      p.reject(new Error('Session destroyed'))
    );
    this._pendingCommands = [];
  }
}

module.exports = { SSHSession, DEFAULT_SESSION_NAME };
