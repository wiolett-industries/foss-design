import * as Popover from '@radix-ui/react-popover'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './icon'
import { menuSurface } from './menu'

export interface ComboboxOption {
  value: string
  label: string
  /** A muted line under the label. */
  sub?: ReactNode
  /** A picture at the start of the row, and of the field while it is the one picked: a thumbnail, an avatar. */
  media?: ReactNode
  /** More text that typing matches besides the label. */
  keywords?: string
}

/**
 * One option out of many, in a field: it shows the picked one, typing narrows the list, arrows and
 * Enter pick without the mouse. The list keeps to a few rows and scrolls, however many there are.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  empty = 'Nothing matches',
  className,
  'aria-label': label,
}: {
  options: ComboboxOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  /** In the list when typing matches nothing. */
  empty?: ReactNode
  className?: string
  'aria-label'?: string
}) {
  const listId = useId()
  const anchor = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const picked = options.find((option) => option.value === value)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? options.filter((option) => `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(q))
      : options
  }, [options, query])
  const current = Math.min(active, shown.length - 1)

  const show = () => {
    setQuery('')
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    )
    setOpen(true)
  }
  const pick = (option: ComboboxOption) => {
    onChange(option.value)
    setOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, current])

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          ref={anchor}
          onClick={() => {
            field.current?.focus()
            if (!open) show()
          }}
          className={cn(
            'flex h-ctrl w-full min-w-0 cursor-text items-center gap-2 rounded-[6px] border border-rule bg-surface pr-2 pl-2 text-ctrl transition-colors hover:border-rule-strong',
            'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action',
            className,
          )}
        >
          {picked?.media && !query ? <span className="flex shrink-0">{picked.media}</span> : null}
          <input
            ref={field}
            value={open ? query : (picked?.label ?? '')}
            placeholder={open && picked ? picked.label : placeholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown[current] ? `${listId}-${current}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!open) return show()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((i) => Math.min(Math.max(i + step, 0), shown.length - 1))
              } else if (event.key === 'Enter' && open && shown[current]) {
                event.preventDefault()
                pick(shown[current]!)
              } else if (event.key === 'Escape' && open) {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
              } else if (event.key === 'Tab') {
                setOpen(false)
              }
            }}
            className="h-full min-w-0 grow border-0 bg-transparent p-0 text-ink outline-none placeholder:text-muted"
          />
          <Icon
            name="chevron-down"
            size={16}
            className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          // Typing stays in the field while the list is open.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchor.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className={cn(
            menuSurface,
            'max-h-[min(296px,var(--radix-popover-content-available-height))] overflow-y-auto',
          )}
          style={{ width: 'var(--radix-popper-anchor-width)' }}
        >
          <div ref={list} id={listId} role="listbox" aria-label={label}>
            {shown.length ? (
              shown.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  // Focus stays in the field.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => index !== current && setActive(index)}
                  onClick={() => pick(option)}
                  className={cn(
                    'flex min-h-[44px] cursor-pointer items-center gap-2.5 px-2 py-1.5 text-[13.5px]',
                    index === current && 'bg-soft',
                  )}
                >
                  {option.media ? <span className="flex shrink-0">{option.media}</span> : null}
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="truncate font-medium text-ink">{option.label}</span>
                    {option.sub ? <span className="truncate text-[12px] text-muted">{option.sub}</span> : null}
                  </span>
                  <span className={cn('flex w-4 shrink-0 text-ink', option.value !== value && 'invisible')}>
                    <Icon name="check" size={16} />
                  </span>
                </div>
              ))
            ) : (
              <div className="px-3 py-2.5 text-[13px] text-muted">{empty}</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
