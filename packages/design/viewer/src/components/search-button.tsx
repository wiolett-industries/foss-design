import { cn } from '../lib/cn'
import { MOD_KEY } from '../lib/platform'
import { Icon } from '../ui/icon'
import { Kbd } from '../ui/text'
import { Tooltip } from '../ui/tooltip'

export function openPalette() {
  window.dispatchEvent(new CustomEvent('design:palette'))
}

const SHORTCUT = MOD_KEY === '⌘' ? '⌘K' : 'Ctrl K'

/**
 * Opens ⌘K. As tall as the buttons next to it. Without `compact` it drops the label on narrow
 * screens; a bar that measures its own room passes `compact` instead, and gets a square icon
 * with a tooltip when short of it.
 */
export function SearchButton({
  width = 240,
  label = 'Search and jump',
  compact,
}: {
  width?: number
  label?: string
  compact?: boolean
}) {
  if (compact) {
    return (
      <Tooltip
        content={
          <span className="flex items-center gap-1.5">
            {label} <Kbd>{SHORTCUT}</Kbd>
          </span>
        }
      >
        <button
          type="button"
          onClick={openPalette}
          aria-label={label}
          className="inline-flex h-ctrl w-ctrl shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-rule bg-soft text-muted transition-colors hover:border-rule-strong"
        >
          <Icon name="search" size={15} />
        </button>
      </Tooltip>
    )
  }
  const measured = compact === false
  return (
    <button
      type="button"
      onClick={openPalette}
      style={{ width }}
      aria-label={label}
      className={cn(
        'flex h-ctrl min-w-0 cursor-pointer items-center gap-2 rounded-[6px] border border-rule bg-soft pr-1.5 pl-3 text-ctrl text-muted transition-colors hover:border-rule-strong',
        measured
          ? 'shrink-0'
          : 'shrink max-lg:w-auto! max-md:w-ctrl! max-md:justify-center max-md:border-0! max-md:bg-transparent! max-md:p-0!',
      )}
    >
      <Icon name="search" size={15} />
      <span className={cn('min-w-0 grow truncate text-left', !measured && 'max-lg:hidden')}>{label}</span>
      <span className={cn('flex', !measured && 'max-md:hidden')}>
        <Kbd>{SHORTCUT}</Kbd>
      </span>
    </button>
  )
}
