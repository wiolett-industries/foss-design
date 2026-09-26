import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { cn } from '../lib/cn'
import { Panel } from './panel'

/** Page body under the top bar. */
export function Content({
  children,
  className,
  gap = 20,
  wide = false,
}: {
  children: ReactNode
  className?: string
  gap?: number
  wide?: boolean
}) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full min-h-0 grow flex-col px-8 pt-6 pb-7 animate-[q-fade-in_160ms_ease-out] max-md:px-4 max-md:pt-4',
        wide ? 'max-w-[1440px]' : 'max-w-[1200px]',
        className,
      )}
      style={{ gap }}
    >
      {children}
    </main>
  )
}

export function PageHead({
  title,
  sub,
  right,
  badge,
  crumbs,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  badge?: ReactNode
  crumbs?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-6 max-md:flex-col max-md:items-stretch max-md:gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {crumbs ? <div className="flex items-center gap-1.5 text-[13px] text-muted">{crumbs}</div> : null}
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
          {badge}
        </div>
        {sub ? <div className="text-[13px] text-muted">{sub}</div> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  )
}

export interface NavItem {
  to: string
  label: ReactNode
  hint?: ReactNode
}

export function SubNav({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {items.map((item) => (
        <Link
          key={item.to}
          href={item.to}
          className={(active: boolean) =>
            cn(
              'flex h-8 items-center gap-2 whitespace-nowrap rounded-[6px] px-3 text-[13.5px] no-underline transition-colors focus-visible:outline-offset-[-2px]',
              active ? 'bg-soft2 font-medium text-ink' : 'text-ink2 hover:bg-soft2',
            )
          }
        >
          <span className="min-w-0 truncate">{item.label}</span>
          {item.hint ? <span className="ml-auto text-[12px] font-normal text-muted">{item.hint}</span> : null}
        </Link>
      ))}
    </nav>
  )
}

export function NavLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pt-4 pb-1 text-[12px] text-muted">{children}</div>
}

/** Standalone message card: not found, empty, failed to load. */
export function NoticeCard({ title, text, action }: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <Panel className="flex w-[480px] max-w-full flex-col items-center gap-2 px-6 py-8 text-center">
      <h1 className="m-0 text-[16px] font-semibold">{title}</h1>
      {text ? <div className="m-0 max-w-[400px] text-[14px] text-ink2">{text}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </Panel>
  )
}

/** NoticeCard centred in the free space. */
export function Notice(props: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-[50vh] grow items-center justify-center p-6 max-md:px-4">
      <NoticeCard {...props} />
    </div>
  )
}
