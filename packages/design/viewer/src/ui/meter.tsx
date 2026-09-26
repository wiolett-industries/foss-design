import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * How much of something is used: a track with a fill, a label on the left and
 * the figures on the right. The fill turns to danger once `value` reaches `max`
 * or when `danger` says so.
 */
export function Meter({
  value,
  max,
  label,
  detail,
  danger,
  className,
}: {
  value: number
  max: number
  label?: ReactNode
  /** Figures such as `312 MB of 1 GB`. */
  detail?: ReactNode
  danger?: boolean
  className?: string
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const alarm = danger ?? (max > 0 && value >= max)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label || detail ? (
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="truncate text-[13px] text-ink2">{label}</span>
          <span className="shrink-0 text-[12.5px] text-muted tabular">{detail}</span>
        </div>
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: <meter> takes the kit's colors only through vendor pseudo-elements */}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={typeof label === 'string' ? label : undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-rule"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-200', alarm ? 'bg-danger' : 'bg-action')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
