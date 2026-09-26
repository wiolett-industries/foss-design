import fs from 'node:fs'
import path from 'node:path'
import type { Issue, ProjectInfo } from '../shared/types'
import { listCanvasIds, loadCanvas, type ResolvedCanvas, summarize } from './canvas'
import { type DesignPaths, packageVersion, relToRoot } from './paths'
import { type DesignConfig, DesignConfigSchema, describeZodError } from './schema'
import type { ScreenSource, SnapshotLookup, UrlScheme } from './sources'
import { loadSystem, type ResolvedSystem, SYSTEM_CANVAS, summarizeSystem } from './system'

/** The `.design` folder, loaded lazily and cached until a file changes. */
export class DesignProject {
  private configCache: { config: DesignConfig; issues: Issue[] } | null = null
  private systemCache: ResolvedSystem | null | undefined
  private canvasCache = new Map<string, ResolvedCanvas>()

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
    this.configCache = { config, issues }
    return this.configCache
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
