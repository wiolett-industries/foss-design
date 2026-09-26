import type { DesignEvent } from '@shared/types'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { resolveCanvas, resolveSystem } from './source'
import { useViewer, type ViewerKeys } from './viewer'

export { ApiError } from './source'

/** A live source refetches on every change it announces; the others load once. */
export function createQueryClient(live: boolean) {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: live ? 0 : Number.POSITIVE_INFINITY, retry: 1, refetchOnWindowFocus: false },
    },
  })
}

/** Nothing in single-canvas mode needs the project. */
export function useProject() {
  const { source, keys, scope } = useViewer()
  return useQuery({ queryKey: keys.project, queryFn: () => source.project(), enabled: !scope })
}

export function useCanvas(id: string, enabled = true) {
  const { source, keys } = useViewer()
  return useQuery({
    queryKey: keys.canvas(id),
    queryFn: async () => {
      const { doc, base } = await source.canvas(id)
      return resolveCanvas(doc, base)
    },
    placeholderData: (prev) => prev,
    enabled,
  })
}

/** Null when the project has no design system. */
export function useSystem(enabled = true) {
  const { source, keys } = useViewer()
  return useQuery({
    queryKey: keys.system,
    queryFn: async () => {
      const system = await source.system()
      return system ? resolveSystem(system.doc, system.base) : null
    },
    enabled,
  })
}

/** A file of the design system. */
export function useSource(path: string | null, unit = 'system') {
  const { source, keys } = useViewer()
  return useQuery({
    queryKey: keys.source(unit, path ?? ''),
    queryFn: () => source.source(path!, unit),
    enabled: !!path,
  })
}

/** Keep queries fresh from the preview server's event stream. */
export function connectEvents(queryClient: QueryClient, keys: ViewerKeys) {
  let source: EventSource | null = null
  let dropped = false
  const open = () => {
    source = new EventSource('/api/events')
    source.onopen = () => {
      if (dropped) {
        dropped = false
        void queryClient.invalidateQueries({ queryKey: keys.all })
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
        void queryClient.invalidateQueries({ queryKey: keys.sources })
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
