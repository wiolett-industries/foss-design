import path from 'node:path'
import { CloudClient, CloudError, type RemoteUnit } from '../../cloud/client'
import { cloudHost, getCredential } from '../../cloud/credentials'
import { allUnitKeys, incomingDir, readLink, type UnitState, type UnitStatus, unitStatus } from '../../cloud/state'
import { plural } from '../../cloud/sync'
import { scanLocal } from '../../cloud/units'
import type { DesignPaths } from '../../core/paths'
import { dim, green, print, red, yellow } from '../log'

const STATE_TEXT: Record<UnitState, (text: string) => string> = {
  in_sync: green,
  local_changes: yellow,
  remote_ahead: yellow,
  conflict: red,
  archived: dim,
}

function detail(paths: DesignPaths, status: UnitStatus): string {
  const parts: string[] = []
  if (status.state === 'remote_ahead' || status.state === 'conflict')
    parts.push(
      status.deletedRemotely ? 'deleted in the cloud' : `r${status.baseRev} → r${status.conflictRev ?? status.headRev}`,
    )
  else if (status.baseRev) parts.push(`r${status.baseRev}`)
  if (status.state === 'local_changes' || status.state === 'conflict') {
    if (!status.baseRev && status.headRev === null) parts.push('new')
    else if (!status.local) parts.push('deleted here')
    else if (status.changed.length) parts.push(plural(status.changed.length, 'file'))
    if (status.usesChanged.length)
      parts.push(
        `uses ${plural(status.usesChanged.length, 'changed file')} from outside: ${status.usesChanged.slice(0, 2).join(', ')}${status.usesChanged.length > 2 ? ', …' : ''}`,
      )
  }
  if (status.state === 'remote_ahead' && !status.local && !status.baseRev) parts.push('not pulled yet')
  if (status.state === 'remote_ahead' && status.changed.length && !status.deletedRemotely)
    parts.push(`${plural(status.changed.length, 'file')} changed here; the cloud only rebuilt it`)
  if (status.conflictRev !== undefined) parts.push(`merge ${path.relative(paths.root, incomingDir(paths, status.key))}`)
  return parts.join(' · ')
}

/** The cloud part of `design status`: account, linked project and where every unit stands. */
export async function printCloudStatus(paths: DesignPaths, label: (text: string) => string) {
  let link: ReturnType<typeof readLink>
  try {
    link = readLink(paths)
  } catch (error) {
    print(`${label('Cloud')}${red((error as Error).message)}`)
    return
  }
  const host = link?.host ?? cloudHost()
  const credential = getCredential(host)
  const client = credential ? new CloudClient(host, credential.token) : null

  let remote: Map<string, RemoteUnit> | null = null
  let problem: string | null = null
  if (!client || !credential) {
    problem = 'not signed in'
    print(`${label('Cloud')}${dim(`not signed in to ${host} — \`design login\``)}`)
  } else {
    try {
      const me = await client.me()
      print(`${label('Cloud')}${me.email || credential.email} ${dim(host)}`)
      if (link) remote = await client.units(link.project)
    } catch (error) {
      problem = (error as Error).message
      if (error instanceof CloudError && error.status === 401)
        print(`${label('Cloud')}${red(`the token for ${host} was rejected — \`design login\``)}`)
      else print(`${label('Cloud')}${credential.email} ${dim(host)}`)
    }
  }
  if (!link) {
    print(`${label('Linked')}${dim('no — `design link` lists your cloud projects')}`)
    return
  }

  let name = link.project
  if (client && !problem) {
    try {
      const { owned, shared } = await client.projects()
      const found = [...owned, ...shared].find((project) => project.id === link.project)
      if (found) name = `${found.name} ${dim(`(${found.id}, ${found.role}${found.archived ? ', archived' : ''})`)}`
    } catch {}
  }
  print(`${label('Linked')}${name}`)
  if (problem) print(`${' '.repeat(9)}${yellow(`cloud state unknown (${problem}); local changes only`)}`)

  const scan = scanLocal(paths)
  const statuses = allUnitKeys(link, scan.units, remote).map((key) =>
    unitStatus(key, link, scan.units.get(key)?.manifest, remote, paths.design),
  )
  if (!statuses.length) print(`${label('Units')}${dim('none yet')}`)
  else {
    print(label('Units'))
    const width = Math.max(...statuses.map((status) => status.key.length))
    for (const status of statuses) {
      const state = STATE_TEXT[status.state](status.state.replaceAll('_', ' ').padEnd(13))
      print(`  ${status.key.padEnd(width)}  ${state} ${dim(detail(paths, status))}`)
    }
  }
  if (scan.notSynced.length) print(`${label('Unsynced')}${dim(`${scan.notSynced.join(', ')} (not part of any unit)`)}`)
}
