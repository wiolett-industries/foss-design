import { Marked } from 'marked'
import { useMemo } from 'react'
import { cn } from '../lib/cn'

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** http, https, mailto or relative. Browsers drop whitespace and control characters inside a scheme, so do we. */
export function isSafeHref(href: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const bare = href.replace(/[\u0000- \u007f]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare)?.[1]
  return !scheme || SAFE_SCHEMES.has(`${scheme.toLowerCase()}:`)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Markdown may come from anyone who can push to a project: raw HTML shows as text, and links
// and images with any other scheme (javascript:, data:) lose their target.
const markdown = new Marked(
  { gfm: true, breaks: false },
  {
    renderer: {
      html: ({ text }) => escapeHtml(text),
      link(token) {
        return isSafeHref(token.href) ? false : this.parser.parseInline(token.tokens)
      },
      image(token) {
        return isSafeHref(token.href) ? false : escapeHtml(token.text)
      },
    },
  },
)

export function renderMarkdown(text: string): string {
  const html = markdown.parse(text, { async: false })
  return html.replace(/<a href=/g, '<a target="_blank" rel="noreferrer" href=')
}

/** Markdown from the project's own files (guidelines, notes, descriptions). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes raw HTML and drops unsafe link targets
  return <div className={cn('prose', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
