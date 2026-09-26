import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { useProject } from '../lib/api'
import { cn } from '../lib/cn'
import { SearchButton } from './search-button'
import { ThemeMenu } from './theme-menu'
import { Wordmark } from './wordmark'

/** A 52px bar across the top; pages that fill the screen compose their own content into it. */
export function Bar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-rule bg-surface px-4',
        className,
      )}
    >
      {children}
    </header>
  )
}

const TABS = [
  { to: '/', label: 'Canvases', match: (path: string) => path === '/' || path.startsWith('/c/') },
  { to: '/system', label: 'Design system', match: (path: string) => path.startsWith('/system') },
]

/** The app's top bar: project, sections, search and appearance. */
export function AppTopBar() {
  const project = useProject().data
  const [location] = useLocation()
  return (
    <Bar>
      <div className="flex min-w-0 items-center gap-6">
        <Wordmark name={project?.name} />
        <nav className="flex h-[52px] items-stretch gap-0.5 max-md:hidden">
          {TABS.map((tab) => {
            const on = tab.match(location)
            return (
              <Link
                key={tab.to}
                href={tab.to}
                className={cn(
                  'relative flex items-center px-2.5 text-[14px] no-underline transition-colors',
                  on ? 'font-medium text-ink' : 'text-ink2 hover:text-ink',
                )}
              >
                {tab.label}
                {on ? (
                  <motion.span
                    layoutId="app-tab"
                    className="absolute inset-x-2.5 bottom-0 h-[2px] bg-ink"
                    transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                  />
                ) : null}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SearchButton />
        <ThemeMenu />
      </div>
    </Bar>
  )
}
