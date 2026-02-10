import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { builtinModules } from 'module'

// Node.js modules that should remain as runtime require() calls in the bundle.
// Electron's merged context (nodeIntegration:true) resolves these at runtime.
const nodeExternals = [
  'electron',
  'ioredis',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

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
      // Build as CommonJS so Node.js require() calls work in merged context
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      rollupOptions: {
        external: nodeExternals,
        output: {
          // CommonJS format — Electron renderer with nodeIntegration can use require()
          format: 'cjs',
        },
      },
    },
  }
})
