import { type FrameReport, launchChrome, openFrame } from '../../capture/chrome'
import { canvasFrames, type FrameJob, mapLimit, systemFrames } from '../../capture/frames'
import type { DesignPaths } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { liveServer } from '../../server/state'
import { compileRoute, linkPath, matchRoute } from '../../shared/routes'
import type { Issue } from '../../shared/types'
import { bold, CliError, dim, green, print, red, yellow } from '../log'
import { ensureServer } from './preview'

interface FrameResult {
  key: string
  url: string
  ready: boolean
  held?: number
  errors: string[]
  /** `href`s of the links in the rendered screen, with their text. */
  links: { href: string; text: string }[]
}

/** A link path no screen of the canvas has a route for, and the screens it appears in. */
interface LinkIssue {
  canvas: string
  path: string
  text: string
  screens: string[]
}

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`

function printIssues(issues: Issue[]) {
  const byFile = new Map<string, Issue[]>()
  for (const issue of issues) byFile.set(issue.file, [...(byFile.get(issue.file) ?? []), issue])
  for (const [file, list] of byFile) {
    print(bold(file))
    for (const issue of list) {
      const tag = issue.severity === 'error' ? red('error  ') : yellow('warning')
      print(`  ${tag} ${issue.at ? `${dim(issue.at)}  ` : ''}${issue.message}`)
    }
  }
}

async function renderFrames(jobs: FrameJob[]): Promise<FrameResult[]> {
  const browser = await launchChrome()
  try {
    return await mapLimit(jobs, 4, async (job) => {
      const page = await browser.newPage({ viewport: { width: job.width, height: job.height } })
      let report: FrameReport
      let links: FrameResult['links'] = []
      try {
        report = await openFrame(page, job.url, { waitForReady: job.waitForReady, settleMs: 300 })
        links = await page
          .evaluate(() =>
            [...document.querySelectorAll('a[href]:not([download]), area[href]:not([download])')].map((link) => ({
              href: link.getAttribute('href') ?? '',
              text: (link.textContent || link.getAttribute('aria-label') || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 40),
            })),
          )
          .catch(() => [])
      } catch (error) {
        report = { ready: false, errors: [(error as Error).message.split('\n')[0]!] }
      } finally {
        await page.close().catch(() => {})
      }
      return { key: job.key, url: job.url, ready: report.ready, held: report.held, errors: report.errors, links }
    })
  } finally {
    await browser.close()
  }
}

export async function runCheck(paths: DesignPaths, canvases: string[], options: { render: boolean; json: boolean }) {
  const project = new DesignProject(paths, DEV_URLS)
  const known = project.canvasIds()
  const unknown = canvases.filter((id) => !known.includes(id))
  if (unknown.length) {
    throw new CliError(
      `No canvas ${unknown.map((id) => `"${id}"`).join(', ')}. Canvases: ${known.join(', ') || 'none yet'}`,
    )
  }

  const issues = canvases.length ? canvases.flatMap((id) => project.canvas(id)?.doc.issues ?? []) : project.issues()

  let frames: FrameResult[] = []
  if (options.render) {
    const wasRunning = await liveServer(paths)
    const server = await ensureServer(paths, {})
    if (!wasRunning && !options.json)
      print(dim(`Started the preview server at ${server.url} (\`design stop\` stops it).`))
    const base = `http://127.0.0.1:${server.port}`
    const docs = (canvases.length ? canvases : known).map((id) => project.canvas(id)!.doc)
    const jobs = docs.flatMap((doc) => canvasFrames(doc, base, doc.theme ?? 'light', { includeUrls: false }))
    const system = project.system()
    if (!canvases.length && system) jobs.unshift(...systemFrames(system.doc, base, 'light'))
    if (!options.json) print(dim(`Loading ${plural(jobs.length, 'frame')} in Chrome via ${server.url}…`))
    frames = await renderFrames(jobs)
  }

  const linkIssues = options.render ? unroutedLinks(frames, project, canvases.length ? canvases : known) : []
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors + linkIssues.length
  const broken = frames.filter((frame) => !frame.ready || frame.errors.length)

  if (options.json) {
    print(JSON.stringify({ issues, frames, links: linkIssues }, null, 2))
  } else {
    if (issues.length) printIssues(issues)
    if (options.render) {
      if (issues.length) print()
      for (const frame of frames) {
        const ok = frame.ready && !frame.errors.length
        print(`${ok ? green('✓') : red('✗')} ${frame.key} ${dim(frame.url)}`)
        if (frame.held) print(`    ${red(`holdReady() was not released within 20s (${frame.held} still held)`)}`)
        else if (!frame.ready) print(`    ${red('did not finish rendering (no ready signal within 20s)')}`)
        for (const error of frame.errors) print(`    ${red(error.split('\n')[0]!)}`)
      }
    }
    if (linkIssues.length) printLinkIssues(linkIssues, project)
    const scope = canvases.length ? plural(canvases.length, 'canvas', 'canvases') : 'the project'
    if (!errors && !warnings && !broken.length) {
      print(
        green(
          `✓ No problems in ${scope}${options.render ? `; ${plural(frames.length, 'frame')} rendered cleanly` : ''}.`,
        ),
      )
    } else {
      const parts = [plural(errors, 'error'), plural(warnings, 'warning')]
      if (options.render) parts.push(`${broken.length} of ${plural(frames.length, 'frame')} with problems`)
      print(errors || broken.length ? red(parts.join(', ')) : yellow(parts.join(', ')))
    }
  }
  if (errors || broken.length) process.exitCode = 1
}

/**
 * Links in rendered screens that lead to no screen: their path matches no `route` on the
 * canvas and does not end in a screen id. Grouped by path, since a shared sidebar repeats them.
 */
function unroutedLinks(frames: FrameResult[], project: DesignProject, ids: string[]): LinkIssue[] {
  const out = new Map<string, LinkIssue>()
  for (const id of ids) {
    const doc = project.canvas(id)?.doc
    if (!doc) continue
    const items = doc.pages.flatMap((page) =>
      page.sections.flatMap((section) => section.items.filter((item) => item.kind === 'screen' || item.kind === 'url')),
    )
    const entries = items.map((item) => ({ routes: (item.routes ?? []).map(compileRoute), value: item.id }))
    const known = new Set(items.map((item) => item.id))
    for (const frame of frames) {
      if (!frame.key.startsWith(`${id}/`)) continue
      const screen = frame.key.slice(id.length + 1)
      const here = items.find((item) => item.id === screen)
      for (const link of frame.links) {
        const target = linkPath(link.href, here?.routes?.[0])
        if (target === null) continue
        if (matchRoute(entries, target)) continue
        const bare = target.split(/[?#]/)[0]!.replace(/\/+$/, '')
        if (known.has(bare.slice(bare.lastIndexOf('/') + 1).replace(/\.html?$/, ''))) continue
        const key = `${id} ${bare || '/'}`
        const issue = out.get(key) ?? { canvas: id, path: bare || '/', text: link.text, screens: [] }
        if (!issue.screens.includes(screen)) issue.screens.push(screen)
        if (!issue.text && link.text) issue.text = link.text
        out.set(key, issue)
      }
    }
  }
  return [...out.values()].sort((a, b) => b.screens.length - a.screens.length || a.path.localeCompare(b.path))
}

function printLinkIssues(issues: LinkIssue[], project: DesignProject) {
  const byCanvas = new Map<string, LinkIssue[]>()
  for (const issue of issues) byCanvas.set(issue.canvas, [...(byCanvas.get(issue.canvas) ?? []), issue])
  for (const [canvas, list] of byCanvas) {
    print()
    print(
      `${yellow('warning')} ${bold(canvas)}: ${plural(list.length, 'link')} ${list.length === 1 ? 'leads' : 'lead'} to no screen`,
    )
    const width = Math.min(48, Math.max(...list.map((issue) => issue.path.length)))
    for (const issue of list.slice(0, 40)) {
      const where =
        issue.screens.length === 1
          ? `in ${issue.screens[0]}`
          : `in ${issue.screens.length} screens (${issue.screens.slice(0, 2).join(', ')}…)`
      print(`  ${issue.path.padEnd(width)}  ${issue.text ? `"${issue.text}"  ` : ''}${dim(where)}`)
    }
    if (list.length > 40) print(dim(`  …and ${list.length - 40} more (--json lists them all)`))
    const routed = project
      .canvas(canvas)
      ?.doc.pages.some((page) => page.sections.some((section) => section.items.some((item) => item.routes?.length)))
    print(
      dim(
        routed
          ? '  Give the screen that shows each path a "route" in canvas.json, or make the link href="#" when there is none.'
          : '  No screen on this canvas has a "route": give each screen the app URL it shows ("route": "/settings") and links open it.',
      ),
    )
  }
}
