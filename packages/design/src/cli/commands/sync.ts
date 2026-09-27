import { CloudError } from '../../cloud/client'
import { pull } from '../../cloud/pull'
import { push } from '../../cloud/push'
import { readLink } from '../../cloud/state'
import { openSync, plural, type SyncContext, type SyncReport, type UnitReport, webUrl } from '../../cloud/sync'
import type { DesignPaths } from '../../core/paths'
import { bold, CliError, dim, green, print, progress, red, yellow } from '../log'

const GOOD = new Set<UnitReport['action']>(['pushed', 'created', 'updated', 'deleted'])
const BAD = new Set<UnitReport['action']>(['conflict', 'remote_ahead'])
const QUIET = new Set<UnitReport['action']>(['up_to_date', 'unchanged'])

function revs(entry: UnitReport): string {
  if (entry.action === 'created') return entry.rev !== undefined ? `r${entry.rev}` : ''
  if (entry.action === 'deleted') return ''
  if (GOOD.has(entry.action))
    return entry.baseRev && entry.baseRev !== entry.rev ? `r${entry.baseRev} → r${entry.rev}` : `r${entry.rev}`
  if (BAD.has(entry.action) && entry.headRev !== undefined) return `r${entry.baseRev ?? 0} → r${entry.headRev}`
  return ''
}

function printReport(report: SyncReport) {
  const verb = report.command === 'push' ? 'Pushed to' : 'Pulled from'
  const shown = report.units.filter((entry) => !QUIET.has(entry.action))
  const quiet = report.units.length - shown.length
  const moved = report.units.some((entry) => GOOD.has(entry.action))
  if (report.ok && !moved) print(`${bold(`Nothing to ${report.command}`)} ${dim(report.url)}`)
  else if (report.ok) print(`${bold(verb)} ${report.url}`)
  else print(`${bold(report.command === 'push' ? 'Push stopped' : 'Pull finished with conflicts')} ${dim(report.host)}`)
  const width = Math.max(0, ...shown.map((entry) => entry.unit.length))
  for (const entry of shown) {
    const mark = GOOD.has(entry.action) ? green('✓') : BAD.has(entry.action) ? red('✗') : yellow('!')
    const files = entry.files
      ? dim(
          [
            entry.files.added && `+${entry.files.added}`,
            entry.files.changed && `~${entry.files.changed}`,
            entry.files.removed && `-${entry.files.removed}`,
          ]
            .filter(Boolean)
            .join(' '),
        )
      : ''
    const detail = [entry.action.replaceAll('_', ' '), revs(entry), files].filter(Boolean).join('  ')
    print(`  ${mark} ${entry.unit.padEnd(width)}  ${detail}`)
    if (entry.url && GOOD.has(entry.action)) print(`      ${dim('→')} ${entry.url}`)
    if (entry.message) print(`      ${dim(entry.message)}`)
  }
  if (quiet) print(dim(`  ${plural(quiet, 'unit')} ${report.command === 'push' ? 'unchanged' : 'up to date'}`))
  for (const hint of report.hints) print(dim(hint))
}

async function runSync(
  paths: DesignPaths,
  command: SyncReport['command'],
  json: boolean,
  run: (ctx: SyncContext) => Promise<SyncReport>,
) {
  let report: SyncReport
  try {
    report = await run(json ? openSync(paths, () => {}) : openSync(paths, (line) => print(dim(line)), progress))
  } catch (error) {
    if (!json) throw error
    let link: ReturnType<typeof readLink> = null
    try {
      link = readLink(paths)
    } catch {}
    const cloud = error instanceof CloudError ? error : null
    const failure: SyncReport = {
      ok: false,
      command,
      host: link?.host ?? '',
      project: link?.project ?? '',
      url: link ? webUrl(link) : '',
      units: [],
      hints: [],
      error: {
        code: cloud?.error ?? (error instanceof CliError ? 'error' : 'internal'),
        message: (error as Error).message,
        status: cloud?.status || undefined,
        limit: cloud?.limit,
      },
    }
    print(JSON.stringify(failure, null, 2))
    process.exitCode = error instanceof CliError ? error.code : 1
    return
  }
  if (json) {
    print(JSON.stringify(report, null, 2))
    if (!report.ok) process.exitCode = 2
    return
  }
  printReport(report)
  if (!report.ok && report.error) throw new CliError(report.error.message, 2)
}

export function runPush(paths: DesignPaths, units: string[], options: { resolved: string[]; json: boolean }) {
  return runSync(paths, 'push', options.json, (ctx) => push(ctx, { units, resolved: options.resolved }))
}

export function runPull(paths: DesignPaths, units: string[], options: { theirs: string[]; json: boolean }) {
  return runSync(paths, 'pull', options.json, (ctx) => pull(ctx, { units, theirs: options.theirs }))
}
