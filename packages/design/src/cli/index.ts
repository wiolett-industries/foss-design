import path from 'node:path'
import { parseArgs } from 'node:util'
import { designPaths, findProjectRoot, packageVersion } from '../core/paths'
import { runBuild } from './commands/build'
import { runCheck } from './commands/check'
import { runLink, runLogin, runLogout } from './commands/cloud'
import { runPreview, runStop } from './commands/preview'
import { runInit, runNew, runSystemInit } from './commands/scaffold'
import { runShot } from './commands/shot'
import { runStatus } from './commands/status'
import { runPull, runPush } from './commands/sync'
import { bold, CliError, dim, endLine, print, red } from './log'

const HELP = `${bold('foss-design')} ${dim(`v${packageVersion()}`)} — design canvases and design systems in .design

${bold('Usage')}  design <command> [options]

${bold('Project')}
  init [--name <name>] [--no-gitignore]      Create .design and add it to .gitignore
  system init [--name <name>] [--empty]      Scaffold .design/system: tokens, a guideline, a component
  new <canvas> [--title <title>] [--empty]   Scaffold .design/canvas/<canvas>

${bold('Preview')}
  preview [--open [path]] [--port <n>]       Start the viewer in the background on a free port (or reuse
                                             it; one from another version restarts) and print its URL;
                                             --open also opens a browser
          [--restart] [--foreground]
  stop                                       Stop the viewer
  status                                     Viewer state, a project summary and, with a cloud link, the
                                             account, the linked project and each unit: in sync, local
                                             changes, remote ahead, conflict or archived

${bold('Verify')}
  check [canvas…] [--render] [--json]        Validate canvas.json and the system; --render loads every
                                             screen in Chrome and reports runtime errors
  shot <canvas>[/<screen>] [--page <id>]     Screenshot screens with Chrome (PNG paths are printed);
       [--theme light|dark] [--out <dir>]    @system or @system/<id> shoots the design system specimens
       [--overview]

${bold('Share')}
  build [canvas…] [--out <dir>] [--tar]      Static site of the canvases and the design system

${bold('Cloud')}  ${dim('units: system (design.json + system/) and canvas/<id>; exit 2 = conflict')}
  login                                      Sign in to foss-design Cloud; prints a link to open (the
                                             code is in the link) and waits for approval
  logout                                     Forget this machine's token for the cloud
  link [<project>] [--new <name>]            No args: list your projects. Link .design to a cloud project
                                             (linking to another project replaces the link)
  push [canvas…] [--json]                    Build and upload what changed here (or the named units); a
       [--resolved <unit>]                   system change pushes every active canvas with it. Stops if
                                             the cloud is ahead; --resolved marks a merged conflict.
                                             Prints the web link of every pushed canvas
  pull [canvas…] [--json]                    Take cloud changes into .design; a unit changed on both sides
       [--theirs <unit>]                     goes to .design/.cache/cloud/incoming/<unit> (exit 2);
                                             --theirs takes the cloud version and drops local changes

${bold('Options')}
  --root <dir>   Project folder (default: the nearest folder with .design, or the current one)
  -h, --help     This help
  -v, --version  Version

${bold('Environment')}
  FOSS_DESIGN_CLOUD  Cloud to sign in and link to (default https://app.fossdesign.dev)
`

function projectPaths(rootOption: string | undefined, requireDesign = true) {
  const found = rootOption ? path.resolve(rootOption) : findProjectRoot()
  if (!found) {
    if (!requireDesign) return designPaths(process.cwd())
    throw new CliError('No .design folder here or above. Run `design init` in the project root first.')
  }
  const paths = designPaths(found)
  return paths
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      'no-gitignore': { type: 'boolean' },
      empty: { type: 'boolean' },
      open: { type: 'boolean' },
      port: { type: 'string' },
      restart: { type: 'boolean' },
      foreground: { type: 'boolean' },
      render: { type: 'boolean' },
      json: { type: 'boolean' },
      page: { type: 'string' },
      theme: { type: 'string' },
      out: { type: 'string' },
      overview: { type: 'boolean' },
      tar: { type: 'boolean' },
      new: { type: 'string' },
      resolved: { type: 'string', multiple: true },
      theirs: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  const [command, ...rest] = positionals
  if (values.version) return print(packageVersion())
  if (values.help || !command || command === 'help') return print(HELP)

  const port = values.port ? Number(values.port) : undefined
  if (port !== undefined && !Number.isInteger(port)) throw new CliError('--port takes a number')
  const theme = values.theme === 'dark' ? 'dark' : values.theme === 'light' ? 'light' : undefined
  if (values.theme && !theme) throw new CliError('--theme is light or dark')

  switch (command) {
    case 'init':
      return runInit(values.root ? path.resolve(values.root) : process.cwd(), {
        name: values.name,
        gitignore: !values['no-gitignore'],
      })
    case 'system': {
      if (rest[0] !== 'init') throw new CliError('Usage: design system init [--name <name>] [--empty]')
      return runSystemInit(projectPaths(values.root).root, { name: values.name, empty: !!values.empty })
    }
    case 'new': {
      if (!rest[0]) throw new CliError('Usage: design new <canvas> [--title <title>]')
      return runNew(projectPaths(values.root).root, rest[0], { title: values.title, empty: !!values.empty })
    }
    case 'preview': {
      // `--open` may be followed by a viewer path such as /c/onboarding.
      const openPath = rest[0]?.startsWith('/') ? rest[0] : undefined
      return runPreview(projectPaths(values.root), {
        open: values.open ? (openPath ?? true) : false,
        port,
        foreground: !!values.foreground,
        restart: !!values.restart,
      })
    }
    case 'stop':
      return runStop(projectPaths(values.root))
    case 'status':
      return runStatus(projectPaths(values.root))
    case 'check':
      return runCheck(projectPaths(values.root), rest, { render: !!values.render, json: !!values.json })
    case 'shot': {
      if (!rest[0]) throw new CliError('Usage: design shot <canvas>[/<screen>] [--page <id>] [--theme light|dark]')
      return runShot(projectPaths(values.root), rest[0], {
        page: values.page,
        theme,
        out: values.out,
        overview: !!values.overview,
      })
    }
    case 'build':
      return runBuild(projectPaths(values.root), rest, { out: values.out, tar: !!values.tar })
    case 'login':
      return runLogin()
    case 'logout':
      return runLogout()
    case 'link':
      if (rest.length > 1) throw new CliError('Usage: design link [<project>] [--new <name>]')
      return runLink(projectPaths(values.root), rest[0], { newName: values.new })
    case 'push':
      return runPush(projectPaths(values.root), rest, { resolved: values.resolved ?? [], json: !!values.json })
    case 'pull':
      return runPull(projectPaths(values.root), rest, { theirs: values.theirs ?? [], json: !!values.json })
    default:
      throw new CliError(`Unknown command "${command}". Run \`design --help\`.`)
  }
}

main(process.argv.slice(2)).catch((error) => {
  endLine()
  if (error instanceof CliError) {
    process.stderr.write(`${red('error')} ${error.message}\n`)
    process.exit(error.code)
  }
  if ((error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
    process.stderr.write(`${red('error')} ${(error as Error).message}\nRun \`design --help\`.\n`)
    process.exit(2)
  }
  process.stderr.write(`${red('error')} ${(error as Error)?.stack ?? String(error)}\n`)
  process.exit(1)
})
