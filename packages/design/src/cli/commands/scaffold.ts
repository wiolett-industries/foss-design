import fs from 'node:fs'
import path from 'node:path'
import { DESIGN_DIR, designPaths } from '../../core/paths'
import { ID_PATTERN } from '../../core/schema'
import { titleize } from '../../core/text'
import { CliError, dim, green, print } from '../log'
import { BUTTON_SPECIMEN_TSX, BUTTON_TSX, canvasJson, mainScreen, OVERVIEW_MD, TOKENS_CSS } from '../templates'

function write(file: string, content: string, root: string): boolean {
  if (fs.existsSync(file)) {
    print(`  ${dim('exists ')} ${path.relative(root, file)}`)
    return false
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  print(`  ${green('created')} ${path.relative(root, file)}`)
  return true
}

/** Add `.design/` to the project's .gitignore unless something there already covers it. */
export function ensureGitignored(root: string): 'added' | 'present' {
  const file = path.join(root, '.gitignore')
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const covered = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => ['.design', '.design/', '/.design', '/.design/', '.design/*'].includes(line))
  if (covered) return 'present'
  const prefix = current && !current.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(file, `${current}${prefix}${current ? '\n' : ''}# Design canvases (foss-design)\n.design/\n`)
  return 'added'
}

function projectName(root: string): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (typeof manifest.name === 'string' && manifest.name) return manifest.name
  } catch {}
  return path.basename(root)
}

export function runInit(root: string, options: { name?: string; gitignore: boolean }) {
  const paths = designPaths(root)
  print(`Setting up ${DESIGN_DIR} in ${root}`)
  write(paths.config, `${JSON.stringify({ name: options.name ?? projectName(root) }, null, 2)}\n`, root)
  fs.mkdirSync(paths.canvases, { recursive: true })
  if (options.gitignore) {
    const result = ensureGitignored(root)
    print(`  ${result === 'added' ? green('ignored') : dim('ignored')} .design/ in .gitignore`)
  }
  print()
  print(
    'Next: `design system init` for a design system, `design new <canvas>` for a canvas, `design icon <file.svg>` for the project icon, `design preview` to look.',
  )
}

export function runSystemInit(root: string, options: { name?: string; empty: boolean }) {
  const paths = designPaths(root)
  let base = projectName(root)
  try {
    base = JSON.parse(fs.readFileSync(paths.config, 'utf8')).name || base
  } catch {}
  const name = options.name ?? `${base} design system`
  print(`Scaffolding the design system in ${path.relative(root, paths.system)}`)
  write(path.join(paths.system, 'system.json'), `${JSON.stringify({ name }, null, 2)}\n`, root)
  write(path.join(paths.system, 'tokens.css'), TOKENS_CSS, root)
  if (!options.empty) {
    write(path.join(paths.system, 'guidelines', '01-overview.md'), OVERVIEW_MD, root)
    write(path.join(paths.system, 'components', 'button.tsx'), BUTTON_TSX, root)
    write(path.join(paths.system, 'specimens', 'button.tsx'), BUTTON_SPECIMEN_TSX, root)
  }
}

export function runNew(root: string, id: string, options: { title?: string; empty: boolean }) {
  if (!ID_PATTERN.test(id)) throw new CliError(`"${id}" is not a valid canvas id: use letters, digits, "-" and "_"`)
  const paths = designPaths(root)
  const dir = path.join(paths.canvases, id)
  if (fs.existsSync(path.join(dir, 'canvas.json'))) throw new CliError(`Canvas "${id}" already exists in ${dir}`)
  print(`Creating canvas "${id}"`)
  const title = options.title ?? titleize(id)
  if (options.empty) {
    write(
      path.join(dir, 'canvas.json'),
      `${JSON.stringify({ title, pages: [{ id: 'main', title: 'Main', sections: [] }] }, null, 2)}\n`,
      root,
    )
    fs.mkdirSync(path.join(dir, 'screens'), { recursive: true })
  } else {
    write(path.join(dir, 'canvas.json'), canvasJson(title), root)
    write(path.join(dir, 'screens', 'Main.tsx'), mainScreen(id), root)
  }
}
