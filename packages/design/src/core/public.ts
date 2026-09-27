import fs from 'node:fs'
import path from 'node:path'
import { isInside } from './paths'
import { toPosix } from './text'

/**
 * The files of the public folder (design.json `public`), relative to it, with forward slashes:
 * no dot-files, no `node_modules`, and links only when they point inside the folder, so a
 * link cannot put a file from elsewhere on the machine into a build that gets pushed.
 */
export function publicFiles(dir: string): string[] {
  const files: string[] = []
  let root: string
  try {
    root = fs.realpathSync(dir)
  } catch {
    return files
  }
  const visit = (current: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) files.push(toPosix(path.relative(dir, full)))
      else if (entry.isSymbolicLink()) {
        try {
          const target = fs.realpathSync(full)
          if (isInside(root, target) && fs.statSync(target).isFile()) files.push(toPosix(path.relative(dir, full)))
        } catch {}
      }
    }
  }
  visit(dir)
  return files.sort()
}
