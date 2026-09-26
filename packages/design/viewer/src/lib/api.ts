import type { CanvasDoc, DesignEvent, ProjectInfo, SystemDoc } from '@shared/types'
import { QueryClient, useQuery } from '@tanstack/react-query'

declare global {
  interface Window {
    __DESIGN_STATIC__?: boolean
    __DESIGN_CANVAS_READY__?: boolean
  }
}

/** A static build: JSON files instead of the API, hash routing, no live updates. */
export const STATIC = window.__DESIGN_STATIC__ === true

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: STATIC ? 'default' : 'no-store' })
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

let staticSources: Promise<Record<string, string>> | null = null

export const api = {
  project: () => get<ProjectInfo>(STATIC ? 'api/project.json' : '/api/project'),
  canvas: (id: string) =>
    get<CanvasDoc>(STATIC ? `api/canvas/${encodeURIComponent(id)}.json` : `/api/canvas/${encodeURIComponent(id)}`),
  system: () => get<SystemDoc>(STATIC ? 'api/system.json' : '/api/system'),
  async source(path: string): Promise<string> {
    if (STATIC) {
      staticSources ??= get<Record<string, string>>('api/sources.json').catch(() => ({}))
      const text = (await staticSources)[path]
      if (text === undefined) throw new ApiError(404, `${path} is not in this build`)
      return text
    }
    const response = await fetch(`/api/source?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) throw new ApiError(response.status, `Could not read ${path}`)
    return response.text()
  },
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: STATIC ? Number.POSITIVE_INFINITY : 0, retry: 1, refetchOnWindowFocus: false },
  },
})

export const keys = {
  project: ['project'] as const,
  canvas: (id: string) => ['canvas', id] as const,
  system: ['system'] as const,
  source: (path: string) => ['source', path] as const,
}

export function useProject() {
  return useQuery({ queryKey: keys.project, queryFn: api.project })
}

export function useCanvas(id: string) {
  return useQuery({ queryKey: keys.canvas(id), queryFn: () => api.canvas(id), placeholderData: (prev) => prev })
}

export function useSystem(enabled = true) {
  return useQuery({ queryKey: keys.system, queryFn: api.system, enabled })
}

export function useSource(path: string | null) {
  return useQuery({ queryKey: keys.source(path ?? ''), queryFn: () => api.source(path!), enabled: !!path })
}

/** Keep queries fresh from the server's event stream. */
export function connectEvents() {
  if (STATIC) return () => {}
  let source: EventSource | null = null
  let dropped = false
  const open = () => {
    source = new EventSource('/api/events')
    source.onopen = () => {
      if (dropped) {
        dropped = false
        void queryClient.invalidateQueries()
      }
    }
    source.onerror = () => {
      dropped = true
    }
    source.onmessage = (message) => {
      let event: DesignEvent
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      if (event.type === 'project') void queryClient.invalidateQueries({ queryKey: keys.project })
      else if (event.type === 'system') {
        void queryClient.invalidateQueries({ queryKey: keys.system })
        void queryClient.invalidateQueries({ queryKey: ['source'] })
      } else if (event.type === 'canvas' || event.type === 'snapshot') {
        const id = event.type === 'canvas' ? event.id : event.canvas
        void queryClient.invalidateQueries({ queryKey: keys.canvas(id) })
        if (event.type === 'snapshot') void queryClient.invalidateQueries({ queryKey: keys.project })
      }
    }
  }
  open()
  return () => source?.close()
}
