import { mapLimit } from '../../capture/frames'
import { CloudClient, CloudError, type RemotePage, type RemoteProject } from '../../cloud/client'
import { cloudHost, requireCredential } from '../../cloud/credentials'
import { PAGE_SLUG, readPage, slugFor } from '../../cloud/page'
import { megabytes, plural, TRANSFERS } from '../../cloud/sync'
import { bold, CliError, dim, green, print, progress, yellow } from '../log'
import { ago } from './canvases'

/** The name `design page` gives a pages project it makes on first use. */
const DEFAULT_NAME = 'Pages'

const base = (host: string) => host.replace(/\/+$/, '')
/** Pages are small: kilobytes below a megabyte. */
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : megabytes(bytes))
/** The page in the web app, for the project's members. */
const pageUrl = (host: string, project: string, slug: string) =>
  `${base(host)}/p/${project}/pages/${encodeURIComponent(slug)}`
/** A published page: an id, nothing about the project. */
const publicUrl = (host: string, publicId: string) => `${base(host)}/a/${publicId}`

function client() {
  const host = cloudHost()
  return { host, client: new CloudClient(host, requireCredential(host).token) }
}

/**
 * The pages project to use: `--project` (an id or a name), else the one pages project of your own,
 * made on first use. Several of your own need `--project`.
 */
async function pagesProject(
  client: CloudClient,
  wanted: string | undefined,
  options: { create: boolean; log: (line: string) => void },
): Promise<RemoteProject | null> {
  const { owned, shared } = await client.projects()
  if (wanted) {
    const all = [...owned, ...shared]
    const byName = all.filter((project) => project.name === wanted)
    const found = all.find((project) => project.id === wanted) ?? (byName.length === 1 ? byName[0] : undefined)
    if (!found)
      throw new CliError(
        byName.length > 1
          ? `Several projects are called "${wanted}"; pass its id (\`design pages\` names them).`
          : `No project "${wanted}" among yours on ${client.host}.`,
      )
    if (found.kind !== 'pages')
      throw new CliError(`${found.name} holds canvases, not pages; pages go to a pages project.`)
    return found
  }
  const mine = owned.filter((project) => project.kind === 'pages' && !project.archived)
  if (mine.length === 1) return mine[0]!
  if (mine.length > 1)
    throw new CliError(
      `You have several pages projects; pass one with --project:\n${mine.map((p) => `  ${p.id}  ${p.name}`).join('\n')}`,
    )
  if (!options.create) return null
  const made = await client.createProject(DEFAULT_NAME, 'pages')
  // A cloud from before pages makes a design project of it, which takes no pages.
  if (made.kind !== 'pages') throw new CliError(`${client.host} does not host pages yet.`)
  options.log(`${green('created')} the pages project ${bold(made.name)} ${dim(`(${made.id})`)}`)
  return made
}

function check(project: RemoteProject) {
  if (project.banned) throw new CliError(`${project.name} is blocked by moderation.`)
  if (project.archived) throw new CliError(`${project.name} is archived; unarchive it in the web app first.`)
  if (project.role === 'viewer') throw new CliError(`You can view ${project.name} but not publish to it.`)
}

/**
 * `design page <file|folder>`: an HTML file (as the page's index.html) or a folder with an
 * index.html goes up as a page of your pages project. The same name again is a new version of the
 * same page, at the same links. `--public` gives it a link anyone can open.
 */
export async function runPage(
  target: string | undefined,
  options: { name?: string; title?: string; project?: string; public: boolean; json: boolean },
) {
  if (!target) throw new CliError('Usage: design page <file.html|folder> [--name <slug>] [--public]')
  const slug = options.name ?? slugFor(target)
  if (!PAGE_SLUG.test(slug))
    throw new CliError(`--name takes lowercase letters, digits, - and _ (up to 100, starting with a letter or digit)`)
  const bundle = readPage(target)
  const log = options.json ? () => {} : (line: string) => print(line)
  for (const warning of bundle.warnings) log(yellow(warning))

  const { host, client: cloud } = client()
  const project = (await pagesProject(cloud, options.project, { create: true, log }))!
  check(project)
  if (options.public && project.role !== 'owner')
    throw new CliError(`Only the owner of ${project.name} gives pages a public link; publish without --public.`)

  const title = options.title?.trim() || bundle.title || slug
  const byHash = new Map([...bundle.files].map(([rel, data]) => [bundle.manifest[rel]!.hash, data]))
  const missing = await cloud.missing(project.id, [...byHash.keys()])
  if (missing.length) {
    const bar = options.json ? null : progress()
    let sent = 0
    await mapLimit(missing, TRANSFERS, async (hash) => {
      const data = byHash.get(hash)
      if (!data) throw new CliError(`The cloud asked for ${hash.slice(0, 12)}, which is not part of this page`)
      await cloud.putBlob(project.id, hash, data)
      bar?.update(`Uploading ${++sent}/${missing.length} files`)
    })
    bar?.done(`Uploaded ${plural(missing.length, 'file')}`)
  }

  // The page as it is in the cloud now: a new version goes on top, whoever made the last one.
  let rev = 0
  let page: RemotePage | undefined
  for (let attempt = 0; ; attempt++) {
    page = (await cloud.pages(project.id)).find((item) => item.slug === slug)
    if (page?.banned) throw new CliError(`The page ${slug} is blocked by moderation.`)
    if (page?.archived) throw new CliError(`The page ${slug} is archived; unarchive it in the web app first.`)
    try {
      const revs = await cloud.push(project.id, [
        {
          key: `page/${slug}`,
          baseRev: page?.headRev ?? 0,
          title,
          source: {},
          build: bundle.manifest,
          systemRev: null,
        },
      ])
      rev = revs.get(`page/${slug}`) ?? (page?.headRev ?? 0) + 1
      break
    } catch (error) {
      // Someone published this page in between: go on top of theirs.
      if (attempt < 2 && error instanceof CloudError && error.status === 409 && error.error === 'conflict') continue
      throw error
    }
  }
  const publicId = options.public ? (await cloud.pageAction(project.id, slug, 'publish')).publicId : page?.publicId

  const data = {
    ok: true,
    project: { id: project.id, name: project.name },
    page: { slug, title, rev, bytes: bundle.bytes, files: bundle.files.size },
    url: pageUrl(host, project.id, slug),
    publicUrl: publicId ? publicUrl(host, publicId) : null,
    warnings: bundle.warnings,
  }
  if (options.json) return print(JSON.stringify(data, null, 2))
  print(
    `${green('✓')} ${rev > 1 ? 'Updated' : 'Published'} ${bold(title)} ${dim(`(${slug}, r${rev}, ${plural(bundle.files.size, 'file')}, ${size(bundle.bytes)})`)} in ${project.name}`,
  )
  print(`  ${dim('Page  ')}  ${data.url}`)
  if (data.publicUrl) print(`  ${dim('Public')}  ${data.publicUrl}`)
  else
    print(
      dim(
        project.role === 'owner'
          ? '  Only the project’s members see it; --public gives it a link anyone can open.'
          : '  Only the project’s members see it; its owner can give it a public link.',
      ),
    )
}

/** `design pages`: the pages of your pages project (or --project's), last changed first. */
export async function runPages(options: { project?: string; json: boolean }) {
  const { host, client: cloud } = client()
  const project = await pagesProject(cloud, options.project, { create: false, log: () => {} })
  if (!project) {
    if (options.json) return print(JSON.stringify({ project: null, pages: [] }, null, 2))
    return print(dim('No pages project yet: `design page <file.html>` makes one and publishes the page.'))
  }
  const pages = await cloud.pages(project.id)
  if (options.json)
    return print(
      JSON.stringify(
        {
          project: { id: project.id, name: project.name, role: project.role },
          pages: pages.map((page) => ({
            ...page,
            url: pageUrl(host, project.id, page.slug),
            publicUrl: page.publicId ? publicUrl(host, page.publicId) : null,
          })),
        },
        null,
        2,
      ),
    )
  print(`${bold(project.name)} ${dim(`${plural(pages.length, 'page')} · ${base(host)}/p/${project.id}`)}`)
  if (!pages.length) return print(dim('  none yet: `design page <file.html>` publishes one'))
  const width = Math.max(...pages.map((page) => page.slug.length))
  for (const page of pages) {
    const state = page.banned ? yellow('blocked') : page.archived ? yellow('archived') : ''
    print(
      `  ${page.slug.padEnd(width)}  ${page.title}  ${dim(`r${page.headRev} · ${size(page.bytes)} · ${ago(page.updatedAt)}`)}${state ? `  ${state}` : ''}`,
    )
    if (page.publicId) print(`  ${' '.repeat(width)}  ${dim('public')} ${publicUrl(host, page.publicId)}`)
  }
}
