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
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      // Security: the UI gets no direct Node access; it talks to the main process through the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
