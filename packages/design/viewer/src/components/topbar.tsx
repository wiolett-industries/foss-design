import { motion } from 'motion/react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useProject } from '../lib/api'
import { cn } from '../lib/cn'
import { useViewer } from '../lib/viewer'
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

/** Where the underline sits in the nav, and whether it got there by a tab switch. */
interface Underline {
  tab: number
  x: number
  width: number
  slide: boolean
}

/**
 * Section tabs with an underline under the active one. The underline is placed from the tab's
 * offset in the nav rather than by a shared layout animation: the bar is sticky, and motion
 * measures layout in page coordinates, so when a route change also moved the page scroll the
 * underline flew in from below. It slides only on a tab switch; on mount or resize it jumps.
 */
function Tabs({ location }: { location: string }) {
  const nav = useRef<HTMLElement>(null)
  const active = TABS.findIndex((tab) => tab.match(location))
  const [line, setLine] = useState<Underline | null>(null)
  useLayoutEffect(() => {
    const el = nav.current
    if (!el) return
    const measure = () => {
      const tab = el.children[active] as HTMLElement | undefined
      // No active tab, or the nav is hidden on a phone.
      if (!tab?.offsetWidth) {
        setLine(null)
        return
      }
      // Under the label: the link's 10px side padding stays out.
      const x = tab.offsetLeft + 10
      const width = tab.offsetWidth - 20
      setLine((prev) =>
        prev?.tab === active && prev.x === x && prev.width === width
          ? prev
          : { tab: active, x, width, slide: prev !== null && prev.tab !== active },
      )
    }
    measure()
    // Fonts load and the nav comes back from max-md:hidden.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [active])
  return (
    <nav ref={nav} className="relative flex h-[52px] items-stretch gap-0.5 max-md:hidden">
      {TABS.map((tab, index) => (
        <Link
          key={tab.to}
          href={tab.to}
          aria-current={index === active ? 'page' : undefined}
          className={cn(
            'flex items-center px-2.5 text-[14px] no-underline transition-colors',
            index === active ? 'font-medium text-ink' : 'text-ink2 hover:text-ink',
          )}
        >
          {tab.label}
        </Link>
      ))}
      {line ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-action"
          initial={false}
          animate={{ x: line.x, width: line.width }}
          transition={line.slide ? { type: 'spring', stiffness: 520, damping: 42 } : { duration: 0 }}
        />
      ) : null}
    </nav>
  )
}

/** The app's top bar: project, sections, search and appearance. */
export function AppTopBar() {
  const project = useProject().data
  const { slots } = useViewer()
  const [location] = useLocation()
  return (
    <>
      <Bar>
        {slots.barStart}
        <div className="flex min-w-0 items-center gap-6">
          {slots.brand ?? <Wordmark name={project?.name} version={project?.version} />}
          <Tabs location={location} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SearchButton />
          <ThemeMenu />
          {slots.barEnd}
        </div>
      </Bar>
      {slots.belowBar}
    </>
  )
}
