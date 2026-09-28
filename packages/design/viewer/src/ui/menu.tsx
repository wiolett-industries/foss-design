import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { type ReactNode, useState } from 'react'
import { cn } from '../lib/cn'

/** Menus and dialogs float on the same surface. */
export const floatingSurface =
  'z-50 overflow-hidden rounded-[8px] border border-rule bg-surface shadow-pop outline-none'

export const menuSurface = `${floatingSurface} py-1 data-[state=open]:animate-[q-pop_120ms_ease-out] data-[state=closed]:animate-[q-pop-out_100ms_ease-in_forwards]`

/** The element the pointer last went over; an iframe when the pointer is inside a frame. */
let hovered: EventTarget | null = null
if (typeof document !== 'undefined')
  document.addEventListener('pointerover', (event) => (hovered = event.target), { capture: true, passive: true })

/**
 * Whether the page's focus just went into a frame that the pointer is not over: a screen focused
 * something while it loaded (an autofocused field), which is no reason to close a menu. A click
 * into a frame has the pointer over it and still closes.
 */
export function focusTakenByFrame(): boolean {
  const active = document.activeElement
  return active instanceof HTMLIFrameElement && hovered !== active
}

export function Menu({
  trigger,
  children,
  width = 220,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
  open,
  onOpenChange,
}: {
  trigger: ReactNode
  children: ReactNode
  width?: number | string
  align?: 'start' | 'end' | 'center'
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  // Controlled here so a close caused by a frame taking focus (Radix closes on the window's blur)
  // can be turned down.
  const [inner, setInner] = useState(false)
  const change = (next: boolean) => {
    if (!next && focusTakenByFrame()) return
    setInner(next)
    onOpenChange?.(next)
  }
  return (
    <DropdownMenu.Root open={open ?? inner} onOpenChange={change} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={12}
          onFocusOutside={keepOpenForFrames}
          className={menuSurface}
          // Never wider than a phone's screen.
          style={{ width, maxWidth: 'calc(100vw - 24px)' }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * A frame that focuses something while it loads (an autofocused field) takes the page's focus into
 * its iframe; that is no reason for an open menu or popover to close. A click outside still is.
 */
export function keepOpenForFrames(event: Event) {
  if (focusTakenByFrame()) event.preventDefault()
}

export const menuItemClass = (danger?: boolean, active?: boolean) =>
  cn(
    'flex min-h-9 w-full cursor-pointer items-center gap-2.5 border-0 px-3 py-1.5 text-left text-[13.5px] outline-none select-none',
    'data-[highlighted]:bg-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
    active ? 'bg-soft' : 'bg-transparent',
    danger ? 'text-danger-text' : 'text-ink',
  )

export function MenuItem({
  children,
  onSelect,
  danger,
  active,
  disabled,
  hint,
  className,
}: {
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  active?: boolean
  disabled?: boolean
  hint?: ReactNode
  className?: string
}) {
  return (
    <DropdownMenu.Item disabled={disabled} onSelect={onSelect} className={cn(menuItemClass(danger, active), className)}>
      {children}
      {hint ? <span className="ml-auto pl-3 text-[12px] text-muted">{hint}</span> : null}
    </DropdownMenu.Item>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-rule" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-[12px] text-muted">{children}</DropdownMenu.Label>
}
