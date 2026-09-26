import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Alias, InlineConfig } from 'vite'
import type { DesignProject } from '../core/project'
import { toPosix } from '../core/text'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `@design/runtime`, `@system/…` and the aliases from design.json. */
export function aliases(project: DesignProject): Alias[] {
  const { paths } = project
  const list: Alias[] = [
    // A bare import, so the dev server pre-bundles the runtime with React wherever the package is installed.
    { find: /^@design\/runtime$/, replacement: 'foss-design/runtime' },
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

/** What the dev server and the static build share. */
export function baseConfig(project: DesignProject): InlineConfig {
  const { paths } = project
  return {
    configFile: false,
    envDir: false,
    root: paths.design,
    cacheDir: path.join(paths.cache, 'vite'),
    publicDir: false,
    logLevel: 'warn',
    clearScreen: false,
    resolve: {
      alias: aliases(project),
      // One React for screens, the runtime and project components: resolved from `.design`.
      dedupe: ['react', 'react-dom'],
    },
    plugins: [react(), tailwindcss()],
  }
}
