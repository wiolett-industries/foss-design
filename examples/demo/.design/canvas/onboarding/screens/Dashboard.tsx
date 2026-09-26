import { Bell, FileText, Folder, Home, Search, Users } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

const weeks = [32, 41, 38, 52, 49, 61, 58, 72, 69, 81, 77, 90]
const tabs = ['Overview', 'Files', 'Decisions'] as const
const activity = [
  { who: 'Dana', what: 'shared “Q3 roadmap”', when: '2 min ago' },
  { who: 'Arman', what: 'decided on the pricing page copy', when: '1 h ago' },
  { who: 'Lea', what: 'uploaded 12 files to Research', when: 'Yesterday' },
]

export default function Dashboard() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview')
  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <aside className="flex w-60 flex-col gap-1 border-r border-rule bg-surface p-3">
        <div className="mb-4 flex h-10 items-center gap-2 px-2 font-semibold">
          <span className="size-6 rounded-control bg-accent" /> Demo
        </div>
        {[
          [Home, 'Home'],
          [Folder, 'Projects'],
          [FileText, 'Documents'],
          [Users, 'People'],
        ].map(([Icon, label], i) => {
          const I = Icon as typeof Home
          return (
            <button key={label as string} type="button" className={`flex h-9 items-center gap-2.5 rounded-control px-2.5 text-body ${i === 0 ? 'bg-soft font-medium text-ink' : 'text-ink-2 hover:bg-soft'}`}>
              <I size={17} /> {label as string}
            </button>
          )
        })}
      </aside>
      <div className="flex min-w-0 grow flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-rule bg-surface px-6">
          <div className="flex h-9 w-80 items-center gap-2 rounded-control border border-rule bg-bg px-3 text-body text-muted">
            <Search size={16} /> Search everything
          </div>
          <button type="button" className="ml-auto flex size-9 items-center justify-center rounded-control text-ink-2 hover:bg-soft">
            <Bell size={18} />
          </button>
          <span className="size-8 rounded-full bg-accent-soft" />
        </header>
        <main className="flex flex-col gap-6 p-8">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-title font-semibold">Good morning, Dana</h1>
              <p className="text-body text-muted">Three things changed since you left.</p>
            </div>
            <div className="flex rounded-control bg-soft p-1">
              {tabs.map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className="relative h-8 px-3 text-body font-medium">
                  {tab === t ? <motion.span layoutId="tab" className="absolute inset-0 rounded-[4px] bg-surface shadow-sm" /> : null}
                  <span className={`relative ${tab === t ? 'text-ink' : 'text-muted'}`}>{t}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              ['Active projects', '12', '+2 this week'],
              ['Open decisions', '5', '2 need you'],
              ['Files shared', '248', '+31 this week'],
            ].map(([label, value, hint], i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="rounded-card border border-rule bg-surface p-5"
              >
                <div className="text-caption text-muted">{label}</div>
                <div className="mt-1 text-display font-semibold">{value}</div>
                <div className="text-caption text-ok">{hint}</div>
              </motion.div>
            ))}
          </div>
          <div className="grid grid-cols-[1.6fr_1fr] gap-4">
            <section className="rounded-card border border-rule bg-surface p-5">
              <div className="mb-4 text-body font-semibold">Activity over 12 weeks</div>
              <div className="flex h-48 items-end gap-2">
                {weeks.map((v, i) => (
                  <motion.div
                    key={i}
                    className="flex-1 rounded-t-[4px] bg-accent"
                    initial={{ height: 0 }}
                    animate={{ height: `${v}%` }}
                    transition={{ delay: 0.2 + i * 0.04, type: 'spring', stiffness: 120, damping: 18 }}
                    style={{ opacity: 0.35 + (i / weeks.length) * 0.65 }}
                  />
                ))}
              </div>
            </section>
            <section className="rounded-card border border-rule bg-surface p-5">
              <div className="mb-3 text-body font-semibold">Latest</div>
              {activity.map((a) => (
                <div key={a.what} className="flex items-start gap-3 border-t border-rule py-3 first:border-t-0">
                  <span className="mt-0.5 size-7 shrink-0 rounded-full bg-soft" />
                  <div className="text-body">
                    <span className="font-medium">{a.who}</span> <span className="text-ink-2">{a.what}</span>
                    <div className="text-caption text-muted">{a.when}</div>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
