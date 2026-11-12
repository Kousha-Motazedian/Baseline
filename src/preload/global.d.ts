import type { BaselineApi } from './api'

declare global {
  interface Window {
    baseline: BaselineApi
  }
}
