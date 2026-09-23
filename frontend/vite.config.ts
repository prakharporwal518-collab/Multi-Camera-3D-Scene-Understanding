/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The three.js chunk (~1.1 MB) is large by nature; it is only loaded with a 3D view.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Separate vendor groups so the 3D and chart libraries (and only they) load lazily.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 30 },
            { name: 'three', test: /node_modules[\\/](three|three-stdlib|@react-three|@monogrid|camera-controls|maath|troika-[^\\/]+)[\\/]/, priority: 20 },
            { name: 'charts', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|es-toolkit|immer|reselect|redux|@reduxjs)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
