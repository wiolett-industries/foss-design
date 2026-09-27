import fs from 'node:fs'
import path from 'node:path'
import { CliError } from '../cli/log'
import { isInside } from '../core/paths'

/** Write a file under `root`, refusing to follow a folder link out of it. */
export function writeInside(root: string, rel: string, data: Buffer) {
  const file = path.join(root, rel)
  if (!isInside(root, file)) throw new CliError(`Refusing to write outside ${root}: ${rel}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!isInside(fs.realpathSync(root), fs.realpathSync(path.dirname(file))))
    throw new CliError(`Refusing to write through a link out of ${root}: ${rel}`)
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file)
  fs.writeFileSync(file, data)
}

/** Remove folders left empty under `stop`, from `dir` up. */
export function pruneEmpty(dir: string, stop: string) {
  let current = dir
  while (isInside(stop, current) && current !== stop) {
    try {
      if (fs.readdirSync(current).length) return
      fs.rmdirSync(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}
