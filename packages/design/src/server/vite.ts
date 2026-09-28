import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Alias, InlineConfig } from 'vite'
import { type DesignPaths, PKG } from '../core/paths'
import type { DesignProject } from '../core/project'
import { toPosix } from '../core/text'
import { designCodeGuard } from './css-guard'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `@design/runtime`, `@system/…` and the aliases from design.json. */
export function aliases(project: DesignProject): Alias[] {
  const { paths } = project
  const list: Alias[] = [
    // A bare import, so the dev server pre-bundles the runtime with React wherever the package is installed.
    // `foss-design-cli` is this CLI's own copy (links.ts); `foss-design` may be the app's.
    { find: /^@design\/runtime$/, replacement: 'foss-design-cli/runtime' },
    { find: /^@system\//, replacement: `${toPosix(paths.system)}/` },
  ]
  for (const [key, target] of Object.entries(project.config().config.alias ?? {})) {
    const replacement = toPosix(path.resolve(paths.root, target))
    list.push(
      key.endsWith('/')
        ? { find: new RegExp(`^${escapeRegExp(key)}`), replacement: `${replacement.replace(/\/$/, '')}/` }
        : { find: new RegExp(`^${escapeRegExp(key)}(?=/|$)`), replacement },
    )
  }
  return list
}

/**
 * Drop the pre-bundled deps when the runtime or the app package changed since they were built.
 * Vite keys that cache on the project's lockfile and the config only, and both come in through
 * links, so a new foss-design or another design.json `app` would keep the old copies.
 */
export function dropStaleDepCache(paths: DesignPaths, appDir: string | null = null) {
  const dir = path.join(paths.cache, 'vite')
  const stamp = path.join(paths.cache, 'vite-runtime')
  let runtime = ''
  try {
    runtime = createHash('sha256').update(fs.readFileSync(PKG.runtime)).digest('hex')
  } catch {}
  if (appDir) runtime += ` ${appDir}`
  let seen = ''
  try {
    seen = fs.readFileSync(stamp, 'utf8')
  } catch {}
  if (seen === runtime) return
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(paths.cache, { recursive: true })
  fs.writeFileSync(stamp, runtime)
}

/** What the dev server and the static build share. */
export function baseConfig(project: DesignProject): InlineConfig {
  const { paths } = project
  return {
    configFile: false,
    envDir: false,
    root: paths.design,
    cacheDir: path.join(paths.cache, 'vite'),
    // design.json `public`: served under the frames' base, so HTML and CSS paths such as `/logo.png` resolve.
    publicDir: project.publicDir() ?? false,
    logLevel: 'warn',
    clearScreen: false,
    resolve: {
      alias: aliases(project),
      // One React for screens, the runtime and project components: resolved from `.design`.
      dedupe: ['react', 'react-dom'],
    },
    // No PostCSS config is looked up (Vite would search from `.design` upward and load it in Node):
    // screens get Tailwind from the plugin, and the app's own config is for the app's build.
    css: { postcss: {} },
    // Pulled code runs in the browser only: the guard refuses stylesheets that would load code from
    // `.design` in Node (Tailwind's `@plugin` and `@config`), before Tailwind reads them.
    plugins: [react(), designCodeGuard(paths.design), tailwindcss()],
  }
}
