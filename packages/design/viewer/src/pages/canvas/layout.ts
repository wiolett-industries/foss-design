import type { CanvasItem, CanvasPage, CanvasSection } from '@shared/types'
import type { Rect } from './camera'

export interface Placed extends Rect {
  item: CanvasItem
  section: CanvasSection
}

export interface PlacedSection extends Rect {
  section: CanvasSection
  /** Height of the title/description block above the row. */
  header: number
}

export interface Layout {
  items: Placed[]
  sections: PlacedSection[]
  bounds: Rect
}

/** Measured sizes: auto-height frames, notes, section headers, images. Keyed by item id or `section:<id>`. */
export type Sizes = Record<string, { w?: number; h: number }>

const SECTION_GAP = 280
const ITEM_GAP = 96
const ROW_GAP = 150
const HEADER_GAP = 110
const HEADER_MIN_WIDTH = 720

export const isFrame = (item: CanvasItem) => item.kind === 'screen' || item.kind === 'url'

export function itemSize(item: CanvasItem, sizes: Sizes): { w: number; h: number } {
  const measured = sizes[item.id]
  if (item.kind === 'screen' || item.kind === 'url') {
    const w = item.frame.width
    if (item.frame.height !== 'auto') return { w, h: item.frame.height }
    const fallback = item.kind === 'screen' ? item.measuredHeight : undefined
    return { w, h: measured?.h ?? fallback ?? 900 }
  }
  if (item.kind === 'note')
    return { w: item.width, h: measured?.h ?? Math.max(80, Math.ceil(item.text.length / 38) * 26 + 40) }
  const w = item.width ?? measured?.w ?? 480
  const h = measured?.w ? (measured.h / measured.w) * w : (measured?.h ?? w * 0.62)
  return { w, h }
}

function sectionHeaderHeight(section: CanvasSection, sizes: Sizes): number {
  if (!section.title && !section.description) return 0
  return sizes[`section:${section.id}`]?.h ?? (section.title ? 56 : 0) + (section.description ? 60 : 0)
}

/** Sections stack top to bottom; items run left to right, wrapping after `columns`. */
export function layoutPage(page: CanvasPage, sizes: Sizes): Layout {
  const items: Placed[] = []
  const sections: PlacedSection[] = []

  if (page.layout === 'free') {
    let cursor = 0
    for (const section of page.sections) {
      for (const item of section.items) {
        const { w, h } = itemSize(item, sizes)
        const x = item.x ?? cursor
        const y = item.y ?? 0
        cursor = Math.max(cursor, x + w + ITEM_GAP)
        items.push({ item, section, x, y, w, h })
      }
    }
  } else {
    let y = 0
    for (const section of page.sections) {
      const header = sectionHeaderHeight(section, sizes)
      const top = y
      let rowY = y + (header ? header + HEADER_GAP : 0)
      let x = 0
      let rowHeight = 0
      let width = 0
      let column = 0
      for (const item of section.items) {
        if (section.columns && column === section.columns) {
          rowY += rowHeight + ROW_GAP
          x = 0
          rowHeight = 0
          column = 0
        }
        const { w, h } = itemSize(item, sizes)
        items.push({ item, section, x, y: rowY, w, h })
        x += w + ITEM_GAP
        width = Math.max(width, x - ITEM_GAP)
        rowHeight = Math.max(rowHeight, h)
        column++
      }
      const bottom = rowY + rowHeight
      sections.push({
        section,
        x: 0,
        y: top,
        w: Math.max(width, header ? HEADER_MIN_WIDTH : 0),
        h: bottom - top,
        header,
      })
      y = bottom + SECTION_GAP
    }
  }

  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  const all: Rect[] = [...items, ...sections]
  if (all.length) {
    minX = Math.min(...all.map((r) => r.x))
    minY = Math.min(...all.map((r) => r.y))
    maxX = Math.max(...all.map((r) => r.x + r.w))
    maxY = Math.max(...all.map((r) => r.y + r.h))
  }
  return { items, sections, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } }
}

/** Frames in reading order, for arrow-key stepping and play mode. */
export function frameOrder(layout: Layout): Placed[] {
  return layout.items.filter((placed) => isFrame(placed.item))
}
