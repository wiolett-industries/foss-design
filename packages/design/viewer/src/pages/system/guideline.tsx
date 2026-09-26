import type { SystemDoc } from '@shared/types'
import { Markdown } from '../../components/markdown'
import { PageHead } from '../../ui/page'
import { Panel } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { NotFound } from '../not-found'

/** The markdown without a leading `# Title` that repeats the page title. */
function body(markdown: string, title: string): string {
  const match = /^\s*#\s+(.+)\r?\n/.exec(markdown)
  return match && match[1]!.trim() === title ? markdown.slice(match[0].length) : markdown
}

export function GuidelinePage({ system, slug }: { system: SystemDoc; slug: string }) {
  const guide = system.guidelines.find((item) => item.slug === slug)
  if (!guide)
    return <NotFound title="No such guideline" text={`There is no guideline "${slug}" in .design/system/guidelines.`} />
  const text = body(guide.markdown, guide.title).trim()
  return (
    <>
      <PageHead title={guide.title} sub="Guideline" />
      <Panel>
        <div className="px-6 py-5">
          {text ? (
            <Markdown text={text} className="max-w-[760px]" />
          ) : (
            <span className="text-[13px] text-muted">
              This guideline is empty. Write it in <Mono>.design/system/guidelines</Mono>.
            </span>
          )}
        </div>
      </Panel>
    </>
  )
}
