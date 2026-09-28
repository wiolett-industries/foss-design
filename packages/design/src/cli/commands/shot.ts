import fs from 'node:fs'
import path from 'node:path'
import type { Browser } from 'playwright-core'
import { launchChrome, openFrame } from '../../capture/chrome'
import { canvasFrames, type FrameJob, mapLimit, systemFrames } from '../../capture/frames'
import { type DesignPaths, PKG } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { SYSTEM_CANVAS } from '../../core/system'
import { liveServer } from '../../server/state'
import type { Theme } from '../../shared/types'
import { CliError, dim, print, red, warn } from '../log'
import { drawn, readDrawings } from './drawings'
import { ensureServer } from './preview'

const OVERVIEW_TIMEOUT = 90000
const DRAWING_TIMEOUT = 45000

interface ShotOptions {
  page?: string
  theme?: Theme
  out?: string
  overview: boolean
  board?: boolean
  markup?: boolean
  /** Longest side of a board or markup picture in pixels; 0 keeps full size. */
  max?: number
}

/** What agents read comfortably: they downscale bigger pictures anyway, and pixels cost tokens. */
export const DRAWING_MAX_SIDE = 1280

export async function runShot(paths: DesignPaths, target: string, options: ShotOptions) {
  const [canvasId = '', screenId] = target.split('/')
  const project = new DesignProject(paths, DEV_URLS)
  if (canvasId === SYSTEM_CANVAS) {
    if (options.board || options.markup) throw new CliError('--board and --markup apply to canvases, not @system')
    return shootSystem(paths, project, screenId, options)
  }
  if (options.board && options.markup) throw new CliError('Take --board and --markup one at a time')
  if (options.max !== undefined && !options.board && !options.markup)
    throw new CliError('--max and --full size the pictures of --board and --markup')
  if (options.board && screenId)
    throw new CliError('Boards belong to pages: design shot <canvas> --board [--page <id>]')
  const canvas = project.canvas(canvasId)
  if (!canvas) {
    const known = project.canvasIds()
    throw new CliError(`No canvas "${canvasId}". Canvases: ${known.join(', ') || 'none yet'}`)
  }
  const { doc } = canvas
  if (options.page && !doc.pages.some((page) => page.id === options.page)) {
    throw new CliError(`No page "${options.page}" in "${canvasId}". Pages: ${doc.pages.map((p) => p.id).join(', ')}`)
  }
  const theme: Theme = options.theme ?? doc.theme ?? 'light'
  const outBase = path.resolve(options.out ?? paths.shots)
  const outDir = path.join(outBase, canvasId)
  fs.mkdirSync(outDir, { recursive: true })

  const base = await serverBase(paths)
  const browser = await launchChrome()
  let failed = false

  try {
    if (options.board || options.markup) {
      if (!fs.existsSync(PKG.viewer)) throw new CliError('The viewer is not built, so there are no drawings to shoot.')
      const drawingsFailed = await shootDrawings(browser, base, canvasId, outDir, theme, {
        board: !!options.board,
        page: options.page,
        screen: screenId,
        max: options.max ?? DRAWING_MAX_SIDE,
      })
      if (drawingsFailed) process.exitCode = 1
      return
    }
    if (options.overview) {
      if (!fs.existsSync(PKG.viewer)) throw new CliError('The viewer is not built, so there is no canvas to shoot.')
      const pages = options.page
        ? [options.page]
        : screenId
          ? doc.pages
              .filter((page) => page.sections.some((section) => section.items.some((item) => item.id === screenId)))
              .map((page) => page.id)
          : doc.pages.map((page) => page.id)
      for (const pageId of pages) {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } })
        const url = `${base}/c/${encodeURIComponent(canvasId)}?page=${encodeURIComponent(pageId)}&capture=1&theme=${theme}`
        await page.goto(url, { waitUntil: 'load' })
        try {
          await page.waitForFunction(
            () => (window as { __DESIGN_CANVAS_READY__?: boolean }).__DESIGN_CANVAS_READY__ === true,
            null,
            { timeout: OVERVIEW_TIMEOUT },
          )
        } catch {
          warn(`page "${pageId}": not every frame reported ready within ${OVERVIEW_TIMEOUT / 1000}s; shooting anyway`)
        }
        await page.waitForTimeout(400)
        const file = path.join(outDir, `${pageId}.overview.png`)
        await page.screenshot({ path: file })
        await page.close()
        print(file)
      }
      return
    }

    const jobs = canvasFrames(doc, base, theme, { page: options.page, id: screenId })
    if (!jobs.length) {
      throw new CliError(
        screenId
          ? `No screen "${screenId}" in "${canvasId}"${options.page ? ` on page "${options.page}"` : ''}.`
          : `Nothing to shoot in "${canvasId}"${options.page ? ` on page "${options.page}"` : ''}.`,
      )
    }
    failed = await shootFrames(browser, jobs, outDir)
  } finally {
    await browser.close()
  }
  if (failed) process.exitCode = 1
}

/**
 * Idea boards (`--board`) or screens with their markup (`--markup`), from the viewer's capture
 * pages: each board at its own size, each screen at its frame's. Without a page or screen named,
 * every one with something drawn on it. True when any could not be shot.
 */
async function shootDrawings(
  browser: Browser,
  base: string,
  canvasId: string,
  outDir: string,
  theme: Theme,
  want: { board: boolean; page?: string; screen?: string; max: number },
): Promise<boolean> {
  const port = Number(new URL(base).port)
  const { drawings, cloud } = await readDrawings(port, canvasId)
  if (cloud === 'offline' || cloud === 'connecting')
    warn('the cloud did not answer in time: these are the drawings on this machine')
  const found = drawn(drawings, want.board ? 'board' : 'markup')
  const named = want.board ? want.page : want.screen
  const ids = named ? [named] : [...found.keys()]
  if (!ids.length) {
    print(want.board ? `No idea board drawn on in "${canvasId}".` : `No screen marked up in "${canvasId}".`)
    return false
  }
  if (named && !found.has(named))
    print(dim(want.board ? `Nothing on the board of "${named}" yet.` : `No markup on "${named}" yet.`))
  let failed = false
  for (const id of ids) {
    const kind = want.board ? 'board' : 'markup'
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme })
    try {
      const url = `${base}/c/${encodeURIComponent(canvasId)}/${kind}/${encodeURIComponent(id)}?capture=1&theme=${theme}&max=${want.max}`
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForFunction(
        () => (window as { __DESIGN_DRAWING_READY__?: boolean }).__DESIGN_DRAWING_READY__ === true,
        null,
        { timeout: DRAWING_TIMEOUT },
      )
      // A board's pictures are cropped to what is drawn; a screen's is its frame's size.
      const size = await page.evaluate(
        () => (window as { __DESIGN_DRAWING_SIZE__?: { width: number; height: number } }).__DESIGN_DRAWING_SIZE__,
      )
      if (size?.width && size.height)
        await page.setViewportSize({ width: Math.round(size.width), height: Math.min(Math.round(size.height), 16000) })
      await page.waitForTimeout(200)
      if (!want.board) {
        const file = path.join(outDir, `${id}.markup.${theme}.png`)
        await page.screenshot({ path: file })
        print(file)
        continue
      }
      // One picture per group of strokes on the board, numbered when there are several.
      const parts = await page.evaluate(
        () => (window as { __DESIGN_DRAWING_PARTS__?: number }).__DESIGN_DRAWING_PARTS__ ?? 0,
      )
      for (let part = 0; part < parts; part++) {
        const file = path.join(outDir, parts > 1 ? `${id}.board.${part + 1}.${theme}.png` : `${id}.board.${theme}.png`)
        await page.locator(`[data-part="${part}"]`).screenshot({ path: file })
        print(file)
      }
    } catch (error) {
      failed = true
      print(`${red('✗')} ${canvasId}/${id}: ${(error as Error).message.split('\n')[0]}`)
    } finally {
      await page.close().catch(() => {})
    }
  }
  return failed
}

async function serverBase(paths: DesignPaths): Promise<string> {
  const wasRunning = await liveServer(paths)
  const server = await ensureServer(paths, {})
  if (!wasRunning) print(dim(`Started the preview server at ${server.url} (\`design stop\` stops it).`))
  return `http://127.0.0.1:${server.port}`
}

/** Shoot each frame into `<outDir>/<id>.<theme>.png`, print the paths; true when any frame had problems. */
async function shootFrames(browser: Browser, jobs: FrameJob[], outDir: string): Promise<boolean> {
  let failed = false
  const results = await mapLimit(jobs, 4, async (job) => {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height } })
    const file = path.join(outDir, `${job.id}.${job.theme}.png`)
    try {
      const report = await openFrame(page, job.url, { waitForReady: job.waitForReady })
      await page.screenshot({ path: file, fullPage: job.fullPage })
      return { file, errors: report.ready ? report.errors : ['did not finish rendering', ...report.errors] }
    } catch (error) {
      return { file: null, errors: [(error as Error).message.split('\n')[0]!] }
    } finally {
      await page.close().catch(() => {})
    }
  })
  results.forEach((result, index) => {
    const job = jobs[index]!
    if (result.file) print(result.file)
    else print(`${red('✗')} ${job.key}: no screenshot`)
    for (const error of result.errors) {
      failed = true
      print(`  ${red(`${job.key}:`)} ${error.split('\n')[0]}`)
    }
  })
  return failed
}

/** `design shot @system[/<component>]`: component specimens and the typography page. */
async function shootSystem(
  paths: DesignPaths,
  project: DesignProject,
  id: string | undefined,
  options: { page?: string; theme?: Theme; out?: string; overview: boolean },
) {
  const system = project.system()
  if (!system) throw new CliError('This project has no design system yet (.design/system).')
  if (options.overview || options.page) throw new CliError('--overview and --page apply to canvases, not @system')
  const theme: Theme = options.theme ?? 'light'
  const all = systemFrames(system.doc, 'http://placeholder', theme)
  if (id && !all.some((job) => job.id === id)) {
    throw new CliError(`No specimen "${id}" in the design system. Specimens: ${all.map((job) => job.id).join(', ')}`)
  }
  const outDir = path.join(path.resolve(options.out ?? paths.shots), SYSTEM_CANVAS)
  fs.mkdirSync(outDir, { recursive: true })
  const base = await serverBase(paths)
  const jobs = systemFrames(system.doc, base, theme).filter((job) => !id || job.id === id)
  const browser = await launchChrome()
  try {
    if (await shootFrames(browser, jobs, outDir)) process.exitCode = 1
  } finally {
    await browser.close()
  }
}
