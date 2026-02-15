'use strict';

const { EventEmitter } = require('events');
const { octalDecode } = require('./octal-decode');

/**
 * State machine parser for the tmux Control Center protocol.
 *
 * Events emitted:
 *   'output'         (paneId, data)    - decoded pane output
 *   'window-add'     (windowId)        - new window created
 *   'window-close'   (windowId)        - window closed
 *   'layout-change'  (windowId, layout)- layout changed
 *   'window-pane-changed' (windowId, paneId) - active pane changed
 *   'session-changed'(sessionId, name) - session changed
 *   'block'          (cmdNumber, lines) - command response block
 *   'block-error'    (cmdNumber, lines) - command error block
 *   'exit'           (reason)          - CC session ended
 */
class TmuxCCParser extends EventEmitter {
  constructor() {
    super();
    this._buffer = '';
    this._blockLines = [];
    this._blockCmdNumber = null;
    this._inBlock = false;
  }

  /**
   * Feed raw data from the tmux CC stream.
   * Handles chunked data by line-buffering.
   */
  feed(data) {
    this._buffer += data;

    let newlineIdx;
    while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
      let line = this._buffer.substring(0, newlineIdx);
      this._buffer = this._buffer.substring(newlineIdx + 1);
      // Strip trailing \r from PTY output
      if (line.endsWith('\r')) {
        line = line.substring(0, line.length - 1);
      }
      this._parseLine(line);
    }
  }

  _parseLine(line) {
    // Inside a command response block: collect lines until %end or %error
    if (this._inBlock) {
      if (line.startsWith('%end ') || line.startsWith('%error ')) {
        const isError = line.startsWith('%error ');
        const event = isError ? 'block-error' : 'block';
        this.emit(event, this._blockCmdNumber, this._blockLines);
        this._inBlock = false;
        this._blockLines = [];
        this._blockCmdNumber = null;
        return;
      }
      this._blockLines.push(line);
      return;
    }

    // %begin <time> <cmdNumber> <flags>
    if (line.startsWith('%begin ')) {
      const parts = line.split(' ');
      this._blockCmdNumber = parts[2] || null;
      this._inBlock = true;
      this._blockLines = [];
      return;
    }

    // %output %<paneId> <octal-encoded-data>
    if (line.startsWith('%output ')) {
      const spaceIdx = line.indexOf(' ', 8); // after "%output "
      if (spaceIdx === -1) return;
      const paneId = line.substring(8, spaceIdx);
      const encodedData = line.substring(spaceIdx + 1);
      const decoded = octalDecode(encodedData);
      this.emit('output', paneId, decoded);
      return;
    }

    // %window-add @<windowId>
    if (line.startsWith('%window-add ')) {
      const windowId = line.substring(12).trim();
      this.emit('window-add', windowId);
      return;
    }

    // %window-close @<windowId> or %unlinked-window-close @<windowId>
    if (line.startsWith('%window-close ') || line.startsWith('%unlinked-window-close ')) {
      const lastSpaceIdx = line.lastIndexOf(' ');
      const windowId = line.substring(lastSpaceIdx + 1).trim();
      this.emit('window-close', windowId);
      return;
    }

    // %layout-change @<windowId> <layout>
    if (line.startsWith('%layout-change ')) {
      const rest = line.substring(15);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return;
      const windowId = rest.substring(0, spaceIdx);
      const layout = rest.substring(spaceIdx + 1);
      this.emit('layout-change', windowId, layout);
      return;
    }

    // %window-pane-changed @<windowId> %<paneId>
    if (line.startsWith('%window-pane-changed ')) {
      const rest = line.substring(21);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return;
      const windowId = rest.substring(0, spaceIdx);
      const paneId = rest.substring(spaceIdx + 1).trim();
      this.emit('window-pane-changed', windowId, paneId);
      return;
    }

    // %session-changed $<sessionId> <sessionName>
    if (line.startsWith('%session-changed ')) {
      const rest = line.substring(17);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return;
      const sessionId = rest.substring(0, spaceIdx);
      const name = rest.substring(spaceIdx + 1);
      this.emit('session-changed', sessionId, name);
      return;
    }

    // %exit [reason]
    if (line.startsWith('%exit')) {
      const reason = line.length > 6 ? line.substring(6).trim() : '';
      this.emit('exit', reason);
      return;
    }

    // %sessions-changed - ignored for POC
    // Other unrecognized lines - ignored
  }
}

module.exports = { TmuxCCParser };
