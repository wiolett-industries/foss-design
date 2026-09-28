import type { RuntimeMessage } from '@shared/types'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { listenToFrame, sendToFrame } from '../lib/frames'
import { ripple } from '../lib/ripple'
import { Icon } from '../ui/icon'

/** How long the plate stays after the screen loads, or after a tap shows it. */
const LINGER_MS = 5500
/** A pointer that left the corner hides the plate after this, so passing by does not flicker it. */
const LEAVE_MS = 350

/** The top-right quarter of the window, where the plate lives. */
const inCorner = (x: number, y: number) => x >= window.innerWidth / 2 && y <= window.innerHeight / 2

/**
 * A plate in the top-right corner over a full-window frame. It shows while the screen loads and for a
 * few seconds after, then fades out; a pointer in the window's top-right quarter brings it back and
 * keeps it while it stays there, a tap there shows it for a while, and so does focus inside it.
 *
 * The page does not see the pointer over the frame, so the frame's runtime reports it (0.9.11+).
 * Until a frame does (an older runtime, a URL item), the plate shows whenever the pointer is over the
 * page, as before.
 */
export function CornerPlate({
  frame,
  note,
  badge,
  children,
}: {
  frame: HTMLIFrameElement | null
  /** A muted line under the plate's controls: whose content the screen is. */
  note?: ReactNode
  /**
   * Instead of fading out, the plate folds into this small badge, which a click opens again: for pages
   * anyone can open, so a screen can never pass for the app around it.
   */
  badge?: ReactNode
  children?: ReactNode
}) {
  const [lingering, setLingering] = useState(true)
  const [inside, setInside] = useState(false)
  const [focused, setFocused] = useState(false)
  // Whether the frame reports the pointer; if not, hovering the page stands in for the corner.
  const [reported, setReported] = useState(false)
  const [overPage, setOverPage] = useState(false)
  // Bumped on each load of the screen: the plate draws the eye with a ripple once per screen.
  const [loads, setLoads] = useState(0)
  const plate = useRef<HTMLDivElement>(null)
  const linger = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined)

  const showFor = (ms: number) => {
    setLingering(true)
    clearTimeout(linger.current)
    linger.current = setTimeout(() => setLingering(false), ms)
  }
  const at = (x: number, y: number) => {
    const corner = x >= 0 && inCorner(x, y)
    clearTimeout(leave.current)
    if (corner) setInside(true)
    else leave.current = setTimeout(() => setInside(false), LEAVE_MS)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: helpers only touch refs and setters
  useEffect(() => {
    if (!frame) return
    const ask = () => {
      sendToFrame(frame, { type: 'pointer' })
      showFor(LINGER_MS)
      setLoads((n) => n + 1)
    }
    frame.addEventListener('load', ask)
    const stop = listenToFrame(frame, (message: RuntimeMessage) => {
      if (message.type !== 'pointer') return
      setReported(true)
      if (message.x < 0) return at(-1, -1)
      const rect = frame.getBoundingClientRect()
      const x = rect.left + message.x
      const y = rect.top + message.y
      if (message.down && inCorner(x, y)) showFor(LINGER_MS)
      else at(x, y)
    })
    return () => {
      frame.removeEventListener('load', ask)
      stop()
    }
  }, [frame])

  // biome-ignore lint/correctness/useExhaustiveDependencies: helpers only touch refs and setters
  useEffect(() => {
    // The page's own pointer: over the plate, or over the page around the frame.
    const move = (event: PointerEvent) => at(event.clientX, event.clientY)
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) at(-1, -1)
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', out)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', out)
      clearTimeout(linger.current)
      clearTimeout(leave.current)
    }
  }, [])

  useEffect(() => {
    if (reported) return
    const root = document.documentElement
    const enter = () => setOverPage(true)
    const exit = () => setOverPage(false)
    root.addEventListener('pointerenter', enter)
    root.addEventListener('pointerleave', exit)
    return () => {
      root.removeEventListener('pointerenter', enter)
      root.removeEventListener('pointerleave', exit)
    }
  }, [reported])

  const shown = lingering || inside || focused || (!reported && overPage)

  // Once the plate has come in for a new screen.
  useEffect(() => {
    if (!loads) return
    const timer = setTimeout(() => plate.current && ripple(plate.current), 200)
    return () => clearTimeout(timer)
  }, [loads])

  return (
    <>
      {badge ? (
        <motion.button
          type="button"
          aria-label="Show the page's notice"
          initial={false}
          animate={shown ? { opacity: 0, scale: 0.8 } : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, delay: shown ? 0 : 0.25 }}
          onClick={() => showFor(LINGER_MS)}
          tabIndex={shown ? -1 : 0}
          className={cn(
            'absolute top-3 right-3 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-rule bg-surface/90 px-2.5 text-[11.5px] text-muted shadow-[0_1px_3px_rgb(0_0_0/0.08)] backdrop-blur-sm hover:text-ink2',
            shown && 'pointer-events-none',
          )}
        >
          {badge}
        </motion.button>
      ) : null}
      <motion.div
        ref={plate}
        initial={{ opacity: 0, scale: 0.94, y: -4 }}
        animate={shown ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.97, y: -2 }}
        transition={shown ? { type: 'spring', stiffness: 420, damping: 30 } : { duration: 0.45, ease: 'easeOut' }}
        style={{ transformOrigin: 'top right' }}
        className={cn(
          'absolute top-3 right-3 flex max-w-[calc(100%-24px)] flex-col items-end rounded-[8px]',
          !shown && 'pointer-events-none',
        )}
        aria-hidden={!shown || undefined}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
        }}
      >
        {/* One row: whose content it is, then the controls; short of room the controls go under it. */}
        <div className="flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-[8px] border border-rule bg-surface p-1 shadow-pop">
          {note ? (
            <div className="flex min-h-8 min-w-0 flex-[1_1_auto] items-center gap-1.5 pl-2 text-[12px] leading-snug text-muted last:pr-2">
              <Icon name="info" size={13} className="shrink-0" />
              <span className="min-w-0">{note}</span>
            </div>
          ) : null}
          {children ? <div className="flex items-center gap-1">{children}</div> : null}
        </div>
      </motion.div>
    </>
  )
}
