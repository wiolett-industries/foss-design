import fs from 'node:fs'
import { CloudClient } from '../../cloud/client'
import { requireCredential } from '../../cloud/credentials'
import { readLink, writeLink } from '../../cloud/state'
import type { DesignPaths } from '../../core/paths'
import { CliError, green, print } from '../log'

/**
 * `design rename <name>`: a linked project is renamed in the cloud (the owner's call), and this
 * `.design` goes by that name; a project that is not linked keeps its name in design.json.
 */
export async function runRename(paths: DesignPaths, name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new CliError('Usage: design rename <name>')
  const link = readLink(paths)
  if (link) {
    const client = new CloudClient(link.host, requireCredential(link.host).token)
    const project = await client.renameProject(link.project, trimmed)
    link.name = project.name
    writeLink(paths, link)
    print(`${green('Renamed')} the cloud project to ${project.name}`)
    return
  }
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(fs.readFileSync(paths.config, 'utf8'))
  } catch {}
  fs.writeFileSync(paths.config, `${JSON.stringify({ ...config, name: trimmed }, null, 2)}\n`)
  print(`${green('Renamed')} the project to ${trimmed} (.design/design.json)`)
}
