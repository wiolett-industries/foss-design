#!/usr/bin/env node
// One version for the npm package and both plugin manifests.
//
//   node scripts/versions.mjs            check they agree (and, with a tag, match it)
//   node scripts/versions.mjs v0.2.0     check they are 0.2.0
//   node scripts/versions.mjs --set 0.2.0
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = ['packages/design/package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const args = process.argv.slice(2)

if (args[0] === '--set') {
  const version = args[1]?.replace(/^v/, '')
  if (!version || !SEMVER.test(version)) {
    console.error('Usage: node scripts/versions.mjs --set <x.y.z>')
    process.exit(2)
  }
  for (const file of files) {
    const full = path.join(root, file)
    const text = fs.readFileSync(full, 'utf8')
    // Replace in place so the files keep their formatting.
    fs.writeFileSync(full, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`))
    console.log(`${file} → ${version}`)
  }
  process.exit(0)
}

const versions = files.map((file) => [file, read(file).version])
const expected = args[0]?.replace(/^v/, '') ?? versions[0][1]
const wrong = versions.filter(([, version]) => version !== expected)
if (!SEMVER.test(expected) || wrong.length) {
  for (const [file, version] of versions)
    console.error(`${version === expected ? 'ok   ' : 'wrong'} ${file}: ${version}`)
  console.error(`Expected ${expected}. Fix with: node scripts/versions.mjs --set ${expected}`)
  process.exit(1)
}
console.log(`All versions are ${expected}`)
