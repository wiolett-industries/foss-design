import type { CanvasDoc, CanvasItem, CanvasPage as Page, Theme } from '@shared/types'
import { Link, useLocation } from 'wouter'
import { SearchButton } from '../../components/search-button'
import { ThemeMenu } from '../../components/theme-menu'
import { Bar } from '../../components/topbar'
import { Mark } from '../../components/wordmark'
import { copyText } from '../../lib/copy'
import { reloadFrame } from '../../lib/frames'
import { useStore } from '../../lib/store'
import { useViewer } from '../../lib/viewer'
import { Button, IconButton } from '../../ui/button'
import { Segmented } from '../../ui/choice'
import { Icon } from '../../ui/icon'
import { Menu, MenuItem, MenuLabel } from '../../ui/menu'
import { Kbd } from '../../ui/text'
import { Tooltip } from '../../ui/tooltip'
import { useOpenUrl } from './full-page'
import { pageHref } from './sidebar'
import type { ViewStore } from './view-state'

/** The canvas page's top bar: the canvas and its pages, screen theme, inspect and play. */
export function CanvasBar({
  canvas,
  page,
  theme,
  onTheme,
  sidebar,
  onSidebar,
  onPlay,
  canPlay,
  inspect,
  onInspect,
}: {
  canvas: CanvasDoc
  page: Page | undefined
  theme: Theme
  onTheme(theme: Theme): void
  sidebar: boolean
  onSidebar(value: boolean): void
  onPlay(): void
  canPlay: boolean
  inspect: boolean
  onInspect(value: boolean): void
}) {
  const [, navigate] = useLocation()
  const { slots, scope } = useViewer()
  return (
    <>
      <Bar>
        {slots.barStart}
        {slots.brand ? (
          slots.brand
        ) : scope ? (
          <Mark />
        ) : (
          <Tooltip content="All canvases">
            <Link href="/" className="flex items-center" aria-label="All canvases">
              <Mark />
            </Link>
          </Tooltip>
        )}
        <IconButton
          icon="panel-left"
          label={sidebar ? 'Hide sidebar (⌘\\)' : 'Show sidebar (⌘\\)'}
          onClick={() => onSidebar(!sidebar)}
        />
        <div className="flex min-w-0 items-center gap-1.5 text-[14px]">
          <span className="truncate font-semibold">{canvas.title}</span>
          {page && canvas.pages.length > 1 ? (
            <>
              <Icon name="chevron-right" size={14} className="shrink-0 text-muted" />
              <Menu
                width={240}
                trigger={
                  <button
                    type="button"
                    className="flex h-ctrl cursor-pointer items-center gap-1 rounded-[6px] border-0 bg-transparent px-2 text-[14px] text-ink2 hover:bg-soft2"
                  >
                    <span className="truncate">{page.title}</span>
                    <Icon name="chevron-down" size={14} className="text-muted" />
                  </button>
                }
              >
                <MenuLabel>Pages</MenuLabel>
                {canvas.pages.map((p) => (
                  <MenuItem key={p.id} active={p.id === page.id} onSelect={() => navigate(pageHref(canvas, p))}>
                    <Icon name="file" size={15} className="text-muted" />
                    {p.title}
                  </MenuItem>
                ))}
              </Menu>
            </>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            label="Screen theme"
            value={theme}
            onChange={onTheme}
            items={[
              { value: 'light', label: <Icon name="sun" size={15} />, title: 'Light screens' },
              { value: 'dark', label: <Icon name="moon" size={15} />, title: 'Dark screens' },
            ]}
          />
          <InspectToggle on={inspect} onChange={onInspect} />
          <Button kind="secondary" icon="play" onClick={onPlay} disabled={!canPlay}>
            Play
          </Button>
          <SearchButton width={200} label="Search" />
          <ThemeMenu />
          {slots.barEnd}
        </div>
      </Bar>
      {slots.belowBar}
    </>
  )
}

/** The selected item's name and actions, floating over the bottom of the canvas. */
export function SelectionBar({
  canvas,
  store,
  layoutItems,
  theme,
  onPlay,
  inspect,
}: {
  canvas: CanvasDoc
  store: ViewStore
  layoutItems: CanvasItem[]
  theme: Theme
  onPlay(id: string): void
  inspect: boolean
}) {
  const selected = useStore(store, (state) => state.selected)
  const active = useStore(store, (state) => state.active)
  const status = useStore(store, (state) => (selected ? state.frames[selected] : undefined))
  const item = layoutItems.find((i) => i.id === selected)
  const openUrl = useOpenUrl(canvas.id, item?.kind === 'screen' || item?.kind === 'url' ? item : undefined, theme)
  if (!item) return null
  const frame = item.kind === 'screen' || item.kind === 'url'
  const reload = () =>
    reloadFrame(document.querySelector<HTMLIFrameElement>(`[data-item="${CSS.escape(item.id)}"] iframe`))
  const errors = status?.errors ?? []
  return (
    <div data-ui className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-col overflow-hidden rounded-[10px] border border-rule bg-surface shadow-pop animate-[q-pop_120ms_ease-out]">
        {errors.length ? (
          <div className="flex max-h-40 items-start gap-2 overflow-y-auto border-b border-rule bg-danger-soft px-3.5 py-2 font-mono text-[12px] whitespace-pre-wrap text-danger-text">
            <Icon name="alert" size={14} className="mt-px" />
            <span className="min-w-0">{errors.join('\n')}</span>
          </div>
        ) : null}
        <div className="flex h-[44px] items-center gap-1 pr-1.5 pl-3.5">
          <div className="flex min-w-0 items-center gap-2 pr-2">
            <span className="truncate text-[13.5px] font-medium">{item.title || item.id}</span>
            {frame && active === item.id ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                <Icon name="pointer" size={13} /> {inspect ? 'Inspecting' : 'Interacting'} <Kbd>esc</Kbd>
              </span>
            ) : frame ? (
              <span className="shrink-0 text-[12px] text-muted">
                {inspect ? 'Click an element to inspect it' : 'Click the screen to interact'}
              </span>
            ) : null}
          </div>
          {frame ? (
            <Tooltip
              content={
                <span className="flex items-center gap-1.5">
                  Play <Kbd>↵</Kbd>
                </span>
              }
            >
              <IconButton icon="play" label="Play" onClick={() => onPlay(item.id)} />
            </Tooltip>
          ) : null}
          {openUrl ? (
            <Tooltip content="Open in a new tab">
              <a
                href={openUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in a new tab"
                className="inline-flex h-ctrl w-ctrl items-center justify-center rounded-[6px] text-muted hover:bg-soft2 hover:text-ink2"
              >
                <Icon name="external" size={16} />
              </a>
            </Tooltip>
          ) : null}
          {frame ? (
            <Tooltip content="Reload">
              <IconButton icon="refresh" label="Reload" onClick={reload} />
            </Tooltip>
          ) : null}
          {item.kind === 'screen' ? (
            <Tooltip content="Copy source path">
              <IconButton
                icon="copy"
                label="Copy source path"
                onClick={() => void copyText(item.file, 'Path copied')}
              />
            </Tooltip>
          ) : null}
          <Tooltip
            content={
              <span className="flex items-center gap-1.5">
                Zoom to <Kbd>⇧2</Kbd>
              </span>
            }
          >
            <IconButton
              icon="fit"
              label="Zoom to"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('design:focus', { detail: { canvas: canvas.id, item: item.id } }))
              }
            />
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

/** The inspect mode switch: a button that stays pressed while on. */
export function InspectToggle({ on, onChange }: { on: boolean; onChange(value: boolean): void }) {
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-1.5">
          Inspect elements <Kbd>I</Kbd>
        </span>
      }
    >
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        className={
          on
            ? 'inline-flex h-ctrl cursor-pointer items-center gap-1.5 rounded-[6px] border border-action-line bg-action-soft px-ctrl text-ctrl font-medium text-action'
            : 'inline-flex h-ctrl cursor-pointer items-center gap-1.5 rounded-[6px] border border-rule-strong bg-surface px-ctrl text-ctrl font-medium text-ink hover:bg-soft'
        }
      >
        <Icon name="pointer" size={15} />
        Inspect
      </button>
    </Tooltip>
  )
}
