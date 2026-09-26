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

/**
 * Make the shipped packages resolvable from `.design` when the project does not
 * have them, through links in `.design/node_modules`.
 */
export function linkShippedPackages(paths: DesignPaths): LinkResult {
  const modules = path.join(paths.design, 'node_modules')
  const linked: string[] = []
  const allow = new Set<string>()
  for (const name of SHIPPED_PACKAGES) {
    const link = path.join(modules, name)
    const placedByUser = fs.existsSync(link) && !isLink(link)
    const own = placedByUser ? link : findPackageDir(paths.design, name, modules)
    if (own) {
      allow.add(path.dirname(fs.realpathSync(own)))
      if (isLink(link)) fs.unlinkSync(link)
      continue
    }
    const shipped = findPackageDir(PKG_ROOT, name)
    if (!shipped) continue
    const target = fs.realpathSync(shipped)
    allow.add(path.dirname(target))
    let current: string | null = null
    try {
      current = fs.realpathSync(link)
    } catch {}
    if (current !== target) {
      if (isLink(link)) fs.unlinkSync(link)
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    }
    linked.push(name)
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
