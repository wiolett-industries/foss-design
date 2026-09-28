import fs from 'node:fs'
import path from 'node:path'
import { mapLimit } from '../capture/frames'
import { CliError } from '../cli/log'
import { canvasCodeFiles, GO_REMOVED, legacyGoLines } from '../core/canvas'
import { isInside, relToRoot } from '../core/paths'
import { DesignProject } from '../core/project'
import { STATIC_URLS } from '../core/sources'
import { toPosix } from '../core/text'
import { CloudError, type PushUnit, type RemoteUnit } from './client'
import { finishMerge, readMergeState } from './merge'
import { syncProjectMeta } from './meta'
import { hashes, incomingDir, type UnitStatus, unitStatus, writeLink } from './state'
import {
  byUnit,
  megabytes,
  newReport,
  plural,
  rate,
  type SyncContext,
  type SyncReport,
  seconds,
  TRANSFERS,
  type UnitReport,
  unique,
  unitArg,
  webUrl,
} from './sync'
import {
  buildManifest,
  buildUnit,
  caseClashes,
  hashFile,
  type Manifest,
  SYSTEM_UNIT,
  scanLocal,
  unitBuildDir,
  unitCanvasId,
  unitRoot,
} from './units'

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
export async function push(
  ctx: SyncContext,
  options: {
    units: string[]
    resolved: string[]
    /** Before the canvases build (their cover snapshots); returns lines for the report. */
    beforeBuild?: (canvasIds: string[]) => Promise<string[]>
  },
): Promise<SyncReport> {
  const { paths, client, log } = ctx
  const link = structuredClone(ctx.link)
  const report = newReport('push', link)
  // The project's name and icon are no units: they sync first, whatever the units do.
  for (const line of await syncProjectMeta(ctx.paths, ctx.client, link)) report.hints.push(line)
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

  // A merge whose conflicts were all edited away is done: its files are the result.
  for (const key of Object.keys(link.conflicts)) if (readMergeState(paths, key)) finishMerge(paths, link, key)
  // --resolved: the merge is done, so the base moves to the head pull recorded. Saved only once the push lands.
  for (const key of resolved) {
    const head = link.conflicts[key]
    if (head === undefined) {
      if (link.units[key]) continue
      throw new CliError(`${key} has no pending conflict; --resolved is for units \`design pull\` reported in conflict`)
    }
    if (readMergeState(paths, key)) {
      const open = finishMerge(paths, link, key, true)
      if (open.length)
        throw new CliError(`${key} still has conflict markers in ${open.map((item) => item.path).join(', ')}`)
      continue
    }
    link.units[key] = { rev: head, files: link.units[key]?.files ?? {} }
    delete link.conflicts[key]
  }
  const status = (key: string) => unitStatus(key, link, scan.units.get(key)?.manifest, remote, paths.design)

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
      if (s.changed.length || s.usesChanged.length || s.conflictRev !== undefined) candidates.push(key)
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

  // A system change rebuilds every canvas, so each of them has to build without go().
  refuseLegacyGo(paths, toPush.includes(SYSTEM_UNIT) ? scan.units.keys() : toPush)

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
        blockedReport(
          s,
          readMergeState(paths, key)
            ? 'a merge with the cloud has conflicts left: `design merge` lists them and settles them'
            : `pull left the cloud version in ${dir}; merge it, then \`design push --resolved ${key}\``,
        ),
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
    if (systemPush || resolved.includes(key) || s.changed.length || s.usesChanged.length || !remote.has(key))
      return true
    report.units.push({ unit: key, action: 'unchanged', rev: s.baseRev, url: webUrl(link, key) })
    return false
  })
  if (!pushing.length) return report
  const canvasIds = pushing.map(unitCanvasId).filter((id): id is string => id !== null)
  if (options.beforeBuild) for (const line of await options.beforeBuild(canvasIds)) report.hints.push(line)

  const project = new DesignProject(paths, STATIC_URLS)
  const systemRev = remote.get(SYSTEM_UNIT)?.headRev ?? 0
  const units: PushUnit[] = []
  const deps = new Map<string, Record<string, string>>()
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
    deps.set(key, borrowedFiles(paths, key, result.modules))
    const uses = status(key).usesChanged
    if (uses.length && !status(key).changed.length)
      report.hints.push(
        `${key} is pushed for files it uses from outside its folder: ${uses.slice(0, 3).join(', ')}${uses.length > 3 ? ` and ${uses.length - 3} more` : ''}`,
      )
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
    const bar = ctx.progress()
    const started = Date.now()
    let sentFiles = 0
    let sentBytes = 0
    const line = () =>
      `Uploading ${sentFiles}/${missing.length} files · ${megabytes(sentBytes)} of ${megabytes(bytes)}${rate(sentBytes, started)}`
    bar.update(line())
    await mapLimit(missing, TRANSFERS, async (hash) => {
      const file = files.get(hash)!
      const data = fs.readFileSync(file)
      try {
        await client.putBlob(link.project, hash, data)
      } catch (error) {
        // Name the file: a 413 is about this one, not about the whole push.
        if (error instanceof CloudError && error.status === 413)
          throw new CliError(`${path.relative(process.cwd(), file)} (${megabytes(data.length)}): ${error.message}`)
        throw error
      }
      sentFiles++
      sentBytes += data.length
      bar.update(line())
    })
    bar.done(`Uploaded ${plural(missing.length, 'file')} (${megabytes(bytes)}) in ${seconds(started)}`)
  }

  log(`Pushing ${plural(units.length, 'unit')}…`)
  let revs: Awaited<ReturnType<typeof client.push>>
  try {
    revs = await client.push(link.project, units)
  } catch (error) {
    // Someone pushed between our look at the cloud and this commit (the server serializes pushes
    // and takes the first): the same as finding the cloud ahead, which `design push` merges in.
    if (!(error instanceof CloudError) || error.status !== 409 || error.error !== 'conflict') throw error
    report.ok = false
    report.error = {
      code: 'pull_first',
      message: 'Nothing was pushed: someone pushed first. Run `design pull`, then push again.',
    }
    return report
  }
  for (const unit of units) {
    const rev = revs.get(unit.key) ?? unit.baseRev + 1
    const used = deps.get(unit.key)
    link.units[unit.key] = {
      rev,
      files: hashes(unit.source),
      ...(used && Object.keys(used).length ? { deps: used } : {}),
    }
    report.units.push({
      unit: unit.key,
      action: unit.baseRev ? 'pushed' : 'created',
      rev,
      baseRev: unit.baseRev,
      url: webUrl(link, unit.key),
    })
  }
  for (const key of resolved) fs.rmSync(incomingDir(paths, key), { recursive: true, force: true })
  writeLink(paths, link)
  report.units.sort((a, b) => byUnit(a.unit, b.unit))
  return report
}

/**
 * The files a unit's build took from outside the unit (another canvas's screen, a module shared in
 * `.design`, the app's source through an alias), relative to `.design`, with their sha256. The
 * system unit's files are left out: a system change pushes every canvas anyway.
 */
function borrowedFiles(paths: SyncContext['paths'], key: string, modules: string[]): Record<string, string> {
  const own = [unitRoot(paths, key), paths.system, paths.config]
  const out: Record<string, string> = {}
  for (const rel of modules) {
    const file = path.join(paths.root, rel)
    if (own.some((dir) => file === dir || isInside(dir, file)) || isInside(paths.cache, file)) continue
    try {
      out[toPosix(path.relative(paths.design, file))] = hashFile(file).hash
    } catch {}
  }
  return out
}

/** Screens still calling the removed `go()` stop the push before anything is built. */
function refuseLegacyGo(paths: SyncContext['paths'], keys: Iterable<string>) {
  const project = new DesignProject(paths, STATIC_URLS)
  const hits = new Set<string>()
  for (const key of keys) {
    if (!key.startsWith('canvas/')) continue
    const id = key.slice('canvas/'.length)
    for (const file of canvasCodeFiles(path.join(paths.canvases, id), project.canvas(id)?.screens ?? [])) {
      for (const line of legacyGoLines(file)) hits.add(`${relToRoot(paths, file)}:${line}`)
    }
  }
  if (!hits.size) return
  const list = [...hits]
  throw new CliError(
    `${GO_REMOVED}.\nStill using go():\n  ${list.slice(0, 20).join('\n  ')}${list.length > 20 ? `\n  …and ${list.length - 20} more` : ''}`,
  )
}
