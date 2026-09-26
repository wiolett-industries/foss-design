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

export function print(line = '') {
  process.stdout.write(`${line}\n`)
}

export function warn(line: string) {
  process.stderr.write(`${yellow('warning')} ${line}\n`)
}
