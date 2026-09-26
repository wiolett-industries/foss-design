import type { SystemDoc } from '@shared/types'
import { Route, Switch } from 'wouter'
import { ApiError, useProject, useSystem } from '../../lib/api'
import { Notice } from '../../ui/page'
import { Mono } from '../../ui/text'
import { NotFound } from '../not-found'
import { AssetsPage } from './assets'
import { ColorsPage } from './colors'
import { ComponentPage } from './component-page'
import { GuidelinePage } from './guideline'
import { MotionPage } from './motion'
import { SystemNav } from './nav'
import { OtherTokensPage } from './other-tokens'
import { OverviewPage } from './overview'
import { ShapePage } from './shape'
import { TypographyPage } from './typography'

function Layout({ system }: { system: SystemDoc }) {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] grow animate-[q-fade-in_160ms_ease-out] px-8 pt-6 pb-7 max-md:px-4 max-md:pt-4">
      <div
        className="grid w-full items-start gap-6 max-lg:grid-cols-1!"
        style={{ gridTemplateColumns: '232px minmax(0, 1fr)' }}
      >
        <aside className="sticky top-[76px] flex max-h-[calc(100dvh-100px)] flex-col overflow-y-auto pb-4 max-lg:static max-lg:max-h-none max-lg:overflow-visible max-lg:pb-0">
          <SystemNav system={system} />
        </aside>
        <div className="flex min-w-0 flex-col gap-5">
          <Switch>
            <Route path="/system">
              <OverviewPage system={system} />
            </Route>
            <Route path="/system/colors">
              <ColorsPage system={system} />
            </Route>
            <Route path="/system/typography">
              <TypographyPage system={system} />
            </Route>
            <Route path="/system/shape">
              <ShapePage system={system} />
            </Route>
            <Route path="/system/motion">
              <MotionPage system={system} />
            </Route>
            <Route path="/system/tokens">
              <OtherTokensPage system={system} />
            </Route>
            <Route path="/system/assets">
              <AssetsPage system={system} />
            </Route>
            <Route path="/system/guidelines/:slug">
              {(params) => <GuidelinePage system={system} slug={decodeURIComponent(params.slug)} />}
            </Route>
            <Route path="/system/components/:id">
              {(params) => <ComponentPage system={system} id={decodeURIComponent(params.id)} />}
            </Route>
            <Route>
              <NotFound title="No such page" text="This page is not part of the design system." />
            </Route>
          </Switch>
        </div>
      </div>
    </main>
  )
}

function NoSystem() {
  return (
    <Notice
      title="No design system yet"
      text={
        <>
          Ask your agent to build one from the codebase, or run <Mono>design system init</Mono> to start from a template
          in <Mono>.design/system</Mono>.
        </>
      }
    />
  )
}

/** `/system/*`: foundations, guidelines and components of `.design/system`. */
export function SystemRoutes() {
  const project = useProject().data
  const hasSystem = project ? project.system !== null : undefined
  // Wait for the project so a missing system never costs a 404.
  const { data: system, error, isLoading } = useSystem(hasSystem === true)
  if (hasSystem === false || (error instanceof ApiError && error.status === 404)) return <NoSystem />
  if (error) return <Notice title="Could not load the design system" text={(error as Error).message} />
  if (isLoading || !system) return null
  return <Layout system={system} />
}
