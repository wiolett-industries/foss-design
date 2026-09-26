import type { Issue } from '@shared/types'
import { cn } from '../lib/cn'
import { Icon } from '../ui/icon'
import { Panel, PanelHead } from '../ui/panel'

export function IssueList({ issues, className }: { issues: Issue[]; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      {issues.map((issue, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity
          key={index}
          className="flex items-start gap-2.5 border-t border-rule px-4 py-2.5 text-[13px] first:border-t-0"
        >
          <Icon
            name={issue.severity === 'error' ? 'alert' : 'info'}
            size={15}
            className={cn('mt-0.5', issue.severity === 'error' ? 'text-danger-text' : 'text-action')}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ink">{issue.message}</span>
            <span className="font-mono text-[12px] break-all text-muted">
              {issue.file}
              {issue.at ? ` · ${issue.at}` : ''}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Problems found in the project's files, as a panel. */
export function IssuesPanel({ issues, title = 'Problems' }: { issues: Issue[]; title?: string }) {
  if (!issues.length) return null
  const errors = issues.filter((issue) => issue.severity === 'error').length
  return (
    <Panel className={errors ? 'border-danger/40' : undefined}>
      <PanelHead title={title} count={issues.length} sub={errors ? `${errors} blocking` : 'warnings'} />
      <div className="border-t border-rule">
        <IssueList issues={issues} />
      </div>
    </Panel>
  )
}
