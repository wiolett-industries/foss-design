import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CloudClient, CloudError, type RemoteProject } from '../../cloud/client'
import {
  cloudHost,
  credentialsFile,
  removeCredential,
  requireCredential,
  saveCredential,
} from '../../cloud/credentials'
import { syncProjectMeta } from '../../cloud/meta'
import { allUnitKeys, cloudCache, readLink, unitStatus, writeLink } from '../../cloud/state'
import { plural } from '../../cloud/sync'
import { scanLocal } from '../../cloud/units'
import type { DesignPaths } from '../../core/paths'
import { bold, CliError, cyan, dim, green, print, yellow } from '../log'
import { openBrowser } from './preview'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `design login`: the device flow (RFC 8628). The link carries the code, so an agent can hand it to the user. */
export async function runLogin() {
  const host = cloudHost()
  const client = new CloudClient(host, null)
  const code = await client.deviceCode(os.hostname())
  const url = new URL(code.verification_uri_complete || code.verification_uri, host).toString()
  const expiresIn = code.expires_in ?? 600

  print(`${bold('Sign in to foss-design Cloud')} ${dim(host)}`)
  print()
  print(`  Open this link  ${cyan(url)}`)
  print(`  Code            ${bold(code.user_code)} ${dim('(the page must show the same code)')}`)
  if (!code.verification_uri_complete) print(dim('  Enter the code on that page.'))
  print()
  if (process.stdout.isTTY) openBrowser(url)
  print(dim(`Waiting for approval in the browser… (the code expires in ${Math.round(expiresIn / 60)} minutes)`))

  let interval = Math.max(1, code.interval ?? 5) * 1000
  const deadline = Date.now() + expiresIn * 1000
  let token: string | null = null
  while (!token) {
    await sleep(interval)
    if (Date.now() > deadline) throw new CliError('The sign-in code expired. Run `design login` again.')
    let result: Awaited<ReturnType<CloudClient['deviceToken']>>
    try {
      result = await client.deviceToken(code.device_code)
    } catch (error) {
      if (error instanceof CloudError && error.status === 0) continue
      throw error
    }
    if ('token' in result) {
      token = result.token
      break
    }
    if (result.error === 'authorization_pending') continue
    if (result.error === 'slow_down') interval += 5000
    else if (result.error === 'expired_token') throw new CliError('The sign-in code expired. Run `design login` again.')
    else if (result.error === 'access_denied') throw new CliError('Sign-in was declined in the browser.')
    else throw new CliError(`Sign-in failed: ${result.message ?? result.error}`)
  }

  const me = await new CloudClient(host, token).me()
  saveCredential(host, { token, email: me.email })
  print(
    `${green('✓')} Signed in as ${bold(me.email || 'unknown')} on ${host} ${dim(`(token in ${credentialsFile()})`)}`,
  )
}

export function runLogout() {
  const host = cloudHost()
  if (!removeCredential(host)) return print(dim(`Not signed in to ${host}.`))
  print(`${green('✓')} Signed out of ${host} on this machine.`)
  print(dim(`The token still exists in the cloud until you revoke it: ${host}/profile`))
}

function printProjects(title: string, projects: RemoteProject[], linked: string | undefined) {
  print(bold(title))
  if (!projects.length) return print(dim('  none'))
  const width = Math.max(...projects.map((project) => project.id.length))
  const nameWidth = Math.max(...projects.map((project) => project.name.length))
  for (const project of projects) {
    const flags = [project.archived && yellow('archived'), project.banned && yellow('banned')].filter(Boolean)
    print(
      `  ${project.id.padEnd(width)}  ${project.name.padEnd(nameWidth)}  ${dim(project.role.padEnd(6))}` +
        (flags.length ? `  ${flags.join(' ')}` : '') +
        (project.id === linked ? `  ${green('linked')}` : ''),
    )
  }
}

/** `design link`: list the projects, or tie `.design` to one (replacing any earlier link). */
export async function runLink(paths: DesignPaths, wanted: string | undefined, options: { newName?: string }) {
  if (wanted && options.newName !== undefined)
    throw new CliError('Pass a project or --new <name>, not both. `design link` lists your projects.')
  const host = cloudHost()
  const client = new CloudClient(host, requireCredential(host).token)
  const current = readLink(paths)

  let project: RemoteProject
  if (options.newName !== undefined) {
    const name = options.newName.trim()
    if (!name) throw new CliError('--new takes a project name')
    project = await client.createProject(name)
    print(`${green('created')} ${project.name} ${dim(`(${project.id})`)}`)
  } else {
    const { owned, shared } = await client.projects()
    if (!wanted) {
      const linked = current?.host === host ? current.project : undefined
      print(`${bold('Projects on')} ${host}`)
      print()
      printProjects('Yours', owned, linked)
      printProjects('Shared with you', shared, linked)
      print()
      print(dim('Link one with `design link <id>`, or make a new one with `design link --new <name>`.'))
      return
    }
    const all = [...owned, ...shared]
    const byName = all.filter((item) => item.name === wanted)
    const found = all.find((item) => item.id === wanted) ?? (byName.length === 1 ? byName[0] : undefined)
    if (!found)
      throw new CliError(
        byName.length > 1
          ? `Several projects are called "${wanted}"; link by id (\`design link\` lists them).`
          : `No project "${wanted}" among yours on ${host}. \`design link\` lists them.`,
      )
    project = found
  }
  if (project.banned) throw new CliError(`${project.name} is blocked by moderation and cannot be linked.`)

  if (current?.host === host && current.project === project.id) {
    print(`${dim('Already linked to')} ${project.name} ${dim(`(${project.id}, ${project.role})`)}`)
  } else {
    writeLink(paths, { host, project: project.id, units: {}, conflicts: {} })
    // Conflicts belonged to the old link.
    fs.rmSync(path.join(cloudCache(paths), 'incoming'), { recursive: true, force: true })
    const replaced = current ? dim(` (replacing the link to ${current.project})`) : ''
    print(`${green('linked')} .design → ${bold(project.name)} ${dim(`(${project.id}, ${project.role})`)}${replaced}`)
  }
  if (project.archived) print(yellow('The project is archived: unarchive it in the web app before pushing or pulling.'))

  const link = readLink(paths)!
  for (const line of await syncProjectMeta(paths, client, link)) print(dim(line))
  writeLink(paths, link)
  const remote = project.archived ? null : await client.units(project.id)
  const scan = scanLocal(paths)
  const states = allUnitKeys(link, scan.units, remote).map(
    (key) => unitStatus(key, link, scan.units.get(key)?.manifest, remote).state,
  )
  const count = (state: string) => states.filter((item) => item === state).length
  const ahead = count('remote_ahead')
  const conflicts = count('conflict')
  const local = count('local_changes')
  if (ahead || conflicts)
    print(
      `${plural(ahead + conflicts, 'unit')} in the cloud ${ahead + conflicts === 1 ? 'is' : 'are'} ahead of this .design` +
        (conflicts ? dim(` (${conflicts} also changed here)`) : '') +
        '. Next: `design pull`.',
    )
  else if (local)
    print(`${plural(local, 'unit')} here ${local === 1 ? 'is' : 'are'} not in the cloud yet. Next: \`design push\`.`)
  else if (remote) print(dim('Everything is in sync.'))
}
