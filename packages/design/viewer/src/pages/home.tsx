import type { CanvasSummary, ProjectInfo } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useRef } from 'react'
import { IssuesPanel } from '../components/issues'
import { useProject } from '../lib/api'
import { plural, relativeTime } from '../lib/format'
import { useIsPhone } from '../lib/phone'
import { useViewer } from '../lib/viewer'
import { Badge, Count } from '../ui/badge'
import { Button, ButtonLink } from '../ui/button'
import { Icon } from '../ui/icon'
import { Menu, MenuItem } from '../ui/menu'
import { Content, Notice, PageHead } from '../ui/page'
import { KV, Panel, PanelBody, PanelHead, RowLink } from '../ui/panel'
import { Skeleton, SkeletonRows } from '../ui/skeleton'
import { Mono, Two } from '../ui/text'
import { toast } from '../ui/toast'

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

/** The project icon beside its name, in the same tile as a canvas cover. */
function ProjectIcon({ src }: { src: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-rule bg-soft">
      <img src={src} alt="" className="size-full object-contain" />
    </span>
  )
}

/** Set or remove the project icon, where the source can change it (the local preview). */
function IconMenu({ project }: { project: ProjectInfo }) {
  const { source, keys } = useViewer()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  if (!source.setIcon || project.static) return null
  const apply = async (file: File | null) => {
    try {
      await source.setIcon!(file)
      await queryClient.invalidateQueries({ queryKey: keys.project })
      toast(
        file ? 'Icon set' : 'Icon removed',
        file ? 'Saved as .design/icon; a linked project takes it to the cloud on its next push or pull.' : undefined,
      )
    } catch (error) {
      toast('Could not change the icon', (error as Error).message, 'error')
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void apply(file)
        }}
      />
      <Menu trigger={<Button>Icon</Button>} align="end" width={240}>
        <MenuItem onSelect={() => input.current?.click()} hint="≤ 256 KB">
          <Icon name="upload" size={15} />
          {project.icon ? 'Replace icon' : 'Upload icon'}
        </MenuItem>
        {project.icon ? (
          <MenuItem danger onSelect={() => void apply(null)}>
            <Icon name="trash" size={15} />
            Remove icon
          </MenuItem>
        ) : null}
      </Menu>
    </>
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

/** The embedding app's strip under the canvas list. */
function Foot({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div className="flex items-center gap-2.5 border-t border-rule bg-soft px-4 py-3 text-[12.5px] text-muted">
      {children}
    </div>
  )
}

function CanvasList({ project }: { project: ProjectInfo }) {
  const { canvasRowActions: rowActions, canvasesFoot } = useViewer().slots
  const phone = useIsPhone()
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
        <Foot>{canvasesFoot}</Foot>
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
            {phone ? (
              <RowLink
                to={`/c/${encodeURIComponent(canvas.id)}`}
                cols="86px minmax(0,1fr)"
                align="ll"
                pad="10px 16px"
                minH={74}
                first={!!actions}
              >
                <Cover canvas={canvas} />
                <Two
                  top={canvas.title}
                  bottom={
                    <span className="flex min-w-0 items-center gap-2">
                      {canvas.issues ? <Badge tone="danger">{plural(canvas.issues, 'problem')}</Badge> : null}
                      <span className="truncate">
                        {plural(canvas.screens, 'screen')} · {relativeTime(canvas.updatedAt)}
                      </span>
                    </span>
                  }
                />
              </RowLink>
            ) : (
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
            )}
          </WithActions>
        )
      })}
      <Foot>{canvasesFoot}</Foot>
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
      <KV label="Tokens" labelWidth={120} end>
        <Count value={system.tokens} />
      </KV>
      <KV label="Components" labelWidth={120} end>
        <Count value={system.components} />
      </KV>
      <KV label="Guidelines" labelWidth={120} end>
        <Count value={system.guidelines} />
      </KV>
      {system.issues ? (
        <KV label="Problems" labelWidth={120} end>
          <Badge tone="danger">{system.issues}</Badge>
        </KV>
      ) : null}
    </Panel>
  )
}

/** The home page's shape while the project loads, so it fills in instead of popping in. */
function HomeSkeleton() {
  return (
    <Content>
      <div className="flex flex-col gap-2.5 pt-1 pb-1">
        <Skeleton className="h-6 w-[220px]" />
        <Skeleton className="h-3.5 w-[300px]" />
      </div>
      <div
        className="grid items-start gap-5 max-lg:grid-cols-1!"
        style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}
      >
        <Panel>
          <PanelHead title="Canvases" />
          <SkeletonRows rows={3} lead={86} minH={74} />
        </Panel>
        <Panel>
          <PanelHead title="Design system" />
          <SkeletonRows rows={3} lead={0} minH={40} />
        </Panel>
      </div>
    </Content>
  )
}

export function HomePage() {
  const { data: project, error, isLoading } = useProject()
  const { slots } = useViewer()
  const phone = useIsPhone()
  if (error) return <Notice title="Could not load the project" text={(error as Error).message} />
  if (isLoading || !project) return <HomeSkeleton />
  return (
    <Content>
      <PageHead
        title={
          project.icon ? (
            <span className="flex min-w-0 items-center gap-3">
              <ProjectIcon src={project.icon} />
              {project.name}
            </span>
          ) : (
            project.name
          )
        }
        // On a phone the actions (usually a ⋯ menu) sit at the end of the title row, not alone under it.
        right={phone ? undefined : (slots.homeActions ?? <IconMenu project={project} />)}
        badge={phone && slots.homeActions ? <span className="ml-auto flex">{slots.homeActions}</span> : undefined}
        sub={
          slots.homeSub ? (
            slots.homeSub
          ) : project.static ? (
            `Snapshot built with foss-design ${project.version}`
          ) : (
            <>
              <Mono size={12.5} wrap>
                {project.root}/.design
              </Mono>{' '}
              · foss-design {project.version}
            </>
          )
        }
      />
      <IssuesPanel issues={project.issues} title="Problems in design.json" />
      <div
        className="grid items-start gap-5 max-lg:grid-cols-1!"
        style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <CanvasList project={project} />
          {slots.canvasesAfter}
        </div>
        <SystemCard project={project} />
      </div>
      {slots.homeAfter}
    </Content>
  )
}
