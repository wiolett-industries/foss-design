import { DEVICES } from '@shared/devices'
import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'
import { useStore } from '../../lib/store'
import { isFrame, type Layout, type Placed } from './layout'
import type { ViewStore } from './view-state'

const at = (placed: Placed): CSSProperties =>
  ({ '--x': placed.x, '--y': placed.y, '--w': placed.w, '--h': placed.h }) as CSSProperties

function deviceLabel(placed: Placed): string {
  const item = placed.item
  if (item.kind !== 'screen' && item.kind !== 'url') return ''
  const device = item.frame.device ? DEVICES[item.frame.device as keyof typeof DEVICES]?.label : undefined
  const size = `${item.frame.width} × ${item.frame.height === 'auto' ? 'auto' : item.frame.height}`
  return device ? `${device} · ${size}` : size
}

function Label({ placed, store }: { placed: Placed; store: ViewStore }) {
  const id = placed.item.id
  const selected = useStore(store, (state) => state.selected === id)
  const errors = useStore(store, (state) => state.frames[id]?.errors.length ?? 0)
  return (
    <div
      data-at=""
      data-label={id}
      style={at(placed)}
      className={cn(
        'frame-label pointer-events-auto flex cursor-default items-center gap-1.5 overflow-hidden pb-1.5 text-[12.5px] leading-none whitespace-nowrap select-none',
        selected ? 'text-ink' : 'text-muted hover:text-ink2',
      )}
    >
      {errors ? <span className="size-[7px] shrink-0 rounded-full bg-danger" title={`${errors} errors`} /> : null}
      <span className={cn('min-w-[3ch] truncate', selected ? 'font-semibold' : 'font-medium')}>
        {placed.item.title}
      </span>
      <span className="frame-device min-w-0 shrink-[20] truncate text-[11.5px] text-muted opacity-80">
        {deviceLabel(placed)}
      </span>
    </div>
  )
}

function Outline({ placed, kind }: { placed: Placed; kind: 'selected' | 'active' | 'hover' }) {
  return (
    <div
      data-at=""
      style={at(placed)}
      className={cn(
        'frame-outline rounded-[1px]',
        kind === 'hover' ? 'outline outline-[1.5px] outline-action/60' : 'outline-2 outline-action outline',
      )}
    />
  )
}

/** Labels and outlines drawn in screen space so they stay crisp at every zoom. */
export function Overlay({
  layout,
  store,
  overlayRef,
}: {
  layout: Layout
  store: ViewStore
  overlayRef: React.RefObject<HTMLDivElement | null>
}) {
  const selected = useStore(store, (state) => state.selected)
  const active = useStore(store, (state) => state.active)
  const hovered = useStore(store, (state) => state.hovered)
  const tiny = useStore(store, (state) => state.zoomTiny)
  const frames = layout.items.filter((placed) => isFrame(placed.item))
  const find = (id: string | null) => (id ? layout.items.find((placed) => placed.item.id === id) : undefined)
  const selectedPlaced = find(selected)
  const hoveredPlaced = hovered && hovered !== selected ? find(hovered) : undefined
  return (
    <div ref={overlayRef} className="canvas-overlay" data-tiny={tiny}>
      {frames.map((placed) => (
        <Label key={placed.item.id} placed={placed} store={store} />
      ))}
      {hoveredPlaced ? <Outline placed={hoveredPlaced} kind="hover" /> : null}
      {selectedPlaced ? <Outline placed={selectedPlaced} kind={active === selected ? 'active' : 'selected'} /> : null}
    </div>
  )
}
