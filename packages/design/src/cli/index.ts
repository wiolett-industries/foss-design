import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { designPaths, findProjectRoot, packageVersion } from '../core/paths'
import { runBuild } from './commands/build'
import { runArchive, runCanvases, runHistory, runMe, runPublish, runRollback, runUrl } from './commands/canvases'
import { runCheck } from './commands/check'
import { runLink, runLogin, runLogout } from './commands/cloud'
import { runDrawings } from './commands/drawings'
import { runIcon } from './commands/icon'
import { runImport } from './commands/import'
import { runMerge } from './commands/merge'
import { runPage, runPages } from './commands/pages'
import { runPreview, runPreviews, runStop, runStopAll } from './commands/preview'
import { runRename } from './commands/rename'
import { runInit, runNew, runSystemInit } from './commands/scaffold'
import { runShot } from './commands/shot'
import { runSnapshots } from './commands/snapshots'
import { runStatus } from './commands/status'
import { runPull, runPush } from './commands/sync'
import { bold, CliError, dim, endLine, print, red } from './log'

const HELP = `${bold('foss-design')} ${dim(`v${packageVersion()}`)} — design canvases and design systems in .design

${bold('Usage')}  design <command> [options]

${bold('Project')}
  init [--name <name>] [--no-gitignore]      Create .design and add it to .gitignore
  system init [--name <name>] [--empty]      Scaffold .design/system: tokens, a guideline, a component
  new <canvas> [--title <title>] [--empty]   Scaffold .design/canvas/<canvas>
  icon [<file>] [--remove]                   Show, set or remove the project icon: an SVG, PNG or WebP of
                                             at most 256 KB in .design/icon.*; a linked project's icon is
                                             the cloud project's, set there at once
  rename <name>                              Rename the project: the cloud project when linked (owner),
                                             otherwise the name in design.json
  import <folder> [--canvas <id>]            Turn an exported Claude Design project (canvas.json and
         [--title <title>]                   *.dc.html) into a canvas of React screens, once
  canvases [--json]                          Every canvas: pages and screens; with a cloud link also its
                                             revision, sync state, web link and public link

${bold('Preview')}
  preview [--open [path]] [--port <n>]       Start the viewer in the background on a free port (or reuse
                                             it; one from another version restarts) and print its URL;
                                             --open also opens a browser
          [--restart] [--foreground]
  stop [--all]                               Stop the viewer; --all stops every preview on this machine
  previews [--json]                          Every preview running on this machine: project, URL,
                                             version, uptime; orphans (a project's untracked server) marked
  status                                     Viewer state, a project summary and, with a cloud link, the
                                             account, the linked project and each unit: in sync, local
                                             changes, remote ahead, conflict or archived

${bold('Verify')}
  check [<canvas>[/<screen>]…] [--page <id>] Validate canvas.json and the system (go() is an error);
        [--render [--built]] [--json]        --render loads every screen in Chrome and reports runtime
                                             errors and links that lead to no screen; --built renders
                                             the production build design push uploads instead of the
                                             dev server. Narrow it to canvases, one page (--page) or
                                             single screens
  snapshots [<canvas>[/<screen>]…]           Take the snapshots screens lack, in both themes, for the
            [--page <id>]                    viewer to show while frames do not run (push does this
                                             for the canvases it pushes)
  shot <canvas>[/<screen>] [--page <id>]     Screenshot screens with Chrome (PNG paths are printed);
       [--theme light|dark] [--out <dir>]    @system or @system/<id> shoots the design system specimens;
       [--overview] [--board | --markup]     --board shoots the idea boards drawn on (or --page's),
       [--max <px> | --full]                 one PNG per group of sketches; --markup the screens with
                                             markup, drawn over them. Those pictures are at most 1280 px
                                             on the long side; --max sets another limit, --full none

${bold('Drawings')}  ${dim('idea boards of pages and markup over screens, drawn in the viewer; shared live in the cloud')}
  drawings [<canvas>[/<screen>]] [--json]    Boards and markup with something on them: strokes and the
                                             text written on them (read through the preview server,
                                             which syncs them with the cloud when linked)
  drawings <canvas>/<screen> --clear         Erase a screen's markup once it is dealt with

${bold('Share')}
  build [canvas…] [--out <dir>] [--tar]      Static site of the canvases and the design system

${bold('Cloud')}  ${dim('units: system (design.json + system/) and canvas/<id>; exit 2 = conflict')}
  login                                      Sign in to foss-design Cloud; prints a link to open (the
                                             code is in the link) and waits for approval
  logout                                     Forget this machine's token for the cloud
  me [--json]                                The signed-in account: plan, storage, projects, canvases,
                                             pushes, and the project .design is linked to
  link [<project>] [--new <name>]            No args: list your projects. Link .design to a cloud project
                                             (linking to another project replaces the link)
  push [canvas…] [--json]                    Build and upload what changed here (or the named units); a
       [--resolved <unit>]                   system change pushes every active canvas with it. When the
                                             cloud is ahead it pulls and merges first, then pushes; it
                                             stops on conflicts. Takes missing snapshots (both themes).
                                             Prints the web link of every pushed canvas; refuses screens
                                             that still call go()
  pull [canvas…] [--json]                    Take cloud changes into .design; a unit changed on both sides
       [--theirs <unit>]                     is merged three ways (files changed on one side take it,
                                             text changed on both merges line by line); what does not
                                             merge waits for design merge. --theirs takes the cloud
                                             version and drops local changes
  merge [<unit|file>…] [--here|--cloud]      Conflicts a merge left: lists them (in a terminal, walks
        [--done] [--json]                    through them); --here / --cloud settles files or units;
                                             --done closes a merge once no markers are left
  url <canvas> [--json]                      The canvas in the web app, and its public links: the canvas's
                                             and its screens' published on their own
  history <canvas|system> [--json]           Stored revisions, newest first: when, who, screens, size
  rollback <canvas> <rev>                    Make an old revision current again in the cloud (a new
                                             revision), then pull it here
  publish <canvas>[/<screen>]                Give the canvas a public link anyone can open (owner only);
                                             with a screen, a link to that screen alone, which names
                                             nothing of the project and opens no other screen
  unpublish <canvas>[/<screen>]              Turn the public link off
  archive <canvas>                           Archive the canvas in the cloud: out of the list and pushes,
                                             history kept
  unarchive <canvas>                         Bring an archived canvas back

${bold('Pages')}  ${dim('HTML pages published to the cloud, each at its own link; no .design needed')}
  page <file.html|folder> [--name <slug>]    Publish an HTML file, or a folder with an index.html and
       [--title <title>] [--project <id>]    what it loads, as a page of your pages project (made on
       [--public] [--json]                   first use). The same name again is a new version at the
                                             same links. --public gives it a link anyone can open
                                             (owner only); links to other sites open in a new tab
  pages [--project <id>] [--json]            The pages: name, title, version, size, public link

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

/** `--max <px>` or `--full` (0) for drawing pictures; undefined keeps the default. */
function drawingMax(max: string | undefined, full: boolean): number | undefined {
  if (full && max !== undefined) throw new CliError('Pass --max or --full, not both')
  if (full) return 0
  if (max === undefined) return undefined
  const value = Number(max)
  if (!Number.isInteger(value) || value < 200 || value > 8000)
    throw new CliError('--max takes a number of pixels, 200 to 8000')
  return value
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
      canvas: { type: 'string' },
      remove: { type: 'boolean' },
      here: { type: 'boolean' },
      cloud: { type: 'boolean' },
      done: { type: 'boolean' },
      'no-gitignore': { type: 'boolean' },
      empty: { type: 'boolean' },
      open: { type: 'boolean' },
      port: { type: 'string' },
      restart: { type: 'boolean' },
      all: { type: 'boolean' },
      built: { type: 'boolean' },
      foreground: { type: 'boolean' },
      render: { type: 'boolean' },
      json: { type: 'boolean' },
      page: { type: 'string' },
      theme: { type: 'string' },
      out: { type: 'string' },
      overview: { type: 'boolean' },
      board: { type: 'boolean' },
      markup: { type: 'boolean' },
      clear: { type: 'boolean' },
      max: { type: 'string' },
      full: { type: 'boolean' },
      tar: { type: 'boolean' },
      new: { type: 'string' },
      project: { type: 'string' },
      public: { type: 'boolean' },
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
    case 'icon':
      return runIcon(projectPaths(values.root), rest[0], { remove: !!values.remove })
    case 'rename':
      if (!rest.length) throw new CliError('Usage: design rename <name>')
      return runRename(projectPaths(values.root), rest.join(' '))
    case 'merge':
      return runMerge(projectPaths(values.root), rest, {
        here: !!values.here,
        cloud: !!values.cloud,
        done: !!values.done,
        json: !!values.json,
      })
    case 'import': {
      if (!rest[0]) throw new CliError('Usage: design import <folder> [--canvas <id>] [--title <title>]')
      return runImport(projectPaths(values.root), rest[0], { canvas: values.canvas, title: values.title })
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
      return values.all ? runStopAll() : runStop(projectPaths(values.root))
    case 'previews':
      return runPreviews({ json: !!values.json })
    case 'status':
      return runStatus(projectPaths(values.root))
    case 'check':
      return runCheck(projectPaths(values.root), rest, {
        render: !!values.render,
        json: !!values.json,
        page: values.page,
        built: !!values.built,
      })
    case 'snapshots':
      return runSnapshots(projectPaths(values.root), rest, { page: values.page })
    case 'shot': {
      if (!rest[0]) throw new CliError('Usage: design shot <canvas>[/<screen>] [--page <id>] [--theme light|dark]')
      return runShot(projectPaths(values.root), rest[0], {
        page: values.page,
        theme,
        out: values.out,
        overview: !!values.overview,
        board: !!values.board,
        markup: !!values.markup,
        max: drawingMax(values.max, !!values.full),
      })
    }
    case 'drawings':
      return runDrawings(projectPaths(values.root), rest[0], { json: !!values.json, clear: !!values.clear })
    case 'build':
      return runBuild(projectPaths(values.root), rest, { out: values.out, tar: !!values.tar })
    case 'login':
      return runLogin()
    case 'logout':
      return runLogout()
    case 'link':
      if (rest.length > 1) throw new CliError('Usage: design link [<project>] [--new <name>]')
      return runLink(projectPaths(values.root), rest[0], { newName: values.new })
    case 'me': {
      let paths: ReturnType<typeof projectPaths> | null = null
      try {
        paths = projectPaths(values.root)
      } catch {}
      return runMe(paths, { json: !!values.json })
    }
    case 'canvases':
      return runCanvases(projectPaths(values.root), { json: !!values.json })
    case 'url':
      return runUrl(projectPaths(values.root), rest[0], { json: !!values.json })
    case 'history':
      return runHistory(projectPaths(values.root), rest[0], { json: !!values.json })
    case 'rollback':
      return runRollback(projectPaths(values.root), rest[0], rest[1])
    case 'publish':
    case 'unpublish':
      return runPublish(projectPaths(values.root), rest[0], command === 'publish')
    case 'archive':
    case 'unarchive':
      return runArchive(projectPaths(values.root), rest[0], command === 'archive')
    case 'page':
      if (rest.length > 1) throw new CliError('Usage: design page <file.html|folder> [--name <slug>] [--public]')
      return runPage(rest[0], {
        name: values.name,
        title: values.title,
        project: values.project,
        public: !!values.public,
        json: !!values.json,
      })
    case 'pages':
      return runPages({ project: values.project, json: !!values.json })
    case 'push':
      return runPush(projectPaths(values.root), rest, { resolved: values.resolved ?? [], json: !!values.json })
    case 'pull':
      return runPull(projectPaths(values.root), rest, { theirs: values.theirs ?? [], json: !!values.json })
    default:
      throw new CliError(`Unknown command "${command}". Run \`design --help\`.`)
  }
}

/**
 * On Windows a CLI started through an 8.3 short path (C:\Users\RUNNER~1\…, as %TEMP% often is)
 * keeps that form in its module paths while Vite and the project resolve the long one, and the
 * preview then cannot serve its own client. Run once more from the real paths instead.
 */
function relaunchFromRealPath(): boolean {
  if (process.platform !== 'win32' || process.env.FOSS_DESIGN_RELAUNCHED) return false
  const script = process.argv[1]
  if (!script) return false
  let realScript: string
  let realCwd: string
  try {
    realScript = fs.realpathSync.native(script)
    realCwd = fs.realpathSync.native(process.cwd())
  } catch {
    return false
  }
  const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  if (same(realScript, script) && same(realCwd, process.cwd())) return false
  const result = spawnSync(process.execPath, [...process.execArgv, realScript, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: realCwd,
    env: { ...process.env, FOSS_DESIGN_RELAUNCHED: '1' },
  })
  process.exit(result.status ?? 1)
}

if (!relaunchFromRealPath())
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
