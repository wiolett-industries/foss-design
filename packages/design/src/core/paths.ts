import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toPosix } from './text'

export const DESIGN_DIR = '.design'

export interface DesignPaths {
  root: string
  design: string
  config: string
  system: string
  canvases: string
  cache: string
  entries: string
  snapshots: string
  shots: string
}

export function designPaths(root: string): DesignPaths {
  const design = path.join(root, DESIGN_DIR)
  const cache = path.join(design, '.cache')
  return {
    root,
    design,
    config: path.join(design, 'design.json'),
    system: path.join(design, 'system'),
    canvases: path.join(design, 'canvas'),
    cache,
    entries: path.join(cache, 'entries'),
    snapshots: path.join(cache, 'snapshots'),
    shots: path.join(cache, 'shots'),
  }
}

/** The nearest folder up from `from` that holds a `.design` folder. */
export function findProjectRoot(from = process.cwd()): string | null {
  let dir = path.resolve(from)
  for (;;) {
    const candidate = path.join(dir, DESIGN_DIR)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Path relative to the project root, with forward slashes. */
export function relToRoot(paths: DesignPaths, abs: string): string {
  return toPosix(path.relative(paths.root, abs))
}

/** Path relative to `.design`, with forward slashes: what follows `/_fs/` in URLs. */
export function relToDesign(paths: DesignPaths, abs: string): string {
  return toPosix(path.relative(paths.design, abs))
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Where this package lives; every bundled entry sits directly in `dist/`. */
export const PKG_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export const PKG = {
  root: PKG_ROOT,
  manifest: path.join(PKG_ROOT, 'package.json'),
  runtime: path.join(PKG_ROOT, 'dist', 'runtime', 'index.js'),
  baseCss: path.join(PKG_ROOT, 'dist', 'runtime', 'base.css'),
  viewer: path.join(PKG_ROOT, 'dist', 'viewer'),
  cli: path.join(PKG_ROOT, 'dist', 'cli.js'),
}

export function packageVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(PKG.manifest, 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Resolve a module the way Node would from `anchor` (a file), or null. */
export function resolveFrom(anchor: string, request: string): string | null {
  try {
    return createRequire(anchor).resolve(request)
  } catch {
    return null
  }
}
