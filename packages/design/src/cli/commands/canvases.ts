import { CloudClient, CloudError, type RemoteUnit } from '../../cloud/client'
import { cloudHost, getCredential, requireCredential } from '../../cloud/credentials'
import { readLink, requireLink, unitStatus } from '../../cloud/state'
import { megabytes, plural, unitArg, webUrl } from '../../cloud/sync'
import { canvasUnit, SYSTEM_UNIT, scanLocal } from '../../cloud/units'
import type { DesignPaths } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { STATIC_URLS } from '../../core/sources'
import { bold, CliError, cyan, dim, green, print, red, yellow } from '../log'
import { runPull } from './sync'

const publicUrl = (host: string, publicId: string) => `${host.replace(/\/+$/, '')}/s/${publicId}`
/** A screen published on its own: an id, nothing about the project. */
const screenUrl = (host: string, publicId: string) => `${host.replace(/\/+$/, '')}/a/${publicId}`

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  const [value, unit] =
    seconds < 3600
      ? [seconds / 60, 'minute']
      : seconds < 86400
        ? [seconds / 3600, 'hour']
        : seconds < 86400 * 60
          ? [seconds / 86400, 'day']
          : [seconds / (86400 * 30), 'month']
  return `${plural(Math.floor(value), unit)} ago`
}

/** The linked project and a client, for commands that act on the cloud. */
function cloud(paths: DesignPaths) {
  const link = requireLink(paths)
  const credential = requireCredential(link.host)
  return { link, client: new CloudClient(link.host, credential.token) }
}

/** A canvas id from `<canvas>` or `canvas/<canvas>`; the design system is refused where it has no meaning. */
function canvasArg(value: string | undefined, usage: string): string {
  if (!value) throw new CliError(`Usage: ${usage}`)
  const key = unitArg(value)
  if (key === SYSTEM_UNIT) throw new CliError(`The design system is not a canvas. Usage: ${usage}`)
  return key.slice('canvas/'.length)
}

async function remoteCanvas(client: CloudClient, project: string, canvas: string): Promise<RemoteUnit> {
  const unit = (await client.units(project)).get(canvasUnit(canvas))
  if (!unit) throw new CliError(`${canvas} is not in the cloud yet: \`design push ${canvas}\` uploads it`)
  return unit
}

/**
 * `design canvases`: every canvas here with its pages and screens; with a cloud link, also where
 * it stands against the cloud, its web link and its public link.
 */
export async function runCanvases(paths: DesignPaths, options: { json: boolean }) {
  const project = new DesignProject(paths, STATIC_URLS)
  const local = project.canvasIds().map((id) => project.canvas(id)!.doc)
  const link = readLink(paths)
  let remote: Map<string, RemoteUnit> | null = null
  let cloudNote: string | null = link ? null : 'not linked to foss-design Cloud — `design link`'
  if (link) {
    const credential = getCredential(link.host)
    if (!credential) cloudNote = `not signed in to ${link.host} — \`design login\``
    else {
      try {
        remote = await new CloudClient(link.host, credential.token).units(link.project)
      } catch (error) {
        cloudNote = `cloud unavailable: ${(error as Error).message}`
      }
    }
  }
  const scan = link ? scanLocal(paths) : null
  const ids = [
    ...new Set([
      ...local.map((doc) => doc.id),
      ...[...(remote?.keys() ?? [])].filter((key) => key.startsWith('canvas/')).map((key) => key.slice(7)),
    ]),
  ].sort()
  const rows = ids.map((id) => {
    const doc = local.find((entry) => entry.id === id)
    const unit = remote?.get(canvasUnit(id))
    const status =
      link && remote ? unitStatus(canvasUnit(id), link, scan?.units.get(canvasUnit(id))?.manifest, remote) : null
    const frames = doc?.pages
      .flatMap((page) => page.sections.flatMap((section) => section.items))
      .filter((item) => item.kind === 'screen' || item.kind === 'url')
    return {
      id,
      title: doc?.title ?? unit?.title ?? id,
      local: !!doc,
      pages: doc?.pages.length ?? null,
      screens: frames?.length ?? null,
      errors: doc?.issues.filter((issue) => issue.severity === 'error').length ?? 0,
      cloud: unit
        ? {
            rev: unit.headRev,
            state: status?.state ?? null,
            archived: unit.archived,
            url: webUrl(link!, canvasUnit(id)),
            publicUrl: unit.publicId ? publicUrl(link!.host, unit.publicId) : null,
          }
        : null,
    }
  })
  if (options.json) return print(JSON.stringify({ canvases: rows, cloud: cloudNote }, null, 2))
  if (!rows.length) print(dim('No canvases yet: `design new <canvas>` creates one.'))
  const width = Math.max(0, ...rows.map((row) => row.id.length))
  for (const row of rows) {
    const facts = row.local
      ? [`${plural(row.pages ?? 0, 'page')} · ${plural(row.screens ?? 0, 'screen')}`]
      : [yellow('only in the cloud — `design pull`')]
    if (row.errors) facts.push(red(plural(row.errors, 'error')))
    if (row.cloud) {
      const state = row.cloud.archived
        ? dim('archived')
        : row.cloud.state === 'in_sync'
          ? green('in sync')
          : row.cloud.state
            ? yellow(row.cloud.state.replaceAll('_', ' '))
            : ''
      facts.push([`r${row.cloud.rev}`, state].filter(Boolean).join(' '))
    } else if (remote && row.local) facts.push(dim('not pushed'))
    print(`${bold(row.id.padEnd(width))}  ${row.title}  ${dim('·')} ${facts.join(dim(' · '))}`)
    if (row.cloud && !row.cloud.archived) print(`${' '.repeat(width)}  ${dim('→')} ${row.cloud.url}`)
    if (row.cloud?.publicUrl) print(`${' '.repeat(width)}  ${dim('public')} ${cyan(row.cloud.publicUrl)}`)
  }
  if (cloudNote) print(dim(cloudNote))
}

/** `design url <canvas>`: the canvas in the web app, and its public links (the canvas's, its screens'). */
export async function runUrl(paths: DesignPaths, value: string | undefined, options: { json: boolean }) {
  const canvas = canvasArg(value, 'design url <canvas>')
  const { link, client } = cloud(paths)
  const unit = await remoteCanvas(client, link.project, canvas)
  const url = webUrl(link, canvasUnit(canvas))
  const pub = unit.publicId ? publicUrl(link.host, unit.publicId) : null
  const screens = unit.screens.map((s) => ({ screen: s.item, publicUrl: screenUrl(link.host, s.publicId) }))
  if (options.json)
    return print(JSON.stringify({ canvas, url, publicUrl: pub, screens, archived: unit.archived }, null, 2))
  print(url)
  if (pub) print(`${dim('public')} ${pub}`)
  for (const screen of screens) print(`${dim(`public ${screen.screen}`)} ${screen.publicUrl}`)
  if (unit.archived) print(dim('archived — `design unarchive` brings it back'))
}

/**
 * `design publish|unpublish <canvas>[/<screen>]`: a public link anyone can open, or none (owner only).
 * With a screen, the link opens that screen alone, at an address that names nothing of the project.
 */
export async function runPublish(paths: DesignPaths, value: string | undefined, publish: boolean) {
  const verb = publish ? 'publish' : 'unpublish'
  const usage = `design ${verb} <canvas>[/<screen>]`
  const slash = value?.indexOf('/') ?? -1
  const screen = value && slash > 0 ? value.slice(slash + 1) : null
  const canvas = canvasArg(value && slash > 0 ? value.slice(0, slash) : value, usage)
  if (screen === '') throw new CliError(`Usage: ${usage}`)
  const { link, client } = cloud(paths)
  const unit = await remoteCanvas(client, link.project, canvas)
  if (screen) {
    if (!publish && !unit.screens.some((s) => s.item === screen))
      return print(dim(`${canvas}/${screen} has no public link`))
    const { publicId } = await client.screenAction(link.project, canvas, screen, verb)
    if (publish) {
      print(`${green('✓')} Published ${bold(`${canvas}/${screen}`)} on its own: anyone with the link sees this screen alone`)
      if (publicId) print(`  ${cyan(screenUrl(link.host, publicId))}`)
    } else print(`${green('✓')} ${bold(`${canvas}/${screen}`)} has no public link now`)
    return
  }
  const { publicId } = await client.canvasAction(link.project, canvas, verb)
  if (publish) {
    const id = publicId ?? (await remoteCanvas(client, link.project, canvas)).publicId
    print(`${green('✓')} Published ${bold(canvas)}: anyone with the link can view it`)
    if (id) print(`  ${cyan(publicUrl(link.host, id))}`)
  } else print(`${green('✓')} ${bold(canvas)} has no public link now; members still open it in the project`)
}

/** `design archive|unarchive <canvas>`: an archived canvas keeps its history but leaves the list and pushes. */
export async function runArchive(paths: DesignPaths, value: string | undefined, archive: boolean) {
  const verb = archive ? 'archive' : 'unarchive'
  const canvas = canvasArg(value, `design ${verb} <canvas>`)
  const { link, client } = cloud(paths)
  await remoteCanvas(client, link.project, canvas)
  await client.canvasAction(link.project, canvas, verb)
  print(
    archive
      ? `${green('✓')} Archived ${bold(canvas)} in the cloud; its history is kept. \`design unarchive ${canvas}\` brings it back.`
      : `${green('✓')} ${bold(canvas)} is active again ${dim(webUrl(link, canvasUnit(canvas)))}`,
  )
}

/** `design history <canvas|system>`: the stored revisions, newest first. */
export async function runHistory(paths: DesignPaths, value: string | undefined, options: { json: boolean }) {
  if (!value) throw new CliError('Usage: design history <canvas|system>')
  const key = unitArg(value)
  const { link, client } = cloud(paths)
  let revisions: Awaited<ReturnType<CloudClient['revisions']>>
  try {
    revisions = await client.revisions(link.project, key)
  } catch (error) {
    if (error instanceof CloudError && error.status === 404)
      throw new CliError(`${key} is not in the cloud yet: \`design push\` uploads it`)
    throw error
  }
  if (options.json) return print(JSON.stringify({ unit: key, revisions }, null, 2))
  print(`${bold(key)} ${dim(webUrl(link, key))}`)
  for (const rev of revisions) {
    const parts = [
      rev.head ? green('current') : rev.rollbackAllowed ? '' : dim('built on an older system'),
      ago(rev.createdAt),
      rev.author ?? '',
      rev.screens !== null ? plural(rev.screens, 'screen') : '',
      rev.bytes !== null ? megabytes(rev.bytes) : '',
    ].filter(Boolean)
    print(`  ${bold(`r${rev.rev}`.padEnd(5))} ${parts.join(dim(' · '))}`)
  }
  const target = revisions.find((rev) => rev.rollbackAllowed)
  if (key !== SYSTEM_UNIT && target)
    print(dim(`\`design rollback ${key.slice(7)} ${target.rev}\` makes a revision current again`))
  if (key === SYSTEM_UNIT) print(dim('The design system is not rolled back; change it and push.'))
}

/** `design rollback <canvas> <rev>`: that revision becomes the new head in the cloud, then pulled here. */
export async function runRollback(paths: DesignPaths, value: string | undefined, revArg: string | undefined) {
  const canvas = canvasArg(value, 'design rollback <canvas> <rev>')
  const rev = Number((revArg ?? '').replace(/^r/i, ''))
  if (!Number.isInteger(rev) || rev < 1)
    throw new CliError('Usage: design rollback <canvas> <rev>  (see `design history <canvas>`)')
  const { link, client } = cloud(paths)
  const head = await client.rollback(link.project, canvasUnit(canvas), rev)
  print(`${green('✓')} ${bold(canvas)}: r${rev} is current again as r${head} in the cloud`)
  await runPull(paths, [canvas], { theirs: [], json: false })
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** `design me`: the cloud account this machine is signed in to, its plan, usage and activity. */
export async function runMe(paths: DesignPaths | null, options: { json: boolean }) {
  const link = paths ? readLink(paths) : null
  const host = link?.host ?? cloudHost()
  const credential = requireCredential(host)
  const client = new CloudClient(host, credential.token)
  const [me, usage, activity] = await Promise.all([
    client.request('GET', '/me').then(obj),
    client.request('GET', '/me/usage').then(obj),
    client.request('GET', '/me/activity').then(obj),
  ])
  const plan = obj(usage.plan)
  const limits = obj(usage.limits)
  const totals = obj(activity.totals)
  let linked: { id: string; name: string; role: string } | null = null
  if (link) {
    const projects = await client.projects().catch(() => null)
    const project = projects && [...projects.owned, ...projects.shared].find((p) => p.id === link.project)
    linked = project
      ? { id: project.id, name: project.name, role: project.role }
      : { id: link.project, name: '', role: '' }
  }
  const data = {
    host,
    email: me.email,
    name: me.name,
    memberSince: me.createdAt,
    plan: { id: plan.id, name: plan.name, expiresAt: plan.expiresAt ?? null },
    storage: { usedBytes: n(usage.storageBytes), limitBytes: n(limits.storage_bytes) },
    activeProjects: { used: n(usage.activeProjects), limit: n(limits.active_projects) },
    canvases: n(totals.canvases),
    screens: n(totals.screens),
    pushesLastYear: n(totals.pushesLastYear),
    pushesPerHour: n(limits.pushes_per_hour),
    linked,
  }
  if (options.json) return print(JSON.stringify(data, null, 2))
  const label = (text: string) => dim(text.padEnd(10))
  const date = (iso: unknown) => (typeof iso === 'string' ? new Date(iso).toDateString().slice(4) : '')
  const share = data.storage.limitBytes ? Math.round((data.storage.usedBytes / data.storage.limitBytes) * 100) : 0
  print(
    `${bold(String(data.email ?? ''))}${data.name && data.name !== data.email ? ` ${dim(`(${data.name})`)}` : ''} ${dim(host)}`,
  )
  print(
    `${label('Plan')}${bold(String(data.plan.name ?? 'Free'))} ${dim(data.plan.expiresAt ? `until ${date(data.plan.expiresAt)}` : 'no end date')}`,
  )
  print(
    `${label('Storage')}${megabytes(data.storage.usedBytes)} of ${megabytes(data.storage.limitBytes)} ${(share >= 90 ? red : share >= 80 ? yellow : dim)(`(${share}%)`)}`,
  )
  print(`${label('Projects')}${data.activeProjects.used} of ${data.activeProjects.limit} active`)
  print(
    `${label('Canvases')}${plural(data.canvases, 'canvas', 'canvases')} in your projects · ${plural(data.screens, 'screen')}`,
  )
  print(
    `${label('Pushes')}${plural(data.pushesLastYear, 'push', 'pushes')} in the last year ${dim(`· up to ${data.pushesPerHour} an hour`)}`,
  )
  if (linked)
    print(
      `${label('Linked')}${linked.name || linked.id}${linked.role ? dim(` as ${linked.role}`) : ''} ${dim(webUrl(link!))}`,
    )
  else if (paths) print(`${label('Linked')}${dim('no — `design link`')}`)
  print(`${label('Since')}${date(data.memberSince)} ${dim(`· plans and upgrades: ${host.replace(/\/+$/, '')}/plans`)}`)
}
