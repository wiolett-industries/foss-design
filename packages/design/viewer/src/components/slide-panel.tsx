import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

const EASE = [0.2, 0.7, 0.2, 1] as const

/**
 * A side panel that slides open and shut. The wrapper animates its width while
 * the content keeps its own, so nothing inside reflows mid-animation.
 */
export function SlidePanel({
  open,
  side,
  width,
  children,
}: {
  open: boolean
  side: 'left' | 'right'
  width: number
  children: ReactNode
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="panel"
          initial={{ width: 0, opacity: 0.6 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0.6 }}
          transition={{ duration: 0.22, ease: EASE }}
          className={cn('flex min-h-0 shrink-0 overflow-hidden', side === 'right' ? 'justify-start' : 'justify-end')}
        >
          <div className="flex min-h-0 shrink-0" style={{ width }}>
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
