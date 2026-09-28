import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Redirect, Route, Router, Switch } from 'wouter'
import { CommandPalette } from './components/command-palette'
import { PageBoundary } from './components/error-boundary'
import { AppTopBar } from './components/topbar'
import { connectEvents, createQueryClient, useProject } from './lib/api'
import { useIsPhone } from './lib/phone'
import type { ViewerSource } from './lib/source'
import {
  DEFAULT_FRAME_ALLOW,
  sameId,
  sourceId,
  type Viewer,
  ViewerContext,
  type ViewerScope,
  type ViewerSlots,
  viewerKeys,
} from './lib/viewer'
import { CanvasPage } from './pages/canvas/canvas-page'
import { FullPage } from './pages/canvas/full-page'
import { PhoneCanvas } from './pages/canvas/phone-view'
import { PlayPage } from './pages/canvas/play-page'
import { HomePage } from './pages/home'
import { NotFound } from './pages/not-found'
import { SystemRoutes } from './pages/system/system-routes'
import { Toaster } from './ui/toast'
import { TooltipProvider } from './ui/tooltip'

function Title() {
  const { name, icon } = useProject().data ?? {}
  useEffect(() => {
    if (name) document.title = `${name} · Design`
  }, [name])
  // The tab shows the project's icon when it has one.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    link.dataset.fallback ??= link.getAttribute('href') ?? ''
    link.removeAttribute('type')
    link.href = icon || link.dataset.fallback
  }, [icon])
  return null
}

/** Screenshots (`?capture`) always get the canvas, whatever the window. */
const CAPTURE = new URLSearchParams(window.location.search).has('capture')

/** The canvas routes' pages; on a phone the canvas is one screen at a time. */
function useCanvasPages() {
  const phone = useIsPhone() && !CAPTURE
  return {
    play: (canvas: string, item: string) =>
      phone ? <PhoneCanvas canvasId={canvas} itemId={item} /> : <PlayPage canvasId={canvas} itemId={item} />,
    canvas: (canvas: string, page?: string) =>
      phone ? <PhoneCanvas canvasId={canvas} pageId={page} /> : <CanvasPage canvasId={canvas} pageId={page} />,
  }
}

function Routes() {
  const pages = useCanvasPages()
  return (
    <Switch>
      <Route path="/c/:canvas/full/:item">
        {(params) => <FullPage canvasId={params.canvas} itemId={params.item} />}
      </Route>
      <Route path="/c/:canvas/play/:item">{(params) => pages.play(params.canvas, params.item)}</Route>
      <Route path="/c/:canvas/p/:page">{(params) => pages.canvas(params.canvas, params.page)}</Route>
      <Route path="/c/:canvas">{(params) => pages.canvas(params.canvas)}</Route>
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
  const pages = useCanvasPages()
  return (
    <Switch>
      <Route path="/c/:canvas/full/:item">
        {(params) => guard(params.canvas, <FullPage canvasId={canvas} itemId={params.item} />)}
      </Route>
      <Route path="/c/:canvas/play/:item">{(params) => guard(params.canvas, pages.play(canvas, params.item))}</Route>
      <Route path="/c/:canvas/p/:page">{(params) => guard(params.canvas, pages.canvas(canvas, params.page))}</Route>
      <Route path="/c/:canvas">{(params) => guard(params.canvas, pages.canvas(canvas))}</Route>
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
  /**
   * The `allow` attribute (permissions policy) for every frame; `clipboard-read; clipboard-write;
   * fullscreen` when unset, as the local viewer has it. A permission the user grants is the
   * embedding page's and then holds for every frame, so a host that shows screens from others
   * should grant less, such as `clipboard-write` alone.
   */
  frameAllow?: string
  slots?: ViewerSlots
  scope?: ViewerScope
  /** Shared with the embedding app; the viewer makes its own when unset. */
  queryClient?: QueryClient
}

/** The whole viewer: home, canvases, screens and the design system of one project. */
export function DesignViewer({
  source,
  base = '',
  frameSandbox,
  frameAllow = DEFAULT_FRAME_ALLOW,
  slots,
  scope,
  queryClient,
}: DesignViewerProps) {
  const [ownClient] = useState(() => queryClient ?? createQueryClient(source.live))
  const client = queryClient ?? ownClient
  const keys = useMemo(() => viewerKeys(sourceId(source)), [source])
  const scopeCanvas = scope?.canvas
  const viewer = useMemo<Viewer>(
    () => ({
      source,
      keys,
      frameSandbox,
      frameAllow,
      slots: slots ?? {},
      scope: scopeCanvas === undefined ? null : { canvas: scopeCanvas },
    }),
    [source, keys, frameSandbox, frameAllow, slots, scopeCanvas],
  )

  useEffect(() => (source.live ? connectEvents(client, keys) : undefined), [source, client, keys])

  return (
    <QueryClientProvider client={client}>
      <ViewerContext.Provider value={viewer}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <Title />
            <Router base={base}>
              <PageBoundary>{viewer.scope ? <ScopedRoutes canvas={viewer.scope.canvas} /> : <Routes />}</PageBoundary>
              <CommandPalette />
            </Router>
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </ViewerContext.Provider>
    </QueryClientProvider>
  )
}
