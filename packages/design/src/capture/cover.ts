import fs from 'node:fs'
import { DesignProject } from '../core/project'
import { DEV_URLS } from '../core/sources'
import { SnapshotStore } from '../server/snapshots'
import { findChrome, launchChrome, openFrame } from './chrome'
import { canvasFrames } from './frames'

/** Snapshots are this wide at most, as the viewer takes them. */
const SNAPSHOT_WIDTH = 900

/**
 * The screen that pictures each canvas (canvas.json `cover`, else the first screen) gets a fresh
 * snapshot when it has none or its file changed since: a pushed canvas then shows a current
 * picture even when nobody opened it in the viewer. Needs Chrome and the preview server (`base`
 * starts it); without Chrome nothing happens. Returns lines worth telling the user.
 */
export async function refreshCovers(
  paths: DesignProject['paths'],
  canvasIds: readonly string[],
  base: () => Promise<string>,
): Promise<string[]> {
  const store = new SnapshotStore(paths.snapshots)
  const project = new DesignProject(paths, DEV_URLS, store.lookup)
  const stale: { canvas: string; screen: string }[] = []
  for (const id of canvasIds) {
    const canvas = project.canvas(id)
    if (!canvas || (canvas.doc.cover && 'url' in canvas.doc.cover)) continue
    const screen = canvas.doc.cover?.screen ?? canvas.screens[0]?.id
    const source = canvas.screens.find((item) => item.id === screen)
    if (!screen || !source || !fs.existsSync(source.file)) continue
    const taken = store.version(id, screen, 'light')
    if (!taken || taken < fs.statSync(source.file).mtimeMs) stale.push({ canvas: id, screen })
  }
  if (!stale.length) return []
  if (!findChrome()) return ['No Chrome here, so canvas covers keep their last snapshot.']

  const url = await base()
  const browser = await launchChrome()
  const lines: string[] = []
  try {
    for (const { canvas, screen } of stale) {
      const doc = project.canvas(canvas)!.doc
      const job = canvasFrames(doc, url, 'light', { id: screen })[0]
      if (!job) continue
      const page = await browser.newPage({
        viewport: { width: job.width, height: job.height },
        deviceScaleFactor: Math.min(1, SNAPSHOT_WIDTH / job.width),
      })
      try {
        const report = await openFrame(page, job.url, { waitForReady: job.waitForReady })
        if (!report.ready) {
          lines.push(`${canvas}: ${screen} did not finish rendering, so its cover keeps the last snapshot`)
          continue
        }
        const png = await page.screenshot({ fullPage: job.fullPage })
        const height = job.fullPage ? await page.evaluate(() => document.documentElement.scrollHeight) : undefined
        store.save(canvas, screen, 'light', png, height)
      } finally {
        await page.close().catch(() => {})
      }
    }
  } finally {
    await browser.close()
  }
  return lines
}
