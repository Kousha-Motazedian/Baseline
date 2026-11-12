import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

/** Creates the main game window and loads the UI (dev server in development, built files otherwise). */
function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Baseline',
    webPreferences: {
      // The preload is built as CommonJS (index.cjs, see electron.vite.config.ts) because sandboxed
      // preloads cannot load ES modules.
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      // Security: the UI gets no direct Node access; it talks to the main process only through the
      // preload bridge. contextIsolation keeps the preload's scope separate from page scripts,
      // nodeIntegration stays off so page code can't require Node modules, and the sandbox limits the
      // renderer (and preload) to a small Electron API surface so a compromised page can't reach the OS.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    window.loadURL(devServerUrl)
  } else {
    window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createMainWindow()

  // macOS convention: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// macOS convention: apps stay running after all windows close; other platforms quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
