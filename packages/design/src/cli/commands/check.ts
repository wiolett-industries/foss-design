import { type FrameReport, launchChrome, openFrame } from '../../capture/chrome'
import { canvasFrames, type FrameJob, mapLimit, systemFrames } from '../../capture/frames'
import type { DesignPaths } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { liveServer } from '../../server/state'
import type { Issue } from '../../shared/types'
import { bold, CliError, dim, green, print, red, yellow } from '../log'
import { ensureServer } from './preview'

interface FrameResult {
  key: string
  url: string
  ready: boolean
  errors: string[]
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
      try {
        report = await openFrame(page, job.url, { waitForReady: job.waitForReady, settleMs: 300 })
      } catch (error) {
        report = { ready: false, errors: [(error as Error).message.split('\n')[0]!] }
      } finally {
        await page.close().catch(() => {})
      }
      return { key: job.key, url: job.url, ready: report.ready, errors: report.errors }
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

  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  const broken = frames.filter((frame) => !frame.ready || frame.errors.length)

  if (options.json) {
    print(JSON.stringify({ issues, frames }, null, 2))
  } else {
    if (issues.length) printIssues(issues)
    if (options.render) {
      if (issues.length) print()
      for (const frame of frames) {
        const ok = frame.ready && !frame.errors.length
        print(`${ok ? green('✓') : red('✗')} ${frame.key} ${dim(frame.url)}`)
        if (!frame.ready) print(`    ${red('did not finish rendering (no ready signal within 20s)')}`)
        for (const error of frame.errors) print(`    ${red(error.split('\n')[0]!)}`)
      }
    }
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
