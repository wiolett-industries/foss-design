import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = import.meta.dirname
// The preview server the dev viewer talks to: `DESIGN_API=http://127.0.0.1:4460 pnpm dev:viewer`.
const api = process.env.DESIGN_API ?? 'http://127.0.0.1:4455'

export default defineConfig({
  root: here,
  // Relative asset URLs: the dev server adds <base href="/">, static builds route by hash from the site root.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': path.resolve(here, '../src/shared') },
  },
  server: {
    port: Number(process.env.VIEWER_PORT ?? 5180),
    proxy: {
      '/api': { target: api },
      '/_s': { target: api },
      '/_fs': { target: api, ws: true },
    },
  },
  build: {
    outDir: path.resolve(here, '../dist/viewer'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
})
