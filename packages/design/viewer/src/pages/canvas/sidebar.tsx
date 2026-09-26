import type { CanvasDoc, CanvasItem, CanvasPage } from '@shared/types'
import { Link } from 'wouter'
import { cn } from '../../lib/cn'
import { useStore } from '../../lib/store'
import { Count } from '../../ui/badge'
import { Icon, type IconName } from '../../ui/icon'
import type { ViewStore } from './view-state'

function itemIcon(item: CanvasItem): IconName {
  if (item.kind === 'note') return 'note'
  if (item.kind === 'image') return 'image'
  if (item.kind === 'url') return 'globe'
  return item.frame.width < 600 ? 'smartphone' : item.frame.width < 1100 ? 'tablet' : 'monitor'
}

export function pageHref(canvas: CanvasDoc, page: CanvasPage) {
  return `/c/${encodeURIComponent(canvas.id)}/p/${encodeURIComponent(page.id)}`
}

/** Pages of the canvas and the items on the current one. */
export function Sidebar({
  canvas,
  page,
  store,
  onPick,
}: {
  canvas: CanvasDoc
  page: CanvasPage
  store: ViewStore
  onPick(id: string): void
}) {
  const selected = useStore(store, (state) => state.selected)
  const errors = useStore(store, (state) => state.frames)
  return (
    <aside data-ui className="flex w-[264px] shrink-0 flex-col overflow-hidden border-r border-rule bg-surface">
      <div className="flex flex-col gap-1 border-b border-rule px-4 py-3.5">
        <div className="truncate text-[14px] font-semibold">{canvas.title}</div>
        {canvas.description ? (
          <div className="line-clamp-3 text-[12.5px] leading-[1.45] text-muted">{canvas.description}</div>
        ) : null}
      </div>
      <div className="min-h-0 grow overflow-y-auto pb-4">
        {canvas.pages.length > 1 ? (
          <>
            <div className="px-4 pt-3 pb-1 text-[12px] text-muted">Pages</div>
            <nav className="flex flex-col gap-0.5 px-2">
              {canvas.pages.map((p) => {
                const count = p.sections.reduce(
                  (sum, s) => sum + s.items.filter((i) => i.kind === 'screen' || i.kind === 'url').length,
                  0,
                )
                return (
                  <Link
                    key={p.id}
                    href={pageHref(canvas, p)}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-[6px] px-2.5 text-[13.5px] no-underline transition-colors focus-visible:outline-offset-[-2px]',
                      p.id === page.id ? 'bg-soft2 font-medium text-ink' : 'text-ink2 hover:bg-soft2',
                    )}
                  >
                    <Icon name="file" size={15} className="text-muted" />
                    <span className="min-w-0 grow truncate">{p.title}</span>
                    <span className="text-[12px] text-muted tabular">{count}</span>
                  </Link>
                )
              })}
            </nav>
          </>
        ) : null}
        <div className="px-4 pt-3 pb-1 text-[12px] text-muted">{canvas.pages.length > 1 ? page.title : 'Layers'}</div>
        <div className="flex flex-col px-2">
          {page.sections.map((section) => (
            <div key={section.id} className="flex flex-col">
              {section.title ? (
                <div className="flex h-7 items-center gap-2 px-2.5 pt-1 text-[12px] font-medium text-ink2">
                  <span className="truncate">{section.title}</span>
                  <Count value={section.items.length} />
                </div>
              ) : null}
              {section.items.map((item) => {
                const hasErrors = (errors[item.id]?.errors.length ?? 0) > 0 || (item.kind === 'screen' && item.missing)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onPick(item.id)}
                    className={cn(
                      'flex h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] border-0 px-2.5 text-left text-[13px] transition-colors focus-visible:outline-offset-[-2px]',
                      section.title && 'pl-4',
                      selected === item.id ? 'bg-action-soft text-ink' : 'bg-transparent text-ink2 hover:bg-soft2',
                    )}
                  >
                    <Icon name={itemIcon(item)} size={15} className="text-muted" />
                    <span className="min-w-0 grow truncate">
                      {item.title || (item.kind === 'note' ? 'Note' : item.id)}
                    </span>
                    {hasErrors ? <span className="size-[7px] shrink-0 rounded-full bg-danger" /> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
