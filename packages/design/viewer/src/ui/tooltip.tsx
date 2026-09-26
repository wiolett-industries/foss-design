import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../lib/cn'

/** Mounted once at the root; moving between triggers skips the delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>
}

const tooltipSurface =
  'z-50 max-w-[280px] rounded-[8px] border border-rule bg-surface px-[10px] py-[7px] text-[12.5px] leading-[1.35] text-ink shadow-pop outline-none data-[state=delayed-open]:animate-[q-pop_120ms_ease-out] data-[state=closed]:animate-[q-pop-out_100ms_ease-in_forwards]'

/** Hint on hover and focus; `children` is the trigger itself. */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
}: {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn(tooltipSurface, className)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
