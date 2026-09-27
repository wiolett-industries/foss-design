import fs from 'node:fs'
import path from 'node:path'
import type { Issue, ProjectInfo } from '../shared/types'
import { listCanvasIds, loadCanvas, type ResolvedCanvas, summarize } from './canvas'
import { type DesignPaths, isInside, packageVersion, relToRoot } from './paths'
import { publicFiles } from './public'
import { type DesignConfig, DesignConfigSchema, describeZodError } from './schema'
import type { ScreenSource, SnapshotLookup, UrlScheme } from './sources'
import { loadSystem, type ResolvedSystem, SYSTEM_CANVAS, summarizeSystem } from './system'

/** Why design.json `public` cannot be used, or null. Its files get pushed, so it stays inside the project. */
function publicProblem(root: string, value: string): string | null {
  const dir = path.resolve(root, value)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return `no folder "${value}"`
  const real = fs.realpathSync(dir)
  const realRoot = fs.realpathSync(root)
  if (real === realRoot || !isInside(realRoot, real)) return `"${value}" is not a folder inside the project`
  return null
}

/** The `.design` folder, loaded lazily and cached until a file changes. */
export class DesignProject {
  private configCache: { config: DesignConfig; issues: Issue[] } | null = null
  private systemCache: ResolvedSystem | null | undefined
  private canvasCache = new Map<string, ResolvedCanvas>()
  private publicCache: { list: string[]; set: Set<string> } | null = null

  constructor(
    readonly paths: DesignPaths,
    readonly urls: UrlScheme,
    readonly snapshots: SnapshotLookup | null = null,
  ) {}

  config(): { config: DesignConfig; issues: Issue[] } {
    if (this.configCache) return this.configCache
    const issues: Issue[] = []
    let config: DesignConfig = {}
    const file = this.paths.config
    if (fs.existsSync(file)) {
      try {
        const parsed = DesignConfigSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
        if (parsed.success) config = parsed.data
        else
          for (const issue of describeZodError(parsed.error))
            issues.push({ severity: 'error', file: relToRoot(this.paths, file), message: issue.message, at: issue.at })
      } catch (error) {
        issues.push({
          severity: 'error',
          file: relToRoot(this.paths, file),
          message: `invalid JSON: ${(error as Error).message}`,
        })
      }
    }
    if (config.public !== undefined) {
      const problem = publicProblem(this.paths.root, config.public)
      if (problem) {
        issues.push({ severity: 'error', file: relToRoot(this.paths, file), at: 'public', message: problem })
        config = { ...config, public: undefined }
      }
    }
    this.configCache = { config, issues }
    return this.configCache
  }

  /** The public folder from design.json, when it is a folder inside the project. */
  publicDir(): string | null {
    const configured = this.config().config.public
    return configured === undefined ? null : path.resolve(this.paths.root, configured)
  }

  /** The public folder's files, relative to it; `invalidatePublic` when they change. */
  publicFiles(): string[] {
    if (!this.publicCache) {
      const dir = this.publicDir()
      const list = dir ? publicFiles(dir) : []
      this.publicCache = { list, set: new Set(list) }
    }
    return this.publicCache.list
  }

  /** Whether `rel` is a file the public folder serves (dot-files and links out of it are not). */
  isPublicFile(rel: string): boolean {
    this.publicFiles()
    return this.publicCache?.set.has(rel) ?? false
  }

  name(): string {
    const configured = this.config().config.name
    if (configured) return configured
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(this.paths.root, 'package.json'), 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name) return manifest.name
    } catch {}
    return path.basename(this.paths.root)
  }

  system(): ResolvedSystem | null {
    if (this.systemCache === undefined) this.systemCache = loadSystem(this.paths, this.urls)
    return this.systemCache
  }

  canvasIds(): string[] {
    return listCanvasIds(this.paths)
  }

  canvas(id: string): ResolvedCanvas | null {
    const cached = this.canvasCache.get(id)
    if (cached) return cached
    if (!fs.existsSync(path.join(this.paths.canvases, id))) return null
    const canvas = loadCanvas(this.paths, id, this.urls, this.snapshots)
    this.canvasCache.set(id, canvas)
    return canvas
  }

  canvases(): ResolvedCanvas[] {
    return this.canvasIds()
      .map((id) => this.canvas(id))
      .filter((canvas): canvas is ResolvedCanvas => canvas !== null)
  }

  /** Every frame the server can render. */
  sources(): ScreenSource[] {
    return [...(this.system()?.specimens ?? []), ...this.canvases().flatMap((canvas) => canvas.screens)]
  }

  source(canvasId: string, id: string): ScreenSource | null {
    const list = canvasId === SYSTEM_CANVAS ? (this.system()?.specimens ?? []) : (this.canvas(canvasId)?.screens ?? [])
    return list.find((source) => source.id === id) ?? null
  }

  info(isStatic: boolean): ProjectInfo {
    const system = this.system()
    return {
      name: this.name(),
      root: isStatic ? '' : this.paths.root,
      static: isStatic,
      version: packageVersion(),
      system: system ? summarizeSystem(system) : null,
      canvases: this.canvases().map(summarize),
      issues: this.config().issues,
    }
  }

  /** Every problem in the project, for `design check`. */
  issues(): Issue[] {
    return [
      ...this.config().issues,
      ...(this.system()?.doc.issues ?? []),
      ...this.canvases().flatMap((canvas) => canvas.doc.issues),
    ]
  }

  invalidateConfig() {
    this.configCache = null
    this.publicCache = null
  }

  invalidatePublic() {
    this.publicCache = null
  }

  invalidateSystem() {
    this.systemCache = undefined
  }

  invalidateCanvas(id?: string) {
    if (id) this.canvasCache.delete(id)
    else this.canvasCache.clear()
  }

  invalidateAll() {
    this.invalidateConfig()
    this.invalidateSystem()
    this.invalidateCanvas()
  }
}
