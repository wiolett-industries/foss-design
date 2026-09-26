import { motion } from 'motion/react'
import { type ReactNode, useId } from 'react'
import { cn } from '../lib/cn'

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange?: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative h-[18px] w-[32px] shrink-0 cursor-pointer rounded-[9px] border-0 p-0 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-ink' : 'bg-rule-strong',
      )}
    >
      <span
        className="absolute top-[2px] left-[2px] size-[14px] rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{ transform: checked ? 'translateX(14px)' : 'none' }}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  stretch,
  size = 'ctrl',
}: {
  items: { value: T; label: ReactNode; title?: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  stretch?: boolean
  size?: 'ctrl' | 'sm'
}) {
  const indicator = useId()
  return (
    // biome-ignore lint/a11y/useSemanticElements: segmented control, not a form fieldset
    <div
      role="group"
      aria-label={label}
      className={cn(
        'shrink-0 items-center gap-0.5 rounded-[6px] bg-track p-[3px]',
        size === 'ctrl' ? 'h-ctrl' : 'h-7',
        stretch ? 'flex' : 'inline-flex',
      )}
    >
      {items.map((item) => {
        const on = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={on}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative flex h-full cursor-pointer items-center justify-center whitespace-nowrap rounded-[4px] border-0 bg-transparent font-medium transition-colors',
              size === 'ctrl' ? 'px-2.5 text-ctrl' : 'px-2 text-[12.5px]',
              stretch && 'flex-1',
              on ? 'text-ink' : 'text-muted hover:text-ink2',
            )}
          >
            {on ? (
              <motion.span
                layoutId={indicator}
                className="absolute inset-0 rounded-[4px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.10)]"
                transition={{ type: 'spring', stiffness: 520, damping: 42 }}
              />
            ) : null}
            <span className="relative flex items-center gap-1.5">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
