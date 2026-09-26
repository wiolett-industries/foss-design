import type { ReactNode } from 'react'

export function Card({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-surface transition-shadow hover:shadow-card">
      <header className="flex items-center justify-between border-b border-rule px-4 py-3">
        <h3 className="text-body font-semibold">{title}</h3>
        {meta ? <span className="text-caption text-muted">{meta}</span> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}
