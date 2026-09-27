import type { CSSProperties } from 'react'
import { cn } from '../lib/cn'

/** A placeholder block that pulses while its content loads. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span aria-hidden="true" className={cn('block animate-pulse rounded-[6px] bg-soft2', className)} style={style} />
  )
}

/**
 * Rows of a loading panel: a leading block, two lines of text and a trailing block, with the
 * panel's row borders, so the real rows replace them without a jump.
 */
export function SkeletonRows({ rows = 3, lead = 28, minH = 56 }: { rows?: number; lead?: number; minH?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          key={index}
          className="flex items-center gap-3 border-t border-rule px-4"
          style={{ minHeight: minH, opacity: 1 - index * 0.18 }}
        >
          {lead ? <Skeleton style={{ width: lead, height: Math.min(lead, minH - 20) }} /> : null}
          <span className="flex min-w-0 grow flex-col gap-1.5">
            <Skeleton className="h-3 w-[38%]" />
            <Skeleton className="h-2.5 w-[62%]" />
          </span>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}
