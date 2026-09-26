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
import { ensureServer } from './preview'

const OVERVIEW_TIMEOUT = 90000

export async function runShot(
  paths: DesignPaths,
  target: string,
  options: { page?: string; theme?: Theme; out?: string; overview: boolean },
) {
  const [canvasId = '', screenId] = target.split('/')
  const project = new DesignProject(paths, DEV_URLS)
  if (canvasId === SYSTEM_CANVAS) return shootSystem(paths, project, screenId, options)
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
