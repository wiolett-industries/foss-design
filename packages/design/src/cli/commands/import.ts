import fs from 'node:fs'
import path from 'node:path'
import type { DesignPaths } from '../../core/paths'
import { ID_PATTERN } from '../../core/schema'
import { importClaudeDesign } from '../../import/claude-design'
import { bold, CliError, dim, green, print, yellow } from '../log'

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()

/** `design import <folder>`: a Claude Design project, once, as a canvas of React screens. */
export function runImport(paths: DesignPaths, from: string, options: { canvas?: string; title?: string }) {
  const dir = path.resolve(from)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new CliError(`No folder ${from}`)
  let result: ReturnType<typeof importClaudeDesign>
  try {
    result = importClaudeDesign(dir, { title: options.title })
  } catch (error) {
    throw new CliError((error as Error).message)
  }
  const id = options.canvas ?? (slug(String(result.canvas.title)) || slug(path.basename(dir)) || 'imported')
  if (!ID_PATTERN.test(id)) throw new CliError(`"${id}" is no canvas id; pass one with --canvas <id>`)
  const out = path.join(paths.canvases, id)
  if (fs.existsSync(out)) throw new CliError(`.design/canvas/${id} exists; pick another id with --canvas <id>`)

  fs.mkdirSync(path.join(out, 'screens'), { recursive: true })
  for (const [name, content] of result.files) fs.writeFileSync(path.join(out, 'screens', name), content)
  fs.writeFileSync(path.join(out, 'canvas.json'), `${JSON.stringify(result.canvas, null, 2)}\n`)

  print(`${green('Imported')} ${bold(String(result.canvas.title))} → .design/canvas/${id}`)
  print(
    `  ${result.screens} screens and ${result.notes} notes on ${(result.canvas.pages as unknown[]).length} pages; ` +
      `${result.files.size - 1} templates as React modules in screens/, helpers in screens/dc.jsx`,
  )
  if (result.warnings.size) {
    print()
    for (const [message, files] of result.warnings) {
      const list = [...files]
      print(`${yellow('warning')} ${message}`)
      print(`  ${dim(`${list.slice(0, 6).join(', ')}${list.length > 6 ? ` and ${list.length - 6} more` : ''}`)}`)
    }
  }
  print()
  print(`Next: \`design check ${id} --render\`, then \`design preview --open /c/${id}\`.`)
}
