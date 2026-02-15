'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { TmuxAdapter } = require('./lib/tmux-adapter');

let mainWindow = null;
let adapter = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIPC() {
  ipcMain.handle('tmux:send-keys', async (_event, paneId, data) => {
    if (adapter && adapter.connected) {
      try {
        await adapter.sendKeys(paneId, data);
      } catch (e) {
        console.error('send-keys error:', e.message);
      }
    }
  });

  ipcMain.handle('tmux:resize', async (_event, cols, rows) => {
    if (adapter && adapter.connected) {
      try {
        await adapter.resize(cols, rows);
      } catch (e) {
        console.error('resize error:', e.message);
      }
    }
  });

  ipcMain.handle('tmux:new-window', async () => {
    if (adapter && adapter.connected) {
      try {
        await adapter.newWindow();
      } catch (e) {
        console.error('new-window error:', e.message);
      }
    }
  });

  ipcMain.handle('tmux:close-window', async (_event, windowId) => {
    if (adapter && adapter.connected) {
      try {
        await adapter.closeWindow(windowId);
      } catch (e) {
        console.error('kill-window error:', e.message);
      }
    }
  });

  ipcMain.handle('tmux:detach', async () => {
    if (adapter) {
      adapter.detach();
    }
  });

  ipcMain.handle('tmux:connect', async () => {
    await connectToTmux();
  });

  ipcMain.handle('tmux:split-pane', async (_event, paneId, direction) => {
    if (adapter && adapter.connected) {
      try {
        await adapter.splitPane(paneId, direction);
      } catch (e) {
        console.error('split-pane error:', e.message);
      }
    }
  });

  ipcMain.handle('tmux:select-pane', async (_event, paneId) => {
    if (adapter && adapter.connected) {
      try {
        await adapter.selectPane(paneId);
      } catch (e) {
        console.error('select-pane error:', e.message);
      }
    }
  });

  ipcMain.handle('tmux:kill-pane', async (_event, paneId) => {
    if (adapter && adapter.connected) {
      try {
        await adapter.killPane(paneId);
      } catch (e) {
        console.error('kill-pane error:', e.message);
      }
    }
  });
}

async function connectToTmux() {
  if (adapter) {
    await adapter.destroy();
  }

  adapter = new TmuxAdapter();

  // Forward all adapter events to renderer via IPC
  adapter.on('output', (paneId, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:output', paneId, data);
    }
  });

  adapter.on('window-add', (win) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:window-add', win);
    }
  });

  adapter.on('window-close', (windowId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:window-close', windowId);
    }
  });

  adapter.on('window-pane-changed', (windowId, paneId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:window-pane-changed', windowId, paneId);
    }
  });

  adapter.on('layout-change', (windowId, paneList) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:layout-change', windowId, paneList);
    }
  });

  adapter.on('connected', (allPanes, connInfo) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:connected', allPanes, connInfo);
    }
  });

  adapter.on('disconnected', (reason) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:disconnected', reason);
    }
  });

  try {
    await adapter.connect();
  } catch (err) {
    console.error('SSH connect error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tmux:disconnected', err.message);
    }
  }
}

app.whenReady().then(() => {
  setupIPC();
  createWindow();

  // Auto-connect once the renderer is ready
  mainWindow.webContents.on('did-finish-load', () => {
    connectToTmux();
  });
});

app.on('window-all-closed', async () => {
  if (adapter) {
    await adapter.destroy();
  }
  app.quit();
});
