import { contextBridge } from 'electron'
import type { BaselineApi } from './api.d.ts'

/** The safe API the UI can call. Save/load and other main-process features get added here. */
const api: BaselineApi = {
  platform: process.platform,
}

contextBridge.exposeInMainWorld('baseline', api)
