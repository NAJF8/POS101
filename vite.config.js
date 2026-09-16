import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: '/POS101/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'src-index.html'),
      },
    },
  },
})
