import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-soft text-ink-2',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-[22px] items-center rounded-control px-2 text-caption font-medium ${TONE[tone]}`}>
      {children}
    </span>
  )
}
