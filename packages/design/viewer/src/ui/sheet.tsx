import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { IconButton } from './button'

/**
 * A panel sliding up from the bottom edge, for phones: lists to pick from and actions. Like
 * Dialog, focus stays inside, and Escape, a tap on the dimmed page or the close button close it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-overlay"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%', transition: { duration: 0.18, ease: 'easeIn' } }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-[14px] border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop outline-none"
              >
                <div className="flex justify-center pt-2">
                  <span aria-hidden className="h-1 w-9 rounded-full bg-rule-strong" />
                </div>
                <div className="flex min-h-[48px] items-center justify-between gap-3 pr-2 pl-4">
                  <DialogPrimitive.Title className="m-0 truncate text-[15px] font-semibold">
                    {title}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <IconButton icon="x" label="Close" />
                  </DialogPrimitive.Close>
                </div>
                <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-rule">{children}</div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
