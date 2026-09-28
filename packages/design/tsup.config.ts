import fs from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { cli: 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outDir: 'dist',
    clean: false,
    splitting: false,
    sourcemap: false,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // Served to the browser from the package, so it keeps bare imports for the dev server to resolve.
    entry: { 'runtime/index': 'src/runtime/index.tsx' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    splitting: false,
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'modern-screenshot'],
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
    async onSuccess() {
      fs.copyFileSync('src/runtime/base.css', 'dist/runtime/base.css')
    },
  },
  {
    // Inlined by `design page` into the HTML files of a page: one small script, no imports.
    entry: { 'runtime/page': 'src/runtime/page.ts' },
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outDir: 'dist',
    clean: false,
    splitting: false,
    minify: true,
    outExtension: () => ({ js: '.js' }),
  },
])
