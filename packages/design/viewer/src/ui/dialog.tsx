import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { IconButton } from './button'
import { floatingSurface } from './menu'
import { PanelBody, PanelFoot, PanelHead } from './panel'

/**
 * A modal over a dimmed page: focus stays inside until it closes, Escape and a
 * click outside close it. Head and foot are a panel's; `actions` go to the foot.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  footNote,
  below,
  width = 440,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Under the title, and what screen readers announce with it. */
  description?: ReactNode
  children?: ReactNode
  /** Buttons at the end of the foot. */
  actions?: ReactNode
  /** Muted text at the start of the foot. */
  footNote?: ReactNode
  /** Full-width content under the body, scrolling on its own: lists with row borders. */
  below?: ReactNode
  width?: number
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
                transition={{ duration: 0.14 }}
                className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-overlay p-6 max-md:px-4"
              >
                <DialogPrimitive.Content
                  asChild
                  forceMount
                  // The first field takes focus; without one the dialog itself does, not its close button.
                  onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    const content = event.currentTarget as HTMLElement
                    const field = content.querySelector<HTMLElement>(
                      'input:not([type="hidden"]), textarea, [data-autofocus]',
                    )
                    ;(field ?? content).focus({ preventScroll: true })
                  }}
                  // Without a description, say so instead of pointing at none.
                  {...(description ? {} : { 'aria-describedby': undefined })}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                    transition={{ type: 'spring', stiffness: 560, damping: 40 }}
                    tabIndex={-1}
                    className={cn(floatingSurface, 'my-auto flex max-w-full flex-col outline-none')}
                    style={{ width }}
                  >
                    <PanelHead
                      title={
                        <DialogPrimitive.Title asChild>
                          <span className="truncate">{title}</span>
                        </DialogPrimitive.Title>
                      }
                      right={
                        <DialogPrimitive.Close asChild>
                          <IconButton icon="x" label="Close" />
                        </DialogPrimitive.Close>
                      }
                    />
                    {description || children ? (
                      <PanelBody>
                        {description ? (
                          <DialogPrimitive.Description className="m-0 text-[13.5px] text-ink2">
                            {description}
                          </DialogPrimitive.Description>
                        ) : null}
                        {children}
                      </PanelBody>
                    ) : null}
                    {below ? (
                      <div className="max-h-[min(56vh,520px)] min-h-0 overflow-y-auto border-t border-rule">
                        {below}
                      </div>
                    ) : null}
                    {actions || footNote ? <PanelFoot left={footNote} right={actions} /> : null}
                  </motion.div>
                </DialogPrimitive.Content>
              </motion.div>
            </DialogPrimitive.Overlay>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
