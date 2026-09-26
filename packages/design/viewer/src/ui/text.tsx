import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export function Mono({
  children,
  size = 12.5,
  className,
  title,
  wrap,
}: {
  children: ReactNode
  size?: number
  className?: string
  title?: string
  wrap?: boolean
}) {
  return (
    <span
      title={title}
      className={cn(wrap ? 'break-all' : 'whitespace-nowrap', 'font-mono', className)}
      style={{ fontSize: size }}
    >
      {children}
    </span>
  )
}

export function Muted({ children, size = 13, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <span className={cn('text-muted', className)} style={{ fontSize: size }}>
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-rule bg-surface px-[5px] py-px font-mono text-[11px] text-ink2">
      {children}
    </kbd>
  )
}

/** Name on top, muted details below; both truncate. */
export function Two({ top, bottom, weight = 500 }: { top: ReactNode; bottom?: ReactNode; weight?: 400 | 500 | 600 }) {
  return (
    <span className="flex min-w-0 flex-col gap-px">
      <span className="truncate leading-[1.35]" style={{ fontWeight: weight }}>
        {top}
      </span>
      {bottom ? (
        <span className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-[12.5px] leading-[1.35] text-muted">
          {bottom}
        </span>
      ) : null}
    </span>
  )
}
