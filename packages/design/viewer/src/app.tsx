import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Redirect, Route, Router, Switch } from 'wouter'
import { CommandPalette } from './components/command-palette'
import { AppTopBar } from './components/topbar'
import { connectEvents, createQueryClient, useProject } from './lib/api'
import type { ViewerSource } from './lib/source'
import {
  sameId,
  sourceId,
  type Viewer,
  ViewerContext,
  type ViewerScope,
  type ViewerSlots,
  viewerKeys,
} from './lib/viewer'
import { CanvasPage } from './pages/canvas/canvas-page'
import { PlayPage } from './pages/canvas/play-page'
import { HomePage } from './pages/home'
import { NotFound } from './pages/not-found'
import { SystemRoutes } from './pages/system/system-routes'
import { Toaster } from './ui/toast'
import { TooltipProvider } from './ui/tooltip'

function Title() {
  const name = useProject().data?.name
  useEffect(() => {
    if (name) document.title = `${name} · Design`
  }, [name])
  return null
}

function Routes() {
  return (
    <Switch>
      <Route path="/c/:canvas/play/:item">
        {(params) => <PlayPage canvasId={params.canvas} itemId={params.item} />}
      </Route>
      <Route path="/c/:canvas/p/:page">
        {(params) => <CanvasPage canvasId={params.canvas} pageId={params.page} />}
      </Route>
      <Route path="/c/:canvas">{(params) => <CanvasPage canvasId={params.canvas} />}</Route>
      <Route path="/system/*?">
        <AppTopBar />
        <SystemRoutes />
      </Route>
      <Route path="/">
        <AppTopBar />
        <HomePage />
      </Route>
      <Route>
        <AppTopBar />
        <NotFound />
      </Route>
    </Switch>
  )
}

/** Single-canvas mode: the canvas, its pages and its screens; anything else leads back to it. */
function ScopedRoutes({ canvas }: { canvas: string }) {
  const home = `/c/${encodeURIComponent(canvas)}`
  const guard = (param: string, page: ReactNode) => (sameId(param, canvas) ? page : <Redirect to={home} replace />)
  return (
    <Switch>
      <Route path="/c/:canvas/play/:item">
        {(params) => guard(params.canvas, <PlayPage canvasId={canvas} itemId={params.item} />)}
      </Route>
      <Route path="/c/:canvas/p/:page">
        {(params) => guard(params.canvas, <CanvasPage canvasId={canvas} pageId={params.page} />)}
      </Route>
      <Route path="/c/:canvas">{(params) => guard(params.canvas, <CanvasPage canvasId={canvas} />)}</Route>
      <Route>
        <Redirect to={home} replace />
      </Route>
    </Switch>
  )
}

export interface DesignViewerProps {
  /** Where the project comes from: `localSource`, `staticSource` or the embedding app's own. Keep it stable. */
  source: ViewerSource
  /**
   * Path the viewer's routes live under, such as `/p/<projectId>`; it adds to the base of the
   * wouter router around the viewer, whose location hook it also uses.
   */
  base?: string
  /** The `sandbox` attribute for every frame; none when unset. */
  frameSandbox?: string
  slots?: ViewerSlots
  scope?: ViewerScope
  /** Shared with the embedding app; the viewer makes its own when unset. */
  queryClient?: QueryClient
}

/** The whole viewer: home, canvases, screens and the design system of one project. */
export function DesignViewer({ source, base = '', frameSandbox, slots, scope, queryClient }: DesignViewerProps) {
  const [ownClient] = useState(() => queryClient ?? createQueryClient(source.live))
  const client = queryClient ?? ownClient
  const keys = useMemo(() => viewerKeys(sourceId(source)), [source])
  const scopeCanvas = scope?.canvas
  const viewer = useMemo<Viewer>(
    () => ({
      source,
      keys,
      frameSandbox,
      slots: slots ?? {},
      scope: scopeCanvas === undefined ? null : { canvas: scopeCanvas },
    }),
    [source, keys, frameSandbox, slots, scopeCanvas],
  )

  useEffect(() => (source.live ? connectEvents(client, keys) : undefined), [source, client, keys])

  return (
    <QueryClientProvider client={client}>
      <ViewerContext.Provider value={viewer}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <Title />
            <Router base={base}>
              {viewer.scope ? <ScopedRoutes canvas={viewer.scope.canvas} /> : <Routes />}
              <CommandPalette />
            </Router>
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </ViewerContext.Provider>
    </QueryClientProvider>
  )
}
