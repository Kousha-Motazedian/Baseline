import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // Emit the preload as CommonJS: sandboxed preloads (sandbox: true in src/main/index.ts) cannot load
  // ES modules, and electron-vite would otherwise emit ESM because package.json has "type": "module".
  preload: { build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: {
    root: resolve('src/renderer'),
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [react()],
  },
})
