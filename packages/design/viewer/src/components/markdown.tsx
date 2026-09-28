import { Marked } from 'marked'
import { useMemo } from 'react'
import { cn } from '../lib/cn'

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * http, https, mailto or relative, read as the browser reads a URL (it drops whitespace and
 * control characters inside a scheme, and so does URL parsing).
 */
export function isSafeHref(href: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(href, 'http://relative.invalid/').protocol)
  } catch {
    return false
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  sol: '/',
  period: '.',
  num: '#',
  quest: '?',
  equals: '=',
  percnt: '%',
  tab: '\t',
  newline: '\n',
  nbsp: '\u00a0',
}

/** Character references in a link or image destination, which Markdown reads as the characters they name. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (whole, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole
    const code = dec ? Number(dec) : Number.parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\ufffd'
  })
}

// Markdown may come from anyone who can push to a project: raw HTML shows as text, and links
// and images keep their target only when it is http(s), mailto or relative. The target is
// checked as decoded and written fully escaped, so what the browser follows is what was checked.
const markdown = new Marked(
  { gfm: true, breaks: false },
  {
    renderer: {
      html: ({ text }) => escapeHtml(text),
      link(token) {
        const text = this.parser.parseInline(token.tokens)
        const href = decodeEntities(token.href)
        if (!isSafeHref(href)) return text
        const title = token.title ? ` title="${escapeHtml(decodeEntities(token.title))}"` : ''
        return `<a target="_blank" rel="noreferrer" href="${escapeHtml(href)}"${title}>${text}</a>`
      },
      image(token) {
        const alt = escapeHtml(decodeEntities(token.text))
        const src = decodeEntities(token.href)
        if (!isSafeHref(src)) return alt
        const title = token.title ? ` title="${escapeHtml(decodeEntities(token.title))}"` : ''
        return `<img src="${escapeHtml(src)}" alt="${alt}"${title}>`
      },
    },
  },
)

export function renderMarkdown(text: string): string {
  return markdown.parse(text, { async: false })
}

/** Markdown from the project's own files (guidelines, notes, descriptions). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes raw HTML and writes only checked, escaped link targets
  return <div className={cn('prose', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
