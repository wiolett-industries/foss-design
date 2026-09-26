import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { CommandPalette } from './components/command-palette'
import { AppTopBar } from './components/topbar'
import { STATIC, useProject } from './lib/api'
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

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Title />
        {STATIC ? (
          <Router hook={useHashLocation} hrefs={(href) => `#${href}`}>
            <Routes />
            <CommandPalette />
          </Router>
        ) : (
          <Router>
            <Routes />
            <CommandPalette />
          </Router>
        )}
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  )
}
