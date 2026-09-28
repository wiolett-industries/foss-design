import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Alias, type InlineConfig, loadConfigFromFile, type Plugin, type PluginOption } from 'vite'
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
 * Files a package install rewrites: lockfiles, and the markers package managers leave in
 * `node_modules` (which Vite itself looks for, from `.design` up, finding only the nearest).
 */
const INSTALL_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.pnp.cjs',
  'node_modules/.pnpm/lock.yaml',
  'node_modules/.modules.yaml',
  'node_modules/.package-lock.json',
  'node_modules/.yarn-state.yml',
  'node_modules/.yarn-integrity',
]

/**
 * The app's installed packages as of now, cheaply: size and time of every install file from the
 * project (and design.json `app`) up to the file system root. It changes with every install.
 */
export function installStamp(paths: DesignPaths, appDir: string | null): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const start of appDir ? [paths.root, appDir] : [paths.root]) {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      for (const name of INSTALL_FILES) {
        const file = path.join(dir, name)
        if (seen.has(file)) continue
        seen.add(file)
        try {
          const stat = fs.statSync(file)
          parts.push(`${file}:${stat.size}:${stat.mtimeMs}`)
        } catch {}
      }
      if (path.dirname(dir) === dir) break
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

/**
 * Drop the pre-bundled deps when the runtime, the app package or the app's installed packages
 * changed since they were built. Vite keys that cache on the nearest install marker and the config
 * only, while the runtime and the app come in through links: a new foss-design, another design.json
 * `app` or an install it did not see would keep the old copies, restart or not.
 */
export function dropStaleDepCache(paths: DesignPaths, appDir: string | null = null) {
  const dir = path.join(paths.cache, 'vite')
  const stamp = path.join(paths.cache, 'vite-runtime')
  let runtime = ''
  try {
    runtime = createHash('sha256').update(fs.readFileSync(PKG.runtime)).digest('hex')
  } catch {}
  if (appDir) runtime += ` ${appDir}`
  runtime += ` ${installStamp(paths, appDir)}`
  let seen = ''
  try {
    seen = fs.readFileSync(stamp, 'utf8')
  } catch {}
  if (seen === runtime) return
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(paths.cache, { recursive: true })
  fs.writeFileSync(stamp, runtime)
}

const VITE_CONFIGS = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cts',
  'vite.config.cjs',
]
/** Plugins screens have from foss-design already. */
const OWN_PLUGIN = /^(?:vite:react|@tailwindcss\/vite)/

/** The app's Vite config: in design.json `app`, else in the project root. */
export function appViteConfig(project: DesignProject): string | null {
  for (const dir of [project.appDir(), project.paths.root]) {
    if (!dir) continue
    for (const name of VITE_CONFIGS) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name)
  }
  return null
}

async function flatten(list: PluginOption[] | undefined, out: Plugin[] = []): Promise<Plugin[]> {
  for (const option of list ?? []) {
    const value = await option
    if (Array.isArray(value)) await flatten(value, out)
    else if (value && typeof value === 'object' && 'name' in value) out.push(value as Plugin)
  }
  return out
}

/**
 * The plugins design.json `vitePlugins` names, taken from the app's own Vite config (loaded as the
 * app's dev server or build would load it): `vite-plugin-svgr` for `*.svg?react`, say. A name also
 * takes a plugin's parts (`name:…`). Screens are pulled code, and design.json with them: it only
 * picks among plugins the app already runs, and never names code to load itself. Names that match
 * nothing come back as problems, with what the config has.
 */
export async function appPlugins(
  project: DesignProject,
  command: 'serve' | 'build',
): Promise<{ plugins: Plugin[]; problems: string[] }> {
  const wanted = project.config().config.vitePlugins ?? []
  if (!wanted.length) return { plugins: [], problems: [] }
  const file = appViteConfig(project)
  if (!file)
    return {
      plugins: [],
      problems: [
        `design.json vitePlugins: no vite.config.* in ${project.appDir() ? 'the app package or ' : ''}the project root to take them from`,
      ],
    }
  let all: Plugin[]
  try {
    const loaded = await loadConfigFromFile(
      { command, mode: command === 'serve' ? 'development' : 'production', isSsrBuild: false, isPreview: false },
      file,
      path.dirname(file),
      'silent',
    )
    all = await flatten(loaded?.config.plugins)
  } catch (error) {
    return {
      plugins: [],
      problems: [
        `design.json vitePlugins: ${path.relative(project.paths.root, file)} did not load: ${(error as Error).message}`,
      ],
    }
  }
  const plugins: Plugin[] = []
  const problems: string[] = []
  for (const name of wanted) {
    if (OWN_PLUGIN.test(name)) {
      problems.push(`design.json vitePlugins: "${name}" is foss-design's own (React and Tailwind are always on)`)
      continue
    }
    const found = all.filter((plugin) => plugin.name === name || plugin.name.startsWith(`${name}:`))
    if (found.length) plugins.push(...found)
    else
      problems.push(
        `design.json vitePlugins: no "${name}" in ${path.relative(project.paths.root, file)}; it has ${all.map((plugin) => plugin.name).join(', ') || 'no plugins'}`,
      )
  }
  return { plugins, problems }
}

/** What the dev server and the static build share; `extra` are the app's plugins from `appPlugins`. */
export function baseConfig(project: DesignProject, extra: Plugin[] = []): InlineConfig {
  const { paths } = project
  return {
    configFile: false,
    // The app's `.env`, `.env.local` and `.env.<mode>` files, as its own dev server and build read
    // them: screens get the same `import.meta.env.VITE_*` (a CDN host, a public API key). Only the
    // `VITE_` ones reach the browser, as in the app's build; a push bakes them into the cloud's copy.
    envDir: project.appDir() ?? paths.root,
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
    plugins: [react(), designCodeGuard(paths.design), ...extra, tailwindcss()],
  }
}
