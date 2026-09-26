import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type Tone = 'neutral' | 'action' | 'ok' | 'danger'

const BADGE: Record<Tone, string> = {
  neutral: 'bg-soft2 text-ink2',
  action: 'bg-action-soft text-action',
  ok: 'bg-ok-soft text-ok-text',
  danger: 'bg-danger-soft text-danger-text',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-[6px] px-2 text-[12px] font-medium',
        BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Count({ value, tone = 'neutral' }: { value: number; tone?: 'neutral' | 'action' | 'danger' }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-[5px] text-[11.5px] font-semibold tabular',
        tone === 'action'
          ? 'bg-action-soft text-action'
          : tone === 'danger'
            ? 'bg-danger-soft text-danger-text'
            : 'bg-soft2 text-ink2',
      )}
    >
      {value}
    </span>
  )
}
