import { marked } from 'marked'
import { useMemo } from 'react'
import { cn } from '../lib/cn'

marked.use({ gfm: true, breaks: false })

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return html.replace(/<a href=/g, '<a target="_blank" rel="noreferrer" href=')
}

/** Markdown from the project's own files (guidelines, notes, descriptions). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown written in the project's own .design folder
  return <div className={cn('prose', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
