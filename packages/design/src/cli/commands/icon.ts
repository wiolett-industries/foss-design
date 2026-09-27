import fs from 'node:fs'
import path from 'node:path'
import { CloudClient } from '../../cloud/client'
import { getCredential } from '../../cloud/credentials'
import { readLink, writeLink } from '../../cloud/state'
import { ICON_TYPES, type IconExtension, iconFile, iconHash, iconProblem, writeIcon } from '../../core/icon'
import type { DesignPaths } from '../../core/paths'
import { CliError, dim, green, print, yellow } from '../log'

/** A linked project's icon lives in the cloud: set it there now, not on the next sync. */
async function toCloud(paths: DesignPaths, file: string | null) {
  const link = readLink(paths)
  if (!link) return
  const credential = getCredential(link.host)
  if (!credential) {
    print(yellow('Not signed in: the icon goes to the cloud on the next `design push` after `design login`.'))
    return
  }
  const client = new CloudClient(link.host, credential.token)
  try {
    const ext = file ? (path.extname(file).slice(1) as IconExtension) : null
    await client.setProjectIcon(
      link.project,
      file && ext ? { data: fs.readFileSync(file), type: ICON_TYPES[ext] } : null,
    )
    link.icon = file ? iconHash(file) : null
    writeLink(paths, link)
    print(dim(`The cloud project has it too.`))
  } catch (error) {
    print(yellow(`Set here only: ${(error as Error).message}`))
  }
}

/** `design icon [<file>] [--remove]`: show, set or remove the project icon. */
export async function runIcon(paths: DesignPaths, file: string | undefined, options: { remove: boolean }) {
  if (options.remove) {
    const had = iconFile(paths)
    writeIcon(paths, null)
    print(had ? `${green('Removed')} ${path.relative(process.cwd(), had)}` : 'The project has no icon.')
    await toCloud(paths, null)
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
  await toCloud(paths, written)
}
