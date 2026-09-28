import { boardKey, drawingGroups, markupKey } from '@shared/drawings'
import type { ScreenItem, Theme } from '@shared/types'
import { useEffect, useMemo } from 'react'
import { useCanvas } from '../../lib/api'
import type { DrawingClient } from '../../lib/drawings'
import { noDrawings, useDrawing, useDrawingClient } from '../../lib/drawings'
import { useStore } from '../../lib/store'
import { NotFound } from '../not-found'
import { DrawingSurface } from './drawing/editor'
import { StrokeList } from './drawing/strokes'
import { type FrameEvents, FrameItem } from './items'
import { itemSize, type Placed } from './layout'
import { MARKUP_SIZES } from './markup'
import { createViewState } from './view-state'

/**
 * Pages `design shot --board` and `--markup` take pictures of: a page's idea board, one picture per
 * group of strokes cropped to it, and a screen with its markup on top. Each sets
 * `window.__DESIGN_DRAWING_READY__` once its drawings arrived (and the screen reported ready), and
 * puts the page's size in `window.__DESIGN_DRAWING_SIZE__` and the number of pictures in
 * `window.__DESIGN_DRAWING_PARTS__`.
 */

/** Room around a board's drawing in its picture. */
const CROP_PAD = 48

/** `?max=<px>`: the longest side a picture may have; 0 (or none) keeps its own size. */
const MAX_SIDE = Math.max(0, Math.floor(Number(new URLSearchParams(window.location.search).get('max')) || 0))

/**
 * How many pixels a board's unit takes in its picture: small sketches grow to about 1000 px across
 * (at most twice their size) so their text reads, big ones shrink to 3200 px at most, and none is
 * longer than MAX_SIDE when that is set.
 */
function boardScale(side: number): number {
  const scale = side < 1000 ? Math.min(2, 1000 / side) : 1
  const limit = MAX_SIDE ? Math.min(MAX_SIDE, 3200) : 3200
  return side * scale > limit ? limit / side : scale
}

/** A screen's picture is its frame's size, shrunk to MAX_SIDE when that is set. */
const screenScale = (w: number, h: number) => (MAX_SIDE && w && h ? Math.min(1, MAX_SIDE / Math.max(w, h)) : 1)

declare global {
  interface Window {
    __DESIGN_DRAWING_READY__?: boolean
    __DESIGN_DRAWING_SIZE__?: { width: number; height: number }
    __DESIGN_DRAWING_PARTS__?: number
  }
}

function useReadySignal(ready: boolean, width = 0, height = 0, parts = 1) {
  useEffect(() => {
    if (!ready) return
    window.__DESIGN_DRAWING_SIZE__ = width && height ? { width, height } : undefined
    window.__DESIGN_DRAWING_PARTS__ = parts
    // Two frames: the strokes are painted before the picture is taken.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.__DESIGN_DRAWING_READY__ = true
      }),
    )
    return () => cancelAnimationFrame(frame)
  }, [ready, width, height, parts])
}

export function BoardCapture({ canvasId, pageId }: { canvasId: string; pageId: string }) {
  const client = useDrawingClient(canvasId)
  const ready = useStore(client?.store ?? noDrawings, (state) => state.ready)
  if (!client) return null
  return <BoardPicture client={client} pageId={pageId} ready={ready} />
}

/** One picture per group of strokes (see drawingGroups), stacked: `design shot` takes each `[data-part]`. */
function BoardPicture({ client, pageId, ready }: { client: DrawingClient; pageId: string; ready: boolean }) {
  const { drawing } = useDrawing(client, boardKey(pageId))
  const parts = useMemo(
    () =>
      drawingGroups(drawing?.strokes ?? []).map(({ box, strokes }) => {
        const crop = { x: box.x - CROP_PAD, y: box.y - CROP_PAD, w: box.w + CROP_PAD * 2, h: box.h + CROP_PAD * 2 }
        const scale = boardScale(Math.max(crop.w, crop.h))
        return { crop, strokes, width: Math.ceil(crop.w * scale), height: Math.ceil(crop.h * scale) }
      }),
    [drawing],
  )
  const width = Math.max(0, ...parts.map((part) => part.width))
  const height = parts.reduce((sum, part) => sum + part.height, 0)
  useReadySignal(ready, width, height, parts.length)
  return (
    <div className="flex flex-col items-start">
      {parts.map((part, i) => (
        <div
          key={part.strokes[0]!.id}
          data-part={i}
          className="bg-surface"
          style={{ width: part.width, height: part.height }}
        >
          <svg
            viewBox={`${part.crop.x} ${part.crop.y} ${part.crop.w} ${part.crop.h}`}
            width={part.width}
            height={part.height}
            aria-hidden="true"
          >
            <StrokeList drawing={{ strokes: part.strokes, erased: [] }} />
          </svg>
        </div>
      ))}
    </div>
  )
}

const NO_EVENTS: FrameEvents = { onGo() {}, onLink() {}, onWheel() {}, onEscape() {} }

export function MarkupCapture({ canvasId, itemId }: { canvasId: string; itemId: string }) {
  const { data: canvas, error } = useCanvas(canvasId)
  const client = useDrawingClient(canvasId)
  const store = useMemo(() => createViewState(), [])
  const sizes = useStore(store, (state) => state.sizes)
  const found = useMemo(() => {
    for (const page of canvas?.pages ?? [])
      for (const section of page.sections)
        for (const item of section.items) if (item.id === itemId && item.kind === 'screen') return { item, section }
    return null
  }, [canvas, itemId])
  const frameReady = useStore(store, (state) => (found ? !!state.frames[found.item.id]?.ready : false))
  const drawingsReady = useStore(client?.store ?? noDrawings, (state) => state.ready)
  const size = found ? itemSize(found.item, sizes) : { w: 0, h: 0 }
  const scale = screenScale(size.w, size.h)
  useReadySignal(frameReady && drawingsReady, Math.round(size.w * scale), Math.ceil(size.h * scale))
  if (error) return <NotFound title="Canvas not found" text={(error as Error).message} />
  if (!canvas || !client) return null
  if (!found) return <NotFound title="Screen not found" text={`No screen "${itemId}" in "${canvasId}".`} />
  const param = new URLSearchParams(window.location.search).get('theme')
  const theme: Theme = param === 'dark' || param === 'light' ? param : (canvas.theme ?? 'light')
  const placed = { item: found.item, section: found.section, x: 0, y: 0, w: size.w, h: size.h } as Placed & {
    item: ScreenItem
  }
  // The screen lays out at its own size; a smaller picture scales all of it, markup included.
  return (
    <div className="overflow-hidden" style={{ width: size.w * scale, height: size.h * scale }}>
      <div
        className="relative origin-top-left"
        style={{ width: size.w, height: size.h, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        <FrameItem placed={placed} mode="live" thumb={false} theme={theme} store={store} events={NO_EVENTS} capture />
        <div className="absolute inset-0">
          <DrawingSurface
            client={client}
            drawingKey={markupKey(itemId)}
            width={size.w}
            height={size.h}
            sizes={MARKUP_SIZES}
            className="h-full w-full overflow-visible"
          />
        </div>
      </div>
    </div>
  )
}
