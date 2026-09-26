import type { CanvasSummary, ProjectInfo } from '@shared/types'
import type { ReactNode } from 'react'
import { IssuesPanel } from '../components/issues'
import { useProject } from '../lib/api'
import { plural, relativeTime } from '../lib/format'
import { useViewer } from '../lib/viewer'
import { Badge, Count } from '../ui/badge'
import { ButtonLink } from '../ui/button'
import { Icon } from '../ui/icon'
import { Content, Notice, PageHead } from '../ui/page'
import { KV, Panel, PanelBody, PanelHead, RowLink } from '../ui/panel'
import { Mono, Two } from '../ui/text'

function Cover({ canvas }: { canvas: CanvasSummary }) {
  return (
    <div className="flex h-[54px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-rule bg-soft">
      {canvas.cover ? (
        <img src={canvas.cover} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        <Icon name="canvas" size={18} className="text-muted" />
      )}
    </div>
  )
}

/** A canvas row with the embedding app's actions after it, outside the link. */
function WithActions({ actions, children }: { actions: ReactNode; children: ReactNode }) {
  if (!actions) return children
  return (
    <div
      className="grid items-center border-t border-rule transition-colors hover:bg-soft"
      style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
    >
      {children}
      <div className="flex items-center gap-2 pr-4">{actions}</div>
    </div>
  )
}

function CanvasList({ project }: { project: ProjectInfo }) {
  const rowActions = useViewer().slots.canvasRowActions
  if (!project.canvases.length) {
    return (
      <Panel>
        <PanelHead title="Canvases" count={0} />
        <PanelBody>
          <div className="flex flex-col gap-2 py-6 text-center">
            <span className="text-[14px] text-ink2">No canvases yet.</span>
            <span className="text-[13px] text-muted">
              Ask your agent to design something, or run <Mono>design new &lt;name&gt;</Mono> in the project.
            </span>
          </div>
        </PanelBody>
      </Panel>
    )
  }
  return (
    <Panel>
      <PanelHead title="Canvases" count={project.canvases.length} />
      {project.canvases.map((canvas) => {
        const actions = rowActions?.(canvas.id)
        return (
          <WithActions key={canvas.id} actions={actions}>
            <RowLink
              to={`/c/${encodeURIComponent(canvas.id)}`}
              cols="86px minmax(0,1fr) auto auto"
              align="llrr"
              pad="10px 16px"
              minH={74}
              first={!!actions}
            >
              <Cover canvas={canvas} />
              <Two top={canvas.title} bottom={<span className="truncate">{canvas.description ?? canvas.id}</span>} />
              <span className="flex items-center gap-2 text-[12.5px] whitespace-nowrap text-muted">
                {canvas.issues ? <Badge tone="danger">{plural(canvas.issues, 'problem')}</Badge> : null}
                {plural(canvas.screens, 'screen')} · {plural(canvas.pages, 'page')}
              </span>
              <span className="w-[92px] text-[12.5px] whitespace-nowrap text-muted">
                {relativeTime(canvas.updatedAt)}
              </span>
            </RowLink>
          </WithActions>
        )
      })}
    </Panel>
  )
}

function SystemCard({ project }: { project: ProjectInfo }) {
  const system = project.system
  if (!system) {
    return (
      <Panel>
        <PanelHead title="Design system" />
        <PanelBody>
          <span className="text-[13px] text-muted">
            No design system yet. Ask your agent to build one from the codebase, or run <Mono>design system init</Mono>.
          </span>
        </PanelBody>
      </Panel>
    )
  }
  return (
    <Panel>
      <PanelHead title="Design system" right={<ButtonLink to="/system">Open</ButtonLink>} />
      <PanelBody gap={6}>
        <span className="text-[15px] font-semibold">{system.name}</span>
        {system.description ? <span className="text-[13px] text-ink2">{system.description}</span> : null}
      </PanelBody>
      <KV label="Tokens" labelWidth={120}>
        <Count value={system.tokens} />
      </KV>
      <KV label="Components" labelWidth={120}>
        <Count value={system.components} />
      </KV>
      <KV label="Guidelines" labelWidth={120}>
        <Count value={system.guidelines} />
      </KV>
      {system.issues ? (
        <KV label="Problems" labelWidth={120}>
          <Badge tone="danger">{system.issues}</Badge>
        </KV>
      ) : null}
    </Panel>
  )
}

export function HomePage() {
  const { data: project, error, isLoading } = useProject()
  const { slots } = useViewer()
  if (error) return <Notice title="Could not load the project" text={(error as Error).message} />
  if (isLoading || !project) return null
  return (
    <Content>
      <PageHead
        title={project.name}
        right={slots.homeActions}
        sub={
          project.static ? (
            `Snapshot built with foss-design ${project.version}`
          ) : (
            <Mono size={12.5}>{project.root}/.design</Mono>
          )
        }
      />
      <IssuesPanel issues={project.issues} title="Problems in design.json" />
      <div
        className="grid items-start gap-5 max-lg:grid-cols-1!"
        style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}
      >
        <CanvasList project={project} />
        <SystemCard project={project} />
      </div>
      {slots.homeAfter}
    </Content>
  )
}
