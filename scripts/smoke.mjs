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
  const out = execFileSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: 'utf8' })
  process.stdout.write(out)
  return out
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
} finally {
  try {
    execFileSync(process.execPath, [cli, 'stop', '--all'], { cwd: project, env, stdio: 'ignore' })
  } catch {}
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 })
}
