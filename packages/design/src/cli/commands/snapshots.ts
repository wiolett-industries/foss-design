import { staleSnapshots, takeSnapshots } from '../../capture/cover'
import type { DesignPaths } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { CliError, dim, green, print, progress } from '../log'
import { ensureServer } from './preview'

/**
 * `design snapshots [<canvas>[/<screen>]…] [--page <id>]`: take the snapshots screens lack, in both
 * themes (the one a screen pins), for the viewer to show while frames do not run. `design push`
 * does the same for the canvases it pushes.
 */
export async function runSnapshots(paths: DesignPaths, targets: string[], options: { page?: string }) {
  const known = new DesignProject(paths, DEV_URLS).canvasIds()
  const picked = new Map<string, Set<string> | null>()
  for (const target of targets) {
    const [canvas = '', screen] = target.split('/')
    if (!known.includes(canvas))
      throw new CliError(`No canvas "${canvas}". Canvases: ${known.join(', ') || 'none yet'}`)
    const screens = picked.has(canvas) ? picked.get(canvas)! : new Set<string>()
    picked.set(canvas, !screen || screens === null ? null : screens.add(screen))
  }
  if (options.page && picked.size !== 1)
    throw new CliError('--page needs exactly one canvas: `design snapshots <canvas> --page <id>`')
  const project = new DesignProject(paths, DEV_URLS)
  for (const [canvas, screens] of picked) {
    if (!screens) continue
    const ids = new Set(project.canvas(canvas)!.screens.map((screen) => screen.id))
    const missing = [...screens].filter((id) => !ids.has(id))
    if (missing.length)
      throw new CliError(
        `No screen ${missing.map((id) => `"${id}"`).join(', ')} in "${canvas}". Screens: ${[...ids].slice(0, 30).join(', ')}${ids.size > 30 ? ', …' : ''}`,
      )
  }
  const canvases = picked.size ? [...picked.keys()] : known
  const stale = canvases.flatMap((canvas) =>
    staleSnapshots(paths, [canvas], { page: options.page, screens: picked.get(canvas) ?? undefined }),
  )
  if (!stale.length) return print(green('✓ Every screen has current snapshots in both themes.'))
  print(dim(`${stale.length} snapshot${stale.length === 1 ? '' : 's'} to take`))
  const lines = await takeSnapshots(
    paths,
    stale,
    async () => `http://127.0.0.1:${(await ensureServer(paths, {})).port}`,
    progress(),
  )
  for (const line of lines) print(line)
}
