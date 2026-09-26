import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = import.meta.dirname
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
// What the package declares at runtime stays an import for the app's bundler to resolve (one React,
// one router, one QueryClient); build-time packages such as Radix, marked and the fonts are bundled.
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]

/**
 * `foss-design/viewer`: the viewer as a library in dist/viewer-lib, as index.js, styles.css and the
 * font files it links. Not Vite's library mode: that inlines every font into the stylesheet.
 */
export default defineConfig({
  root: here,
  // Font URLs relative to styles.css.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': path.resolve(here, '../src/shared') },
  },
  build: {
    outDir: path.resolve(here, '../dist/viewer-lib'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    minify: false,
    copyPublicDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: path.resolve(here, 'src/library.ts'),
      preserveEntrySignatures: 'strict',
      external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css')) ? 'styles.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
