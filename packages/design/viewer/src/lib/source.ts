import type { CanvasDoc, ProjectInfo, SystemDoc } from '@shared/types'

declare global {
  interface Window {
    __DESIGN_STATIC__?: boolean
    __DESIGN_CANVAS_READY__?: boolean
  }
}

/** A site made by `design build`: JSON files instead of the API, hash routing, no live updates. */
export const STATIC_SITE = window.__DESIGN_STATIC__ === true

/**
 * Where the viewer gets a project from. Docs keep the URLs they were built
 * with; relative ones (`_s/…`, `_f/…`, `_snap/…`) resolve against the `base`
 * their unit comes with, so frames and images can live on another host.
 */
export interface ViewerSource {
  /** Keep queries fresh from the preview server's `/api/events` stream. */
  live: boolean
  project(): Promise<ProjectInfo>
  canvas(id: string): Promise<{ doc: CanvasDoc; base: string }>
  /** Null when the project has no design system. */
  system(): Promise<{ doc: SystemDoc; base: string } | null>
  /** The text of a project file; `unit` is `system` or `canvas/<id>`. */
  source(path: string, unit: string): Promise<string>
  /** Set the project icon (an SVG, PNG or WebP), or remove it with null. Without it the viewer offers no icon controls. */
  setIcon?(file: Blob | null): Promise<void>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function get<T>(url: string, cache: RequestCache): Promise<T> {
  const response = await fetch(url, { cache })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {}
    throw new ApiError(response.status, message)
  }
  return (await response.json()) as T
}

/** A missing design system is a 404; the viewer shows it as none. */
async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** The preview server of `design preview`. */
let loggedVersion = ''
/** Once per load, so "which version is this?" has an answer in the console. */
function logVersion(info: ProjectInfo): ProjectInfo {
  if (loggedVersion !== info.version) {
    loggedVersion = info.version
    console.info(`foss-design ${info.version}${STATIC_SITE ? ' (static build)' : ''}`)
  }
  return info
}

export const localSource: ViewerSource = {
  live: true,
  project: () => get<ProjectInfo>('/api/project', 'no-store').then(logVersion),
  canvas: async (id) => ({
    doc: await get<CanvasDoc>(`/api/canvas/${encodeURIComponent(id)}`, 'no-store'),
    base: '',
  }),
  system: async () => {
    const doc = await orNull(get<SystemDoc>('/api/system', 'no-store'))
    return doc ? { doc, base: '' } : null
  },
  async source(path) {
    const response = await fetch(`/api/source?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) throw new ApiError(response.status, `Could not read ${path}`)
    return response.text()
  },
  async setIcon(file) {
    const response = await fetch('/api/icon', {
      method: file ? 'PUT' : 'DELETE',
      headers: file ? { 'content-type': file.type || 'application/octet-stream' } : undefined,
      body: file,
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(response.status, body.error ?? `${response.status} ${response.statusText}`)
    }
  },
}

let staticSources: Promise<Record<string, string>> | null = null

/** The JSON files of a `design build` site, relative to its root. */
export const staticSource: ViewerSource = {
  live: false,
  project: () => get<ProjectInfo>('api/project.json', 'default').then(logVersion),
  canvas: async (id) => ({
    doc: await get<CanvasDoc>(`api/canvas/${encodeURIComponent(id)}.json`, 'default'),
    base: '',
  }),
  system: async () => {
    const doc = await orNull(get<SystemDoc>('api/system.json', 'default'))
    return doc ? { doc, base: '' } : null
  },
  async source(path) {
    staticSources ??= get<Record<string, string>>('api/sources.json', 'default').catch(() => ({}))
    const text = (await staticSources)[path]
    if (text === undefined) throw new ApiError(404, `${path} is not in this build`)
    return text
  },
}

/** `url` against a unit's base; an empty base leaves it as the doc has it. */
export function resolveUrl(url: string, base: string): string {
  if (!base) return url
  try {
    const root = new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI)
    return new URL(url, root).href
  } catch {
    return url
  }
}

/** A canvas with its frame, snapshot and image URLs resolved against its unit's base. */
export function resolveCanvas(doc: CanvasDoc, base: string): CanvasDoc {
  if (!base) return doc
  const at = (url: string) => resolveUrl(url, base)
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => {
          if (item.kind === 'screen') {
            const each = (set?: Partial<Record<string, string>>) =>
              set ? Object.fromEntries(Object.entries(set).map(([theme, url]) => [theme, url && at(url)])) : undefined
            return { ...item, url: at(item.url), snapshots: each(item.snapshots), thumbs: each(item.thumbs) }
          }
          if (item.kind === 'image') return { ...item, url: at(item.url) }
          return item
        }),
      })),
    })),
  }
}

/** A design system with its specimen and asset URLs resolved against the system unit's base. */
export function resolveSystem(doc: SystemDoc, base: string): SystemDoc {
  if (!base) return doc
  const at = (url: string) => resolveUrl(url, base)
  return {
    ...doc,
    components: doc.components.map((component) => ({ ...component, url: at(component.url) })),
    assets: doc.assets.map((asset) => ({ ...asset, url: at(asset.url) })),
    typographyUrl: doc.typographyUrl && at(doc.typographyUrl),
  }
}
