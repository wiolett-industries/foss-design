const color = process.stdout.isTTY && !process.env.NO_COLOR
const wrap = (code: string) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)

export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')
export const cyan = wrap('36')

export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message)
  }
}

// A closed pipe (`design status | head`) is not an error worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)
    throw error
  })
}

const live = process.stdout.isTTY === true
/** Whether a progress line is on screen without its newline yet. */
let open = false

/** Ends an in-place progress line, so what comes next starts on a line of its own. */
export function endLine() {
  if (!open) return
  process.stdout.write('\n')
  open = false
}

export function print(line = '') {
  endLine()
  process.stdout.write(`${line}\n`)
}

export function warn(line: string) {
  endLine()
  process.stderr.write(`${yellow('warning')} ${line}\n`)
}

export interface Progress {
  update(line: string): void
  /** The final state, kept on screen. */
  done(line?: string): void
}

export const silentProgress: Progress = { update() {}, done() {} }

/**
 * Progress of a long step. On a terminal one line is redrawn in place, at most ten times a
 * second; in CI and pipes a line is printed every five seconds, so logs stay readable.
 */
export function progress(): Progress {
  let last = 0
  let latest = ''
  const show = (line: string) => {
    if (live) {
      process.stdout.write(`\r\x1b[2K${dim(line)}`)
      open = true
    } else process.stdout.write(`${dim(line)}\n`)
  }
  return {
    update(line) {
      latest = line
      const now = Date.now()
      if (now - last < (live ? 100 : 5000)) return
      last = now
      show(line)
    },
    done(line = latest) {
      if (!line) return
      if (live) {
        process.stdout.write(`\r\x1b[2K${dim(line)}\n`)
        open = false
      } else process.stdout.write(`${dim(line)}\n`)
    },
  }
}
