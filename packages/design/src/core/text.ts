import path from 'node:path'

/** `SignUp`, `sign-up`, `sign_up` → `Sign up`. */
export function titleize(stem: string): string {
  const words = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(/\s+/)
  const text = words.join(' ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `SignUp.tsx` → `sign-up`. */
export function slugify(stem: string): string {
  return (
    stem
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'item'
  )
}

/** The name a file stands for: `screens/Login.tsx` → `Login`, `screens/landing/index.html` → `landing`. */
export function fileStem(file: string): string {
  const base = path.basename(file, path.extname(file))
  if (base === 'index') return path.basename(path.dirname(file))
  return base
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/** `---\nkey: value\n---` at the top of a markdown file. */
export function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return { data: {}, body: source }
  const data: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([\w-]+)\s*:\s*(.*)$/.exec(line)
    if (pair) data[pair[1]!] = pair[2]!.replace(/^["']|["']$/g, '').trim()
  }
  return { data, body: source.slice(match[0].length) }
}

/**
 * `@tag value` lines from the first block comment of a file (`/** … *\/` or `<!-- … -->`).
 * A tag's value runs until the next tag; repeated tags collect every value.
 */
export function parseDocTags(source: string): Record<string, string[]> {
  const block = /^\s*(?:\/\*\*?([\s\S]*?)\*\/|<!--([\s\S]*?)-->)/.exec(source.replace(/^<!doctype[^>]*>\s*/i, ''))
  const tags: Record<string, string[]> = {}
  if (!block) return tags
  const lines = (block[1] ?? block[2] ?? '').split(/\r?\n/).map((line) => line.replace(/^\s*\*?\s?/, ''))
  let current: { tag: string; value: string[] } | null = null
  const flush = () => {
    if (!current) return
    const list = tags[current.tag] ?? []
    list.push(current.value.join('\n').trim())
    tags[current.tag] = list
  }
  for (const line of lines) {
    const tag = /^@([\w-]+)\s*(.*)$/.exec(line.trim())
    if (tag) {
      flush()
      current = { tag: tag[1]!, value: [tag[2]!] }
    } else if (current) current.value.push(line)
  }
  flush()
  return tags
}

export function firstHeading(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match ? match[1]!.trim() : null
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** JSON that is safe inside an inline <script>. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
