import { motion } from 'motion/react'
import { Children, type CSSProperties, type ReactNode, useId } from 'react'
import { Link } from 'wouter'
import { cn } from '../lib/cn'
import { Count } from './badge'

export function Panel({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <section
      className={cn('min-w-0 shrink-0 overflow-hidden rounded-[10px] border border-rule bg-surface', className)}
      style={style}
    >
      {children}
    </section>
  )
}

export function PanelHead({
  title,
  count,
  sub,
  right,
  as: Heading = 'h2',
}: {
  title: ReactNode
  count?: number
  sub?: ReactNode
  right?: ReactNode
  as?: 'h2' | 'h3'
}) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 px-4">
      <Heading className="m-0 flex min-w-0 items-center gap-2 whitespace-nowrap text-[14px] font-semibold">
        {title}
        {count !== undefined ? <Count value={count} /> : null}
        {sub ? <span className="truncate text-[12.5px] font-normal text-muted">{sub}</span> : null}
      </Heading>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  )
}

export function PanelTabs<T extends string>({
  items,
  value,
  onChange,
  right,
}: {
  items: { value: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (value: T) => void
  right?: ReactNode
}) {
  const indicator = useId()
  return (
    <div className="flex h-[46px] items-center justify-between gap-3 px-4">
      <div role="tablist" className="flex gap-5">
        {items.map((item) => {
          const on = item.value === value
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(item.value)}
              className={cn(
                'relative flex h-[46px] cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0.5 text-[14px] transition-colors',
                on ? 'font-semibold text-ink' : 'font-medium text-ink2 hover:text-ink',
              )}
            >
              {item.label}
              {item.count !== undefined ? <Count value={item.count} /> : null}
              {on ? (
                <motion.span
                  layoutId={indicator}
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-ink"
                  transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                />
              ) : null}
            </button>
          )
        })}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  )
}

type Align = 'l' | 'r' | 'c'

function Cell({ align, children }: { align: Align; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2',
        align === 'r' && 'justify-end text-right',
        align === 'c' && 'justify-center',
      )}
    >
      {children}
    </div>
  )
}

function cells(children: ReactNode, align?: string) {
  return Children.toArray(children).map((child, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
    <Cell key={index} align={(align?.[index] as Align) ?? 'l'}>
      {child}
    </Cell>
  ))
}

export function THead({ cols, align, labels }: { cols: string; align?: string; labels: ReactNode[] }) {
  return (
    <div
      className="grid h-8 items-center gap-x-4 border-t border-rule bg-soft px-4 text-[12.5px] text-muted"
      style={{ gridTemplateColumns: cols }}
    >
      {labels.map((label, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: header cells are positional
        <Cell key={index} align={(align?.[index] as Align) ?? 'l'}>
          <span className="whitespace-nowrap">{label}</span>
        </Cell>
      ))}
    </div>
  )
}

export interface RowProps {
  cols: string
  align?: string
  minH?: number
  pad?: string
  first?: boolean
  className?: string
  children: ReactNode
  onClick?: () => void
  title?: string
}

const rowClass = (first: boolean | undefined, interactive: boolean, className?: string) =>
  cn(
    'grid items-center gap-x-4 border-rule',
    !first && 'border-t',
    interactive && 'cursor-pointer transition-colors hover:bg-soft',
    className,
  )

export function Row({
  cols,
  align,
  minH = 44,
  pad = '10px 16px',
  children,
  first,
  className,
  onClick,
  title,
}: RowProps) {
  return (
    <div
      className={rowClass(first, !!onClick, className)}
      style={{ gridTemplateColumns: cols, minHeight: minH, padding: pad }}
      onClick={onClick}
      title={title}
    >
      {cells(children, align)}
    </div>
  )
}

/** A table row that navigates somewhere in the app. */
export function RowLink({
  to,
  cols,
  align,
  minH = 44,
  pad = '10px 16px',
  first,
  className,
  children,
}: RowProps & { to: string }) {
  return (
    <Link
      href={to}
      className={cn(rowClass(first, true, className), 'text-inherit no-underline')}
      style={{ gridTemplateColumns: cols, minHeight: minH, padding: pad }}
    >
      {cells(children, align)}
    </Link>
  )
}

export function KV({
  label,
  children,
  labelWidth = 180,
  minH = 40,
  end = false,
}: {
  label: ReactNode
  children: ReactNode
  labelWidth?: number
  minH?: number
  end?: boolean
}) {
  return (
    <div
      className="grid content-center items-baseline gap-x-4 border-t border-rule px-4 py-2"
      style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)`, minHeight: minH }}
    >
      <span className="text-[13px] text-muted">{label}</span>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-2', end && 'justify-end')}>{children}</div>
    </div>
  )
}

export function PanelBody({
  children,
  pad = '16px',
  gap = 16,
  top = true,
  className,
}: {
  children: ReactNode
  pad?: string
  gap?: number
  top?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-col', top && 'border-t border-rule', className)} style={{ padding: pad, gap }}>
      {children}
    </div>
  )
}

export function PanelFoot({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule bg-soft px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">{left}</div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  )
}

/** Bottom summary strip. */
export function Strip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-[38px] items-center gap-2 border-t border-rule bg-soft px-4 py-2 text-[12.5px] text-muted',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Group header row inside tables. */
export function GroupRow({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2.5 border-t border-rule bg-soft px-4 text-[13px] font-medium">
      {children}
      {sub ? <span className="text-[12.5px] font-normal text-muted">{sub}</span> : null}
    </div>
  )
}
