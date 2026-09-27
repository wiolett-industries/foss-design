import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import {
  type Conflict,
  finishMerge,
  type MergeState,
  mergingUnits,
  openConflicts,
  resolveConflict,
  sideFile,
} from '../../cloud/merge'
import { requireLink, writeLink } from '../../cloud/state'
import { unitArg } from '../../cloud/sync'
import type { DesignPaths } from '../../core/paths'
import { bold, CliError, dim, green, print, red, yellow } from '../log'

const KIND: Record<Conflict['kind'], string> = {
  text: 'both sides changed lines, the markers show them',
  binary: 'both sides changed it; yours is in place',
  deleted_here: 'deleted here, changed in the cloud; the cloud version is in place',
  deleted_in_cloud: 'deleted in the cloud, changed here; yours is in place',
}

/** A target as a unit key, or a file relative to `.design` (from the working folder or `.design`). */
function matchTargets(paths: DesignPaths, states: MergeState[], targets: string[]) {
  const picked: { state: MergeState; conflict: Conflict }[] = []
  for (const target of targets) {
    const unit = states.find((state) => state.unit === unitArg(target))
    if (unit) {
      for (const conflict of openConflicts(paths, unit)) picked.push({ state: unit, conflict })
      continue
    }
    const rel = [path.relative(paths.design, path.resolve(target)), target.replace(/^\.design\//, '')]
    const found = states.flatMap((state) =>
      state.conflicts.filter((item) => rel.includes(item.path)).map((conflict) => ({ state, conflict })),
    )
    if (!found.length) throw new CliError(`No open conflict in ${target}. \`design merge\` lists them.`)
    picked.push(...found)
  }
  return picked
}

function printOpen(paths: DesignPaths, states: MergeState[]) {
  for (const state of states) {
    const open = openConflicts(paths, state)
    if (!open.length) continue
    print(`${bold(state.unit)} ${dim(`merged with cloud r${state.headRev}`)}`)
    for (const conflict of open) {
      print(`  ${red('✗')} ${conflict.path}  ${dim(KIND[conflict.kind])}`)
      const sides = (['here', 'cloud', 'base'] as const)
        .map((side) => `${side}: ${path.relative(process.cwd(), sideFile(paths, state.unit, conflict.path, side))}`)
        .join(' · ')
      print(`      ${dim(sides)}`)
    }
  }
}

/**
 * `design merge [<unit|file>…] [--here|--cloud] [--done]`: settle what a three-way merge with the
 * cloud left in conflict. Without flags it lists the open conflicts, and in a terminal walks
 * through them; `--here` / `--cloud` settle files or whole units with one side; `--done` closes a
 * merge once no conflict markers are left (binary files keep what is in place).
 */
export async function runMerge(
  paths: DesignPaths,
  targets: string[],
  options: { here: boolean; cloud: boolean; done: boolean; json: boolean },
) {
  if (options.here && options.cloud) throw new CliError('Pick one side: --here or --cloud')
  const link = requireLink(paths)
  const states = mergingUnits(paths)
  const close = (accept: boolean, only?: string[]) => {
    const closed: string[] = []
    for (const state of states) {
      if (only && !only.includes(state.unit)) continue
      if (!finishMerge(paths, link, state.unit, accept).length) closed.push(state.unit)
    }
    writeLink(paths, link)
    for (const unit of closed) print(`${green('✓')} ${unit} ${dim('merged; `design push` takes it up')}`)
    return closed
  }

  if (options.here || options.cloud) {
    const side = options.here ? 'here' : 'cloud'
    const picked = targets.length
      ? matchTargets(paths, states, targets)
      : states.flatMap((state) => openConflicts(paths, state).map((conflict) => ({ state, conflict })))
    for (const { state, conflict } of picked) {
      resolveConflict(paths, state, conflict.path, side)
      print(`${green('✓')} ${conflict.path} ${dim(`(${side === 'here' ? 'yours' : "the cloud's"})`)}`)
    }
    close(false)
    return
  }
  if (options.done) {
    const only = targets.length ? targets.map(unitArg) : undefined
    close(true, only)
    const left = states.filter(
      (state) => (!only || only.includes(state.unit)) && openConflicts(paths, state).some((c) => c.kind === 'text'),
    )
    if (left.length) {
      printOpen(paths, left)
      throw new CliError(
        'Conflict markers are left in the files above; edit them out, or settle with --here or --cloud.',
      )
    }
    return
  }

  const open = states.filter((state) => openConflicts(paths, state).length)
  if (options.json) {
    print(
      JSON.stringify({ units: open.map((state) => ({ ...state, conflicts: openConflicts(paths, state) })) }, null, 2),
    )
    if (open.length) process.exitCode = 2
    return
  }
  if (!open.length) {
    close(false)
    if (!states.length) print('Nothing to merge.')
    return
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printOpen(paths, open)
    print(
      dim(
        'Settle with `design merge <file|unit> --here` or `--cloud`, or edit the markers out; then `design merge --done`.',
      ),
    )
    process.exitCode = 2
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (const state of open) {
      for (const conflict of openConflicts(paths, state)) {
        print(`${bold(state.unit)} ${conflict.path} ${dim(`— ${KIND[conflict.kind]}`)}`)
        for (;;) {
          const edit = conflict.kind === 'text' ? ', [e]dit' : ''
          const answer = (await rl.question(`  keep [h]ere, take [c]loud${edit}, [s]kip? `)).trim().toLowerCase()
          if (answer === 'h' || answer === 'c') {
            resolveConflict(paths, state, conflict.path, answer === 'h' ? 'here' : 'cloud')
            break
          }
          if (answer === 's') break
          if (answer === 'e' && edit) {
            const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
            spawnSync(editor, [path.join(paths.design, conflict.path)], { stdio: 'inherit', shell: true })
            if (!openConflicts(paths, state).some((item) => item.path === conflict.path)) break
            print(yellow('  Conflict markers are still there.'))
          }
        }
      }
    }
  } finally {
    rl.close()
  }
  close(false)
  const left = mergingUnits(paths).filter((state) => openConflicts(paths, state).length)
  if (left.length) {
    printOpen(paths, left)
    process.exitCode = 2
  }
}
