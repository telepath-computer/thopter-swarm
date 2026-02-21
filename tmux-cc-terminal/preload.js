'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tmux', {
  // Main -> Renderer events
  onOutput: (callback) => {
    ipcRenderer.on('tmux:output', (_event, paneId, data) => {
      callback(paneId, data);
    });
  },
  onWindowAdd: (callback) => {
    ipcRenderer.on('tmux:window-add', (_event, windowId) => {
      callback(windowId);
    });
  },
  onWindowClose: (callback) => {
    ipcRenderer.on('tmux:window-close', (_event, windowId) => {
      callback(windowId);
    });
  },
  onConnected: (callback) => {
    ipcRenderer.on('tmux:connected', (_event, windows, connInfo) => {
      callback(windows, connInfo);
    });
  },
  onDisconnected: (callback) => {
    ipcRenderer.on('tmux:disconnected', (_event, reason) => {
      callback(reason);
    });
  },
  onLayoutChange: (callback) => {
    ipcRenderer.on('tmux:layout-change', (_event, windowId, paneList) => {
      callback(windowId, paneList);
    });
  },
  onWindowPaneChanged: (callback) => {
    ipcRenderer.on('tmux:window-pane-changed', (_event, windowId, paneId) => {
      callback(windowId, paneId);
    });
  },

  // Renderer -> Main invocations
  sendKeys: (paneId, data) => {
    return ipcRenderer.invoke('tmux:send-keys', paneId, data);
  },
  resize: (cols, rows) => {
    return ipcRenderer.invoke('tmux:resize', cols, rows);
  },
  newWindow: () => {
    return ipcRenderer.invoke('tmux:new-window');
  },
  closeWindow: (windowId) => {
    return ipcRenderer.invoke('tmux:close-window', windowId);
  },
  detach: () => {
    return ipcRenderer.invoke('tmux:detach');
  },
  connect: () => {
    return ipcRenderer.invoke('tmux:connect');
  },
  splitPane: (paneId, direction) => {
    return ipcRenderer.invoke('tmux:split-pane', paneId, direction);
  },
  selectPane: (paneId) => {
    return ipcRenderer.invoke('tmux:select-pane', paneId);
  },
  killPane: (paneId) => {
    return ipcRenderer.invoke('tmux:kill-pane', paneId);
  },
});
