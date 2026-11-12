import type { BaselineApi } from './api.d.ts'

declare global {
  interface Window {
    baseline: BaselineApi
  }
}
