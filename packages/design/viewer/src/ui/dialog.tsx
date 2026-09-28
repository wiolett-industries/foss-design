import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { type ReactNode, type SyntheticEvent, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { useIsPhone } from '../lib/phone'
import { IconButton } from './button'
import { floatingSurface } from './menu'
import { PanelBody, PanelFoot, PanelHead } from './panel'

/**
 * A modal over a dimmed page: focus stays inside until it closes, Escape and a
 * click outside close it. Head and foot are a panel's; `actions` go to the foot.
 * On a phone it is a sheet from the bottom edge with a handle: swiping it down closes it too.
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
  step,
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
  /**
   * The dialog's current step, for a dialog that turns into another one in place (a confirmation
   * that becomes its result): a new value cross-fades the content while the panel eases to its size.
   */
  step?: string
}) {
  const phone = useIsPhone()
  const drag = useDragControls()

  // The first field takes focus; without one the dialog itself does, not its close button.
  const autoFocus = (event: Event | SyntheticEvent) => {
    event.preventDefault()
    const content = event.currentTarget as HTMLElement
    const field = content.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, [data-autofocus]')
    ;(field ?? content).focus({ preventScroll: true })
  }
  const head = (
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
  )
  const body =
    description || children ? (
      <PanelBody>
        {description ? (
          <DialogPrimitive.Description className="m-0 text-[13.5px] text-ink2">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
      </PanelBody>
    ) : null
  const list = below ? (
    <div className="max-h-[min(56vh,520px)] min-h-0 overflow-y-auto border-t border-rule">{below}</div>
  ) : null
  const foot = actions || footNote ? <PanelFoot left={footNote} right={actions} /> : null
  // Without a description, say so instead of pointing at none.
  const described = description ? {} : { 'aria-describedby': undefined }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && phone ? (
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
            <DialogPrimitive.Content asChild forceMount onOpenAutoFocus={autoFocus} {...described}>
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%', transition: { duration: 0.18, ease: 'easeIn' } }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                drag="y"
                dragControls={drag}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 96 || info.velocity.y > 600) onOpenChange(false)
                }}
                tabIndex={-1}
                className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-[14px] border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop outline-none"
              >
                {/* The handle and the head drag the sheet; the body scrolls as usual. */}
                <div className="shrink-0 touch-none" onPointerDown={(event) => drag.start(event)}>
                  <div className="flex justify-center pt-2">
                    <span aria-hidden className="h-1 w-9 rounded-full bg-rule-strong" />
                  </div>
                  {head}
                </div>
                <Step step={step} className="flex min-h-0 flex-col">
                  <div className="min-h-0 overflow-y-auto overscroll-contain">
                    {body}
                    {list}
                  </div>
                  {foot}
                </Step>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-overlay p-6 max-md:px-4"
              >
                <DialogPrimitive.Content asChild forceMount onOpenAutoFocus={autoFocus} {...described}>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                    transition={{ type: 'spring', stiffness: 560, damping: 40 }}
                    tabIndex={-1}
                    className={cn(floatingSurface, 'my-auto flex max-w-full flex-col outline-none')}
                    style={{ width }}
                  >
                    <Resizing>
                      <Step step={step}>
                        {head}
                        {body}
                        {list}
                        {foot}
                      </Step>
                    </Resizing>
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

/** Eases its height to its content's, so a panel whose content changes grows and shrinks smoothly. */
function Resizing({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ type: 'spring', stiffness: 520, damping: 44 }}
      className="overflow-hidden"
    >
      <div ref={inner} className="flex flex-col">
        {children}
      </div>
    </motion.div>
  )
}

/** Fades the content in again when the dialog's step changes. */
function Step({ step, className, children }: { step?: string; className?: string; children: ReactNode }) {
  // The dialog's own entrance shows the first step; only later steps fade in.
  const first = useRef(step)
  return (
    <motion.div
      key={step ?? ''}
      initial={step === first.current ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={className ?? 'flex flex-col'}
    >
      {children}
    </motion.div>
  )
}
