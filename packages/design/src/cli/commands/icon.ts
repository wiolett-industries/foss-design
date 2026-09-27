import fs from 'node:fs'
import path from 'node:path'
import { iconFile, iconProblem, writeIcon } from '../../core/icon'
import type { DesignPaths } from '../../core/paths'
import { CliError, dim, green, print } from '../log'

/** `design icon [<file>] [--remove]`: show, set or remove the project icon. */
export function runIcon(paths: DesignPaths, file: string | undefined, options: { remove: boolean }) {
  if (options.remove) {
    const had = iconFile(paths)
    writeIcon(paths, null)
    print(had ? `${green('Removed')} ${path.relative(process.cwd(), had)}` : 'The project has no icon.')
    return
  }
  if (!file) {
    const current = iconFile(paths)
    if (!current) return print('The project has no icon. Set one with `design icon <file.svg|png|webp>`.')
    return print(`${path.relative(process.cwd(), current)} ${dim(`${Math.ceil(fs.statSync(current).size / 1024)} KB`)}`)
  }
  let data: Buffer
  try {
    data = fs.readFileSync(file)
  } catch {
    throw new CliError(`No file ${file}`)
  }
  const problem = iconProblem(data, path.extname(file).slice(1).toLowerCase() || undefined)
  if (problem) throw new CliError(`${file}: ${problem}`)
  const written = writeIcon(paths, data)!
  print(`${green('Set')} the project icon: ${path.relative(process.cwd(), written)}`)
  print(dim('It syncs with the design system unit: `design push` takes it to the cloud.'))
}
