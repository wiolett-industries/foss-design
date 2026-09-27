#!/usr/bin/env node
// Smoke test of the packed CLI, the same on Linux, macOS and Windows: pack packages/design,
// install the tarball into a temporary project and drive it from init to a rendered check,
// a shot, a build, and the preview server's lifecycle (the machine-wide registry included).
// Needs `pnpm build` first and Chrome for --render and shot.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const windows = process.platform === 'win32'
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-design-smoke-'))
// A registry of its own, so previews other runs left on this machine do not count.
const cache = path.join(work, 'cache')
const env = { ...process.env, XDG_CACHE_HOME: cache, LOCALAPPDATA: cache, NO_COLOR: '1' }
// On CI the preview server logs what Vite resolves and loads, for the log below when a step fails.
if (process.env.CI) env.DEBUG = 'vite:*'

function npm(args, cwd) {
  const result = spawnSync('npm', args, { cwd, env, encoding: 'utf8', shell: windows })
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

const packed = npm(['pack', '--pack-destination', work, '--silent'], path.join(root, 'packages', 'design'))
const tarball = path.join(work, packed.trim().split('\n').pop())
const project = path.join(work, 'project')
fs.mkdirSync(project)
fs.writeFileSync(path.join(project, 'package.json'), '{"name":"smoke","private":true}\n')
npm(['install', '--no-audit', '--no-fund', tarball], project)
const cli = path.join(project, 'node_modules', 'foss-design', 'dist', 'cli.js')

function design(...args) {
  console.log(`$ design ${args.join(' ')}`)
  try {
    const out = execFileSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: 'utf8' })
    process.stdout.write(out)
    return out
  } catch (error) {
    // What the command said, and the preview server's log, which says why frames failed.
    process.stdout.write(error.stdout ?? '')
    process.stderr.write(error.stderr ?? '')
    const log = path.join(project, '.design', '.cache', 'server.log')
    if (fs.existsSync(log)) {
      const lines = fs.readFileSync(log, 'utf8').split('\n')
      const telling = lines.filter((line) => /client|error|denied|not found|404|fs\b/i.test(line)).slice(-120)
      console.error(`--- .design/.cache/server.log (${lines.length} lines; the telling ones)\n${telling.join('\n')}`)
    }
    throw new Error(`design ${args.join(' ')} failed`)
  }
}

const previews = () => JSON.parse(design('previews', '--json')).previews
const fail = (message) => {
  throw new Error(message)
}

try {
  design('--version')
  design('init', '--name', 'smoke')
  design('system', 'init')
  design('new', 'smoke')
  design('check', '--render')
  design('shot', 'smoke')
  design('build', '--tar')

  design('preview')
  const first = previews()
  if (first.length !== 1 || !first[0].tracked) fail(`expected one tracked preview, got ${JSON.stringify(first)}`)
  design('preview', '--restart')
  const second = previews()
  if (second.length !== 1 || second[0].pid === first[0].pid || !second[0].tracked)
    fail(`a restart should leave one new tracked preview, got ${JSON.stringify(second)}`)
  design('stop', '--all')
  if (previews().length) fail('stop --all left previews running')
  console.log('Smoke test passed.')
} catch (error) {
  // Ask the server that failed directly: whose 404 it is, and what it says.
  try {
    const state = JSON.parse(fs.readFileSync(path.join(project, '.design', '.cache', 'server.json'), 'utf8'))
    for (const probe of ['/_fs/@vite/client', '/_fs/canvas/smoke/screens/Main.tsx']) {
      const res = await fetch(`${state.url}${probe}`)
      console.error(`--- GET ${probe} → ${res.status}\n${(await res.text()).slice(0, 400)}`)
    }
  } catch (probeError) {
    console.error(`--- probe failed: ${probeError}`)
  }
  throw error
} finally {
  try {
    execFileSync(process.execPath, [cli, 'stop', '--all'], { cwd: project, env, stdio: 'ignore' })
  } catch {}
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 })
}
