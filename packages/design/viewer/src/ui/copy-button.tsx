import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { buttonClass } from './button'
import { Icon } from './icon'
import { toast } from './toast'

/** A ghost "Copy" button that turns into "Copied" with a check for a moment after it copies. */
export function CopyButton({
  text,
  label = 'Copy',
  done = 'Copied',
  className,
}: {
  text: string
  label?: string
  done?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast('Could not copy', 'The browser blocked clipboard access', 'error')
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(buttonClass('ghost', 'h-7 px-2'), copied && '!text-ok-text', className)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? 'done' : 'copy'}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.14 }}
          className="inline-flex items-center gap-1.5"
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          {copied ? done : label}
        </motion.span>
      </AnimatePresence>
      <span aria-live="polite" className="sr-only">
        {copied ? done : ''}
      </span>
    </button>
  )
}
