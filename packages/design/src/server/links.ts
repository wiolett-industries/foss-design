import fs from 'node:fs'
import path from 'node:path'
import { type DesignPaths, PKG_ROOT } from '../core/paths'

/** Packages screens can import in any project; the project's own copy wins when it has one. */
export const SHIPPED_PACKAGES = ['react', 'react-dom', 'motion', 'lucide-react', 'clsx', 'tailwind-merge'] as const

/** The folder of package `name` visible from `fromDir`, walking up like Node does. */
export function findPackageDir(fromDir: string, name: string, skip?: string): string | null {
  let dir = path.resolve(fromDir)
  for (;;) {
    const modules = path.join(dir, 'node_modules')
    const candidate = path.join(modules, name)
    if (modules !== skip && fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function isLink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

export interface LinkResult {
  /** Packages served from this tool because the project lacks them. */
  linked: string[]
  /** Real folders the dev server must be allowed to read. */
  allow: string[]
}

/** Point `link` at `target` unless it already does. */
function ensureLink(link: string, target: string) {
  let current: string | null = null
  try {
    current = fs.realpathSync(link)
  } catch {}
  if (current === target) return
  if (isLink(link)) fs.unlinkSync(link)
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

/** The packages in `<app>/node_modules` (scoped ones as `@scope/name`), to their real folders. */
function appPackages(appDir: string): Map<string, string> {
  const found = new Map<string, string>()
  const modules = path.join(appDir, 'node_modules')
  const add = (name: string, dir: string) => {
    try {
      if (fs.existsSync(path.join(dir, 'package.json'))) found.set(name, fs.realpathSync(dir))
    } catch {}
  }
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(modules, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const dir = path.join(modules, entry.name)
    if (!entry.name.startsWith('@')) {
      add(entry.name, dir)
      continue
    }
    try {
      for (const scoped of fs.readdirSync(dir))
        if (!scoped.startsWith('.')) add(`${entry.name}/${scoped}`, path.join(dir, scoped))
    } catch {}
  }
  return found
}

/** Which links in `.design/node_modules` came from the app package, so a later run can take back the ones it dropped. */
const APP_LINKS = '.foss-design-app.json'

/**
 * Make the shipped packages resolvable from `.design` when the project does not have them,
 * through links in `.design/node_modules`. With design.json `app` (a monorepo's app package),
 * every package in the app's `node_modules` is linked there too, so screens import what the
 * app imports and share its single React.
 */
export function linkShippedPackages(paths: DesignPaths, appDir: string | null = null): LinkResult {
  const modules = path.join(paths.design, 'node_modules')
  const linked: string[] = []
  const allow = new Set<string>()
  const app = appDir ? appPackages(appDir) : new Map<string, string>()
  const placedByUser = (link: string) => fs.existsSync(link) && !isLink(link)
  for (const name of SHIPPED_PACKAGES) {
    const link = path.join(modules, name)
    if (app.has(name) && !placedByUser(link)) continue
    const own = placedByUser(link) ? link : findPackageDir(paths.design, name, modules)
    if (own) {
      allow.add(path.dirname(fs.realpathSync(own)))
      if (isLink(link)) fs.unlinkSync(link)
      continue
    }
    const shipped = findPackageDir(PKG_ROOT, name)
    if (!shipped) continue
    const target = fs.realpathSync(shipped)
    allow.add(path.dirname(target))
    ensureLink(link, target)
    linked.push(name)
  }
  const fromApp: string[] = []
  for (const [name, target] of app) {
    const link = path.join(modules, name)
    if (placedByUser(link)) continue
    ensureLink(link, target)
    allow.add(path.dirname(target))
    fromApp.push(name)
  }
  const record = path.join(modules, APP_LINKS)
  let before: string[] = []
  try {
    before = JSON.parse(fs.readFileSync(record, 'utf8'))
  } catch {}
  for (const name of before) {
    const link = path.join(modules, name)
    if (!app.has(name) && !(SHIPPED_PACKAGES as readonly string[]).includes(name) && isLink(link)) {
      fs.unlinkSync(link)
      // A scope folder left empty goes too.
      if (name.startsWith('@'))
        try {
          fs.rmdirSync(path.dirname(link))
        } catch {}
    }
  }
  if (fromApp.length || before.length) {
    fs.mkdirSync(modules, { recursive: true })
    fs.writeFileSync(record, JSON.stringify(fromApp.sort()))
  }
  // The runtime itself, as `foss-design/runtime`: always the copy this CLI ships with.
  const self = path.join(modules, 'foss-design')
  const target = fs.realpathSync(PKG_ROOT)
  let current: string | null = null
  try {
    current = fs.realpathSync(self)
  } catch {}
  if (current !== target) {
    if (isLink(self)) fs.unlinkSync(self)
    if (!fs.existsSync(self)) {
      fs.mkdirSync(modules, { recursive: true })
      fs.symlinkSync(target, self, process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
  allow.add(target)
  return { linked, allow: [...allow] }
}
