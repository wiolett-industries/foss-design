import type { CanvasDoc, CanvasItem, ScreenItem, SystemDoc, Theme, UrlItem } from '../shared/types'

/** One frame to load in Chrome: a canvas screen, a url item or a system specimen. */
export interface FrameJob {
  /** `canvas/id`. */
  key: string
  canvas: string
  id: string
  page?: string
  url: string
  width: number
  height: number
  /** Auto-height frames are shot full page. */
  fullPage: boolean
  /** Theme the frame renders in (a pinned screen theme wins over the requested one). */
  theme: Theme
  /** Frames without the runtime (url items) never signal ready. */
  waitForReady: boolean
}

const AUTO_VIEWPORT_HEIGHT = 900

function withTheme(url: string, theme: Theme): string {
  return `${url}${url.includes('?') ? '&' : '?'}theme=${theme}`
}

function absolute(base: string, url: string): string {
  return /^https?:\/\//.test(url) ? url : `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

export function frameJob(
  base: string,
  canvas: string,
  page: string,
  item: ScreenItem | UrlItem,
  theme: Theme,
): FrameJob {
  const auto = item.frame.height === 'auto'
  const pinned = item.kind === 'screen' ? item.theme : undefined
  const effective = pinned ?? theme
  return {
    key: `${canvas}/${item.id}`,
    canvas,
    id: item.id,
    page,
    url: item.kind === 'url' ? item.url : withTheme(absolute(base, item.url), effective),
    width: item.frame.width,
    height: auto ? AUTO_VIEWPORT_HEIGHT : (item.frame.height as number),
    fullPage: auto,
    theme: effective,
    waitForReady: item.kind === 'screen',
  }
}

export function isFrameItem(item: CanvasItem): item is ScreenItem | UrlItem {
  return item.kind === 'screen' || item.kind === 'url'
}

/** Frames of a canvas, optionally narrowed to one page or one screen id. */
export function canvasFrames(
  doc: CanvasDoc,
  base: string,
  theme: Theme,
  filter: { page?: string; id?: string; includeUrls?: boolean; skipMissing?: boolean } = {},
): FrameJob[] {
  const jobs: FrameJob[] = []
  for (const page of doc.pages) {
    if (filter.page && page.id !== filter.page) continue
    for (const section of page.sections) {
      for (const item of section.items) {
        if (!isFrameItem(item)) continue
        if (filter.id && item.id !== filter.id) continue
        if (item.kind === 'url' && filter.includeUrls === false) continue
        if (item.kind === 'screen' && item.missing && filter.skipMissing !== false) continue
        jobs.push(frameJob(base, doc.id, page.id, item, theme))
      }
    }
  }
  return jobs
}

/** Component specimens and the typography page. */
export function systemFrames(doc: SystemDoc, base: string, theme: Theme): FrameJob[] {
  const specimens = doc.components.map((component) => ({ id: component.id, url: component.url }))
  if (doc.typographyUrl) specimens.push({ id: '@typography', url: doc.typographyUrl })
  return specimens.map(({ id, url }) => ({
    key: `@system/${id}`,
    canvas: '@system',
    id,
    url: withTheme(absolute(base, url), theme),
    width: 1200,
    height: 800,
    fullPage: true,
    theme,
    waitForReady: true,
  }))
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order in the result. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
