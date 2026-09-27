import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Store, useStore } from '../lib/store'
import { Icon } from './icon'

interface ToastItem {
  id: number
  title: string
  text?: string
  tone: ToastTone
}

export type ToastTone = 'ok' | 'info' | 'error'

const toasts = new Store<ToastItem[]>([])
let next = 1

/** A short confirmation; `error` shows a failure and stays a little longer to be read. */
export function toast(title: string, text?: string, tone: ToastTone = 'ok') {
  const id = next++
  toasts.set((list) => [...list.slice(-2), { id, title, text, tone }])
  setTimeout(() => toasts.set((list) => list.filter((item) => item.id !== id)), tone === 'error' ? 4200 : 2200)
}

const hosts = new Store<number[]>([])
let nextHost = 1

/** Only the first mounted Toaster shows toasts: an app that embeds the viewer may keep its own. */
export function Toaster() {
  const [host] = useState(() => nextHost++)
  useEffect(() => {
    hosts.set((list) => [...list, host])
    return () => hosts.set((list) => list.filter((item) => item !== host))
  }, [host])
  const shown = useStore(hosts, (list) => list[0] === host)
  const list = useStore(toasts)
  if (!shown) return null
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence mode="popLayout">
        {list.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 40 }}
            className="flex max-w-[min(420px,calc(100vw-32px))] min-w-0 items-center gap-2.5 rounded-[8px] border border-rule bg-surface px-3 py-2 text-[13px] text-ink shadow-pop"
          >
            {item.tone === 'error' ? (
              <Icon name="alert" size={15} className="text-danger-text" />
            ) : item.tone === 'info' ? (
              <Icon name="info" size={15} className="text-muted" />
            ) : (
              <Icon name="check" size={15} className="text-ok-text" />
            )}
            <span className="shrink-0 font-medium whitespace-nowrap">{item.title}</span>
            {item.text ? <span className="min-w-0 truncate font-mono text-[12px] text-muted">{item.text}</span> : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
