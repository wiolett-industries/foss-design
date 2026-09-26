import type { DesignPaths } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { liveServer } from '../../server/state'
import { bold, dim, green, print, red, yellow } from '../log'
import { printCloudStatus } from './cloud-status'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export async function runStatus(paths: DesignPaths) {
  const project = new DesignProject(paths, DEV_URLS)
  const server = await liveServer(paths)
  const label = (text: string) => bold(text.padEnd(9))

  print(
    server
      ? `${label('Preview')}${green('running')} ${server.url} ${dim(`(foss-design ${server.version}, pid ${server.pid}, since ${new Date(server.startedAt).toLocaleString()})`)}`
      : `${label('Preview')}${dim('not running — `design preview` starts it')}`,
  )
  print(`${label('Project')}${project.name()} ${dim(paths.root)}`)

  const system = project.system()
  if (system) {
    const { doc } = system
    print(
      `${label('System')}${doc.name} ${dim(
        `— ${plural(doc.tokens.length, 'token')}, ${plural(doc.components.length, 'component')}, ${plural(doc.guidelines.length, 'guideline')}`,
      )}`,
    )
  } else print(`${label('System')}${dim('none — `design system init` scaffolds one')}`)

  const canvases = project.canvases()
  if (!canvases.length) print(`${label('Canvases')}${dim('none — `design new <canvas>` scaffolds one')}`)
  else {
    print(label('Canvases'))
    const width = Math.max(...canvases.map((canvas) => canvas.doc.id.length))
    for (const { doc } of canvases) {
      const items = doc.pages.flatMap((page) => page.sections.flatMap((section) => section.items))
      const frames = items.filter((item) => item.kind === 'screen' || item.kind === 'url').length
      const errors = doc.issues.filter((issue) => issue.severity === 'error').length
      const url = server ? dim(` ${server.url}/c/${doc.id}`) : ''
      print(
        `  ${doc.id.padEnd(width)}  ${doc.title} ${dim(`${plural(doc.pages.length, 'page')} · ${plural(frames, 'screen')}`)}` +
          (errors ? ` ${red(plural(errors, 'error'))}` : '') +
          url,
      )
    }
  }

  const issues = project.issues()
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  const summary = `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`
  print(
    `${label('Issues')}${errors ? red(summary) : warnings ? yellow(summary) : green(summary)}` +
      (issues.length ? dim(' — `design check` lists them') : ''),
  )
  await printCloudStatus(paths, label)
}
