import fs from 'node:fs'
import path from 'node:path'
import { mapLimit } from '../capture/frames'
import { CliError } from '../cli/log'
import { DesignProject } from '../core/project'
import { STATIC_URLS } from '../core/sources'
import type { PushUnit, RemoteUnit } from './client'
import { hashes, incomingDir, type UnitStatus, unitStatus, writeLink } from './state'
import { byUnit, newReport, plural, type SyncContext, type SyncReport, type UnitReport, unique, unitArg } from './sync'
import {
  buildManifest,
  buildUnit,
  caseClashes,
  type Manifest,
  SYSTEM_UNIT,
  scanLocal,
  unitBuildDir,
  unitCanvasId,
} from './units'

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

function blockedReport(status: UnitStatus, message: string): UnitReport {
  return {
    unit: status.key,
    action: status.conflictRev !== undefined ? 'conflict' : 'remote_ahead',
    baseRev: status.baseRev,
    headRev: status.conflictRev ?? status.headRev ?? undefined,
    message,
  }
}

/**
 * `design push` (D6): refuse the whole push when the cloud moved past any
 * unit's base, build the changed units, upload the blobs the cloud lacks and
 * commit every unit in one `POST /push`.
 */
export async function push(ctx: SyncContext, options: { units: string[]; resolved: string[] }): Promise<SyncReport> {
  const { paths, client, log } = ctx
  const link = structuredClone(ctx.link)
  const report = newReport('push', link)
  const selected = unique(options.units.map(unitArg))
  const resolved = unique(options.resolved.map(unitArg))

  const scan = scanLocal(paths)
  const remote = await client.units(link.project)
  const clashes = caseClashes([...scan.units.keys(), ...remote.keys()])
  if (clashes.size) {
    const pairs = [...clashes].filter(([a, b]) => a < b).map(([a, b]) => `${a} / ${b}`)
    throw new CliError(
      `These canvases differ only by letter case: ${pairs.join(', ')}. On macOS and Windows they share one folder; rename one of them.`,
    )
  }

  // --resolved: the merge is done, so the base moves to the head pull recorded. Saved only once the push lands.
  for (const key of resolved) {
    const head = link.conflicts[key]
    if (head === undefined)
      throw new CliError(`${key} has no pending conflict; --resolved is for units \`design pull\` reported in conflict`)
    link.units[key] = { rev: head, files: link.units[key]?.files ?? {} }
    delete link.conflicts[key]
  }
  const status = (key: string) => unitStatus(key, link, scan.units.get(key)?.manifest, remote)

  for (const key of selected) {
    if (!scan.units.has(key) && !remote.has(key) && !link.units[key]) {
      const known = [...scan.units.keys()].join(', ') || 'none'
      throw new CliError(`No ${key} here or in the cloud. Units here: ${known}`)
    }
  }

  // What to push: the named units, or everything changed here.
  let candidates: string[]
  if (selected.length) {
    const system = status(SYSTEM_UNIT)
    if (!selected.includes(SYSTEM_UNIT) && scan.units.has(SYSTEM_UNIT) && system.changed.length)
      throw new CliError(
        'The design system has changes that are not in the cloud, and canvases are built against it. ' +
          'Push it too: `design push system <canvas…>`, or `design push` for everything.',
      )
    candidates = unique([...selected, ...resolved])
  } else {
    candidates = [...resolved]
    for (const key of scan.units.keys()) {
      const s = status(key)
      if (s.changed.length || s.conflictRev !== undefined) candidates.push(key)
    }
    candidates = unique(candidates)
  }

  const toPush: string[] = []
  for (const key of candidates.sort(byUnit)) {
    const s = status(key)
    if (!scan.units.has(key)) {
      report.units.push({ unit: key, action: 'missing_locally', message: 'not here; push never deletes in the cloud' })
      continue
    }
    const unit = remote.get(key)
    if (unit?.archived || unit?.banned) {
      report.units.push({
        unit: key,
        action: unit.archived ? 'archived' : 'banned',
        baseRev: s.baseRev,
        message: unit.archived ? 'archived in the cloud; unarchive it in the web app to push' : 'blocked by moderation',
      })
      continue
    }
    toPush.push(key)
  }

  const blocked: UnitReport[] = []
  const systemPush = toPush.includes(SYSTEM_UNIT)
  const activeRemoteCanvases = [...remote.values()].filter(
    (unit: RemoteUnit) => unit.key !== SYSTEM_UNIT && !unit.archived && !unit.banned,
  )
  if (systemPush) {
    // A system change rebuilds every active canvas in the same push (D1).
    for (const unit of activeRemoteCanvases) {
      if (scan.units.has(unit.key)) continue
      const s = status(unit.key)
      blocked.push(
        blockedReport(
          s,
          s.baseRev
            ? `deleted here but active in the cloud, and a system push rebuilds every active canvas; restore it with \`design pull --theirs ${unit.key}\` or archive it in the web app`
            : 'in the cloud but not pulled here, and a system push rebuilds every active canvas; run `design pull`',
        ),
      )
    }
    for (const key of scan.units.keys()) {
      const unit = remote.get(key)
      if (key !== SYSTEM_UNIT && !unit?.archived && !unit?.banned && !toPush.includes(key)) toPush.push(key)
    }
    toPush.sort(byUnit)
  } else if (toPush.length) {
    const system = status(SYSTEM_UNIT)
    if (system.ahead)
      blocked.push(
        blockedReport(system, 'the design system changed in the cloud, and canvases are built against it; pull first'),
      )
  }

  for (const key of toPush) {
    const s = status(key)
    if (s.conflictRev !== undefined) {
      const dir = path.relative(paths.root, incomingDir(paths, key))
      blocked.push(
        blockedReport(s, `pull left the cloud version in ${dir}; merge it, then \`design push --resolved ${key}\``),
      )
    } else if (s.ahead) {
      blocked.push(
        blockedReport(
          s,
          s.deletedRemotely
            ? 'deleted in the cloud; `design pull` keeps your changes as a new canvas'
            : `changed in the cloud since your last pull (r${s.baseRev} → r${s.headRev}); run \`design pull\``,
        ),
      )
    }
  }

  for (const unit of activeRemoteCanvases)
    if (!scan.units.has(unit.key) && !blocked.some((entry) => entry.unit === unit.key))
      report.hints.push(
        `${unit.key} is in the cloud but not here: \`design pull\` fetches it. Push never deletes cloud canvases; archive or delete them in the web app.`,
      )

  if (blocked.length) {
    report.ok = false
    report.units.push(...blocked.sort((a, b) => byUnit(a.unit, b.unit)))
    const conflicts = blocked.some((entry) => entry.action === 'conflict')
    report.error = conflicts
      ? {
          code: 'unresolved_conflict',
          message: 'Nothing was pushed: merge the pending conflicts, then `design push --resolved <unit>`.',
        }
      : {
          code: 'pull_first',
          message: 'Nothing was pushed: the cloud has newer revisions. Run `design pull`, then push again.',
        }
    return report
  }

  // Unchanged units are left alone, unless a system push rebuilds them or a merge is being resolved.
  const pushing = toPush.filter((key) => {
    const s = status(key)
    if (systemPush || resolved.includes(key) || s.changed.length || !remote.has(key)) return true
    report.units.push({ unit: key, action: 'unchanged', rev: s.baseRev })
    return false
  })
  if (!pushing.length) return report

  const project = new DesignProject(paths, STATIC_URLS)
  const systemRev = remote.get(SYSTEM_UNIT)?.headRev ?? 0
  const units: PushUnit[] = []
  const files = new Map<string, string>()
  const addFiles = (manifest: Manifest, dir: string) => {
    for (const [rel, entry] of Object.entries(manifest))
      if (!files.has(entry.hash)) files.set(entry.hash, path.join(dir, rel))
  }
  for (const key of pushing) {
    const id = unitCanvasId(key)
    log(`Building ${key}…`)
    let result: Awaited<ReturnType<typeof buildUnit>>
    try {
      result = await buildUnit(paths, key)
    } catch (error) {
      throw new CliError(`Building ${key} failed: ${(error as Error).message}`)
    }
    if (result.errors)
      report.hints.push(
        `${key} has ${plural(result.errors, 'error')}; \`design check\` lists them. It was pushed as it is.`,
      )
    const source = scan.units.get(key)!.manifest
    const build = buildManifest(unitBuildDir(paths, key))
    addFiles(source, paths.design)
    addFiles(build, unitBuildDir(paths, key))
    units.push({
      key,
      baseRev: status(key).baseRev,
      title: id === null ? (project.system()?.doc.name ?? 'Design system') : (project.canvas(id)?.doc.title ?? id),
      source,
      build,
      systemRev: id === null ? null : systemRev,
    })
  }

  const missing = await client.missing(link.project, [...files.keys()])
  if (missing.length) {
    const unknown = missing.find((hash) => !files.has(hash))
    if (unknown) throw new CliError(`The cloud asked for ${unknown.slice(0, 12)}, which is not part of this push`)
    const bytes = missing.reduce((sum, hash) => sum + fs.statSync(files.get(hash)!).size, 0)
    log(`Uploading ${plural(missing.length, 'file')} (${megabytes(bytes)})…`)
    await mapLimit(missing, 4, async (hash) => {
      await client.putBlob(link.project, hash, fs.readFileSync(files.get(hash)!))
    })
  }

  log(`Pushing ${plural(units.length, 'unit')}…`)
  const revs = await client.push(link.project, units)
  for (const unit of units) {
    const rev = revs.get(unit.key) ?? unit.baseRev + 1
    link.units[unit.key] = { rev, files: hashes(unit.source) }
    report.units.push({ unit: unit.key, action: unit.baseRev ? 'pushed' : 'created', rev, baseRev: unit.baseRev })
  }
  for (const key of resolved) fs.rmSync(incomingDir(paths, key), { recursive: true, force: true })
  writeLink(paths, link)
  report.units.sort((a, b) => byUnit(a.unit, b.unit))
  return report
}
