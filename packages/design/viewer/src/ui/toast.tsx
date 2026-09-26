import { AnimatePresence, motion } from 'motion/react'
import { Store, useStore } from '../lib/store'
import { Icon } from './icon'

interface ToastItem {
  id: number
  title: string
  text?: string
}

const toasts = new Store<ToastItem[]>([])
let next = 1

export function toast(title: string, text?: string) {
  const id = next++
  toasts.set((list) => [...list.slice(-2), { id, title, text }])
  setTimeout(() => toasts.set((list) => list.filter((item) => item.id !== id)), 2200)
}

export function Toaster() {
  const list = useStore(toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {list.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 40 }}
            className="flex max-w-[420px] items-center gap-2.5 rounded-[8px] border border-rule bg-surface px-3 py-2 text-[13px] text-ink shadow-pop"
          >
            <Icon name="check" size={15} className="text-ok-text" />
            <span className="font-medium">{item.title}</span>
            {item.text ? <span className="truncate font-mono text-[12px] text-muted">{item.text}</span> : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
