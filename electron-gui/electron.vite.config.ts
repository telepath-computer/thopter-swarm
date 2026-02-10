import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { builtinModules } from 'module'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [react(), tailwindcss()],
    define: {
      // Electron merged context has real process.env — don't replace it
      'process.env': 'process.env',
    },
    build: {
      rollupOptions: {
        external: [
          'electron',
          'ioredis',
          ...builtinModules,
          ...builtinModules.map((m) => `node:${m}`),
        ]
      }
    }
  }
})
