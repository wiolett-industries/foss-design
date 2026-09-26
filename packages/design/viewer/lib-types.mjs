// Finishes the declarations of `foss-design/viewer` after `tsc -p viewer/tsconfig.lib.json`:
// the viewer imports the shared contracts as `@shared/…`, which only its own builds resolve,
// so those imports become relative; the stylesheet import goes, it ships on its own.
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(import.meta.dirname, '../dist/viewer-lib')
const types = path.join(out, 'types')
const shared = path.join(types, 'src/shared')

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* files(file)
    else if (entry.name.endsWith('.d.ts')) yield file
  }
}

for (const file of files(types)) {
  const text = fs.readFileSync(file, 'utf8')
  let rel = path.relative(path.dirname(file), shared).split(path.sep).join('/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  const next = text.replace(/(['"])@shared\//g, `$1${rel}/`).replace(/^import ['"]\.\/styles\.css['"];\n/m, '')
  if (next !== text) fs.writeFileSync(file, next)
}

fs.writeFileSync(path.join(out, 'index.d.ts'), "export * from './types/viewer/src/library'\n")
