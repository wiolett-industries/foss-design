import fs from 'node:fs'
import os from 'node:os'
import type { Progress } from '../cli/log'
import { DesignProject } from '../core/project'
import { DEV_URLS } from '../core/sources'
import { SnapshotStore, sourceHash } from '../server/snapshots'
import type { CanvasDoc, Theme } from '../shared/types'
import { serveBuild } from './build-server'
import { findChrome, launchChrome, openFrame } from './chrome'
import { canvasFrames, mapLimit } from './frames'

/** Snapshots are this wide at most, as the viewer takes them. */
const SNAPSHOT_WIDTH = 900
/** Pages Chrome renders at once: one per core but one, two to eight. */
const TABS = Math.min(8, Math.max(2, os.availableParallelism() - 1))
const THEMES: Theme[] = ['light', 'dark']

export interface SnapshotTarget {
  canvas: string
  screen: string
  theme: Theme
  /** Hash of the screen's file now, recorded with the snapshot. */
  source: string | null
}

/**
 * The snapshots `canvasIds` lack: every screen in both themes (one, when the screen pins its
 * theme), missing or taken from other content than the screen's file has now. The viewer shows them for frames that are not
 * running, and a pushed canvas carries them, so the cloud shows the right theme from far away too.
 */
export function staleSnapshots(
  paths: DesignProject['paths'],
  canvasIds: readonly string[],
  filter: { page?: string; screens?: ReadonlySet<string> } = {},
): SnapshotTarget[] {
  const store = new SnapshotStore(paths.snapshots)
  const project = new DesignProject(paths, DEV_URLS, store.lookup)
  const stale: SnapshotTarget[] = []
  for (const id of canvasIds) {
    const canvas = project.canvas(id)
    if (!canvas) continue
    // A screen that pins its theme renders in it whatever the canvas asks for.
    const inLight = canvasFrames(canvas.doc, '', 'light', { page: filter.page, includeUrls: false })
    const inDark = new Map(
      canvasFrames(canvas.doc, '', 'dark', { page: filter.page, includeUrls: false }).map((job) => [job.id, job.theme]),
    )
    const files = new Map(canvas.screens.map((screen) => [screen.id, screen.file]))
    for (const job of inLight) {
      if (filter.screens && !filter.screens.has(job.id)) continue
      const file = files.get(job.id)
      if (!file || !fs.existsSync(file)) continue
      const hash = sourceHash(file)
      const pinned = inDark.get(job.id) === job.theme
      const themes = pinned ? [job.theme] : THEMES
      for (const theme of themes) {
        if (!store.version(id, job.id, theme)) {
          stale.push({ canvas: id, screen: job.id, theme, source: hash })
          continue
        }
        const recorded = store.source(id, job.id, theme)
        // Taken before hashes were kept: it counts as the current content's rather than retaken.
        if (recorded === undefined) {
          if (hash) store.adopt(id, job.id, theme, hash)
        } else if (recorded !== hash) stale.push({ canvas: id, screen: job.id, theme, source: hash })
      }
    }
  }
  return stale
}

/**
 * Take `targets` in Chrome, a few tabs at a time, with `progress` counting them. The canvases are
 * built as `design push` builds them and served as files, so a frame loads its few bundles rather
 * than the dev server's module graph; when that build fails, the preview server (`preview`) serves
 * them instead. Returns lines worth telling the user; without Chrome nothing happens.
 */
export async function takeSnapshots(
  paths: DesignProject['paths'],
  targets: readonly SnapshotTarget[],
  preview: () => Promise<string>,
  progress: Progress,
): Promise<string[]> {
  if (!targets.length) return []
  if (!findChrome()) return ['No Chrome here, so screens keep the snapshots they have.']
  const store = new SnapshotStore(paths.snapshots)
  const project = new DesignProject(paths, DEV_URLS, store.lookup)
  const canvases = [...new Set(targets.map((target) => target.canvas))]
  progress.update(`Building ${canvases.join(', ')} to take snapshots from…`)
  let url: string
  let docOf = (id: string): CanvasDoc => project.canvas(id)!.doc
  let stop = async () => {}
  try {
    const build = await serveBuild(paths, 'snapshot-build', { canvases, includeSystem: false })
    url = build.base
    docOf = (id) => build.read<CanvasDoc>(`api/canvas/${id}.json`) ?? project.canvas(id)!.doc
    stop = build.close
  } catch {
    url = await preview()
  }
  const browser = await launchChrome()
  const failed: string[] = []
  const started = Date.now()
  let done = 0
  const line = () => `Snapshots ${done}/${targets.length} (both themes, as the viewer and the cloud show them)`
  progress.update(line())
  try {
    await mapLimit([...targets], TABS, async ({ canvas, screen, theme, source }) => {
      const job = canvasFrames(docOf(canvas), url, theme, { id: screen })[0]
      if (job) {
        const page = await browser.newPage({
          viewport: { width: job.width, height: job.height },
          deviceScaleFactor: Math.min(1, SNAPSHOT_WIDTH / job.width),
          colorScheme: theme,
        })
        try {
          const report = await openFrame(page, job.url, { waitForReady: job.waitForReady })
          if (report.ready) {
            const png = await page.screenshot({ fullPage: job.fullPage })
            const height = job.fullPage ? await page.evaluate(() => document.documentElement.scrollHeight) : undefined
            store.save(canvas, screen, theme, png, height, source)
          } else failed.push(`${canvas}/${screen} (${theme})`)
        } catch {
          failed.push(`${canvas}/${screen} (${theme})`)
        } finally {
          await page.close().catch(() => {})
        }
      }
      done++
      progress.update(line())
    })
  } finally {
    await browser.close()
    await stop()
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  progress.done(`Took ${targets.length - failed.length} snapshot${targets.length === 1 ? '' : 's'} in ${seconds}s`)
  if (!failed.length) return []
  const shown = failed.slice(0, 5).join(', ')
  return [
    `${failed.length} screen${failed.length === 1 ? '' : 's'} did not finish rendering, so they keep their last snapshot: ${shown}${failed.length > 5 ? ', …' : ''}. \`design check --render\` says why.`,
  ]
}
