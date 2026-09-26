import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildSite } from '../../build/static'
import { type DesignPaths, PKG } from '../../core/paths'
import { bold, CliError, dim, print, warn } from '../log'

function pack(out: string): string {
  const archive = `${out.replace(/[\\/]+$/, '')}.tar.gz`
  fs.rmSync(archive, { force: true })
  const entries = fs.readdirSync(out)
  // COPYFILE_DISABLE keeps macOS tar from adding ._ resource files.
  const result = spawnSync('tar', ['-czf', archive, '-C', out, ...entries], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  if (result.status !== 0)
    throw new CliError(`tar failed: ${result.stderr?.toString().trim() || result.error?.message}`)
  return archive
}

export async function runBuild(paths: DesignPaths, canvases: string[], options: { out?: string; tar: boolean }) {
  if (!fs.existsSync(path.join(PKG.viewer, 'index.html'))) {
    throw new CliError('The viewer is missing from this foss-design install (dist/viewer). Rebuild or reinstall it.')
  }
  const out = path.resolve(options.out ?? path.join(paths.cache, 'site'))
  if (out === paths.root || out === paths.design) throw new CliError(`Refusing to build into ${out}`)
  print(dim(`Building ${canvases.length ? canvases.join(', ') : 'every canvas'} and the design system…`))
  let result: Awaited<ReturnType<typeof buildSite>>
  try {
    result = await buildSite(paths, out, { canvases: canvases.length ? canvases : undefined })
  } catch (error) {
    throw new CliError((error as Error).message)
  }
  if (result.absoluteAssets)
    warn('the viewer references assets by absolute path; the site only works at the root of a host')

  print(`${bold('Site')}    ${out}`)
  print(
    `${bold('Frames')}  ${result.frames} ${dim(`(${result.canvases.length} canvas${result.canvases.length === 1 ? '' : 'es'})`)}`,
  )
  if (options.tar) print(`${bold('Archive')} ${pack(out)} ${dim('(index.html at the root)')}`)
  if (result.errors)
    warn(`${result.errors} error${result.errors === 1 ? '' : 's'} in the built canvases — \`design check\` lists them`)
}
