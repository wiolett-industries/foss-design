import fs from 'node:fs'
import path from 'node:path'
import { mapLimit } from '../capture/frames'
import { CliError } from '../cli/log'
import { type DesignPaths, isInside } from '../core/paths'
import type { RemoteUnit } from './client'
import { finishMerge, mergeUnit, openConflicts, readMergeState } from './merge'
import { syncProjectMeta } from './meta'
import { allUnitKeys, hashes, incomingDir, unitStatus, writeLink } from './state'
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
} from './sync'
import { caseClashes, isUnitPath, type Manifest, SYSTEM_UNIT, scanLocal, unitRoot } from './units'
import { pruneEmpty, writeInside } from './write'

const HASH = /^[0-9a-f]{64}$/
const MERGE_HINT =
  'Resolve with `design merge` (it lists the files; `--here` or `--cloud` settles one or a unit), then `design push`.'

type Plan =
  | { key: string; kind: 'apply'; remote: RemoteUnit | null; report: UnitReport }
  | { key: string; kind: 'merge'; remote: RemoteUnit; report: UnitReport }

/** Refuse a remote manifest that would write outside its unit. */
function checkManifest(key: string, manifest: Manifest) {
  for (const [rel, entry] of Object.entries(manifest)) {
    if (!isUnitPath(key, rel)) throw new CliError(`The cloud sent a path that does not belong to ${key}: "${rel}"`)
    if (!HASH.test(entry.hash)) throw new CliError(`The cloud sent a bad hash for ${rel} in ${key}`)
  }
}

/** Make the unit's synced files equal the remote manifest (or remove them when the unit is gone). */
function applyUnit(paths: DesignPaths, key: string, local: Manifest, target: Manifest, blobs: Map<string, Buffer>) {
  const counts = { added: 0, changed: 0, removed: 0 }
  // Empty folders go up to the canvas list for a canvas, up to .design for the system; never those two.
  const stop = key === SYSTEM_UNIT ? paths.design : path.dirname(unitRoot(paths, key))
  for (const rel of Object.keys(local)) {
    if (rel in target) continue
    const file = path.join(paths.design, rel)
    fs.rmSync(file, { force: true })
    pruneEmpty(path.dirname(file), stop)
    counts.removed++
  }
  for (const [rel, entry] of Object.entries(target)) {
    if (local[rel]?.hash === entry.hash) continue
    writeInside(paths.design, rel, blobs.get(entry.hash)!)
    if (local[rel]) counts.changed++
    else counts.added++
  }
  return counts
}

/**
 * `design pull` (D6): apply the cloud head to every unit without local changes; merge units
 * changed on both sides three ways against their base (merge.ts). A clean merge leaves the unit at
 * the cloud head with the local changes on top, ready to push; conflicts wait for `design merge`.
 */
export async function pull(ctx: SyncContext, options: { units: string[]; theirs: string[] }): Promise<SyncReport> {
  const { paths, client } = ctx
  const link = structuredClone(ctx.link)
  const report = newReport('pull', link)
  // The project's name and icon are no units: they sync first, whatever the units do.
  for (const line of await syncProjectMeta(ctx.paths, ctx.client, link)) report.hints.push(line)
  const selected = unique(options.units.map(unitArg))
  const theirs = unique(options.theirs.map(unitArg))

  const scan = scanLocal(paths)
  const remote = await client.units(link.project)
  const local = (key: string) => scan.units.get(key)?.manifest ?? {}

  const keys =
    selected.length || theirs.length ? unique([...selected, ...theirs]) : allUnitKeys(link, new Map(), remote)
  const clashes = caseClashes([...remote.keys(), ...scan.units.keys(), ...Object.keys(link.units)])
  const plans: Plan[] = []
  for (const key of keys.sort(byUnit)) {
    const clash = clashes.get(key)
    if (clash !== undefined) {
      // One folder on case-insensitive disks: writing either would silently replace the other.
      report.units.push({
        unit: key,
        action: 'conflict',
        message: `differs from ${clash} only by letter case; rename one of them before pulling`,
      })
      continue
    }
    const unit = remote.get(key) ?? null
    const s = unitStatus(key, link, scan.units.get(key)?.manifest, remote)
    if (!unit && !link.units[key] && link.conflicts[key] === undefined) {
      if (selected.includes(key) || theirs.includes(key))
        report.units.push({ unit: key, action: 'local_only', message: 'not in the cloud; `design push` creates it' })
      continue
    }
    if (unit?.archived || unit?.banned) {
      report.units.push({
        unit: key,
        action: unit.archived ? 'archived' : 'banned',
        baseRev: s.baseRev,
        headRev: unit.headRev,
        message: unit.archived ? 'archived in the cloud; left as it is' : 'blocked by moderation; left as it is',
      })
      continue
    }
    const reportFor = (action: UnitReport['action']): UnitReport => ({
      unit: key,
      action,
      rev: unit?.headRev,
      baseRev: s.baseRev,
    })
    if (theirs.includes(key)) {
      const entry = reportFor(unit ? (s.local ? 'updated' : 'created') : 'deleted')
      entry.message = 'local changes discarded'
      plans.push({ key, kind: 'apply', remote: unit, report: entry })
    } else if (!s.ahead) {
      const merging = readMergeState(paths, key)
      const open = merging ? openConflicts(paths, merging) : []
      if (open.length) {
        report.units.push({ ...reportFor('conflict'), rev: s.baseRev, conflicts: open, message: MERGE_HINT })
        continue
      }
      // A conflict recorded at a head this base already covers is settled.
      if (s.conflictRev !== undefined) {
        finishMerge(paths, link, key, true)
        fs.rmSync(incomingDir(paths, key), { recursive: true, force: true })
      }
      report.units.push({ ...reportFor('up_to_date'), rev: s.baseRev })
    } else if (!s.changed.length) {
      plans.push({
        key,
        kind: 'apply',
        remote: unit,
        report: reportFor(!unit ? 'deleted' : !s.local && !s.baseRev ? 'created' : 'updated'),
      })
    } else if (unit && !s.remoteChanged.length) {
      // The cloud only rebuilt it (a system push): take the new base, keep the local changes.
      link.units[key] = { rev: unit.headRev, files: hashes(unit.manifest) }
      report.units.push({
        ...reportFor('updated'),
        files: { added: 0, changed: 0, removed: 0 },
        message: 'rebuilt in the cloud with the same files; your local changes are kept',
      })
    } else if (!unit) {
      // Deleted in the cloud, changed here: keep the work; the next push creates the canvas again.
      delete link.units[key]
      report.units.push({
        ...reportFor('kept'),
        message: 'deleted in the cloud; your local changes are kept and `design push` creates it again',
      })
    } else {
      plans.push({ key, kind: 'merge', remote: unit, report: { ...reportFor('merged'), headRev: unit.headRev } })
    }
  }

  // Everything the plans write, fetched and checked before any file changes.
  const byHash = new Map<string, string>()
  for (const unit of scan.units.values())
    for (const [rel, entry] of Object.entries(unit.manifest)) byHash.set(entry.hash, path.join(paths.design, rel))
  const needed = new Set<string>()
  // Bases of files changed on both sides: the cloud may have let some go (a deleted revision).
  const bases = new Set<string>()
  for (const plan of plans) {
    if (!plan.remote) continue
    checkManifest(plan.key, plan.remote.manifest)
    for (const entry of Object.values(plan.remote.manifest)) needed.add(entry.hash)
    if (plan.kind !== 'merge') continue
    const base = link.units[plan.key]?.files ?? {}
    const here = local(plan.key)
    for (const [rel, hash] of Object.entries(base)) {
      const h = here[rel]?.hash
      const c = plan.remote.manifest[rel]?.hash
      if (h && c && h !== hash && c !== hash && h !== c) bases.add(hash)
    }
  }
  for (const hash of bases) if (!needed.has(hash) && byHash.has(hash)) needed.add(hash)
  const blobs = new Map<string, Buffer>()
  const download: string[] = []
  for (const hash of needed) {
    const file = byHash.get(hash)
    if (file) blobs.set(hash, fs.readFileSync(file))
    else download.push(hash)
  }
  if (download.length) {
    const bar = ctx.progress()
    const started = Date.now()
    let gotFiles = 0
    let gotBytes = 0
    const line = () =>
      `Downloading ${gotFiles}/${download.length} files · ${megabytes(gotBytes)}${rate(gotBytes, started)}`
    bar.update(line())
    await mapLimit(download, TRANSFERS, async (hash) => {
      const data = await client.getBlob(link.project, hash)
      blobs.set(hash, data)
      gotFiles++
      gotBytes += data.length
      bar.update(line())
    })
    bar.done(`Downloaded ${plural(download.length, 'file')} (${megabytes(gotBytes)}) in ${seconds(started)}`)
  }
  // Bases the cloud still has; one it let go leaves its file to merge without a base.
  await mapLimit(
    [...bases].filter((hash) => !blobs.has(hash)),
    TRANSFERS,
    async (hash) => {
      try {
        blobs.set(hash, await client.getBlob(link.project, hash))
      } catch {}
    },
  )

  for (const plan of plans) {
    const { key, report: entry } = plan
    if (plan.kind === 'apply') {
      entry.files = applyUnit(paths, key, local(key), plan.remote?.manifest ?? {}, blobs)
      if (plan.remote) link.units[key] = { rev: plan.remote.headRev, files: hashes(plan.remote.manifest) }
      else delete link.units[key]
      delete link.conflicts[key]
      fs.rmSync(incomingDir(paths, key), { recursive: true, force: true })
    } else {
      const result = mergeUnit(
        paths,
        key,
        plan.remote.headRev,
        link.units[key]?.files ?? {},
        local(key),
        plan.remote.manifest,
        (hash) => blobs.get(hash),
      )
      fs.rmSync(incomingDir(paths, key), { recursive: true, force: true })
      // The base moves to the cloud head either way: what is here now is the local work on top of it.
      link.units[key] = { rev: plan.remote.headRev, files: hashes(plan.remote.manifest) }
      entry.rev = plan.remote.headRev
      entry.files = result.files
      if (result.conflicts.length) {
        link.conflicts[key] = plan.remote.headRev
        entry.action = 'conflict'
        entry.conflicts = result.conflicts
        entry.message = `${plural(result.conflicts.length, 'file')} changed on both sides did not merge. ${MERGE_HINT}`
      } else {
        delete link.conflicts[key]
        entry.message = `merged with the cloud's changes (r${plan.remote.headRev})${result.files.merged ? `, ${plural(result.files.merged, 'file')} line by line` : ''}; \`design push\` takes your changes up`
      }
    }
    report.units.push(entry)
  }
  writeLink(paths, link)

  report.units.sort((a, b) => byUnit(a.unit, b.unit))
  const conflicts = report.units.filter((entry) => entry.action === 'conflict')
  if (conflicts.length) {
    report.ok = false
    report.error = {
      code: 'conflict',
      message: `${plural(conflicts.length, 'unit')} changed both here and in the cloud and did not merge cleanly. ${MERGE_HINT}`,
    }
  }
  return report
}
