import type { ReactNode } from 'react'

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between text-caption font-medium text-ink-2">
      {children}
      {hint ? <span className="font-normal text-muted">{hint}</span> : null}
    </span>
  )
}
