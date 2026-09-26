import { useMemo } from 'react'
import { highlight } from 'sugar-high'
import { cn } from '../lib/cn'
import { copyText } from '../lib/copy'
import { IconButton } from '../ui/button'
import { Mono } from '../ui/text'

/** Source with line numbers and syntax colors; the header carries the path and a copy button. */
export function CodeView({ code, path, className }: { code: string; path?: string; className?: string }) {
  const text = code.replace(/\n$/, '')
  const html = useMemo(() => highlight(text), [text])
  const lines = text.split('\n').length
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {path ? (
        <div className="flex h-10 items-center justify-between gap-3 border-b border-rule bg-soft pr-1.5 pl-4">
          <Mono size={12} className="truncate text-muted" title={path}>
            {path}
          </Mono>
          <IconButton icon="copy" label="Copy file" size={15} onClick={() => copyText(code, 'Copied the file')} />
        </div>
      ) : null}
      <div className="flex max-h-[640px] min-w-0 overflow-auto font-mono text-[12.5px] leading-[1.6]">
        <pre
          aria-hidden="true"
          className="sticky left-0 m-0 shrink-0 select-none border-r border-rule bg-surface py-3 pr-3 pl-4 text-right text-muted"
        >
          {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
        </pre>
        <pre className="m-0 min-w-0 grow py-3 pr-6 pl-4 text-ink">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sugar-high escapes the source it highlights */}
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  )
}
