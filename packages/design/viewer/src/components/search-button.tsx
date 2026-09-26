import { MOD_KEY } from '../lib/platform'
import { Icon } from '../ui/icon'
import { Kbd } from '../ui/text'

export function openPalette() {
  window.dispatchEvent(new CustomEvent('design:palette'))
}

/** Opens ⌘K. As tall as the buttons next to it; drops the label on narrow screens. */
export function SearchButton({ width = 240, label = 'Search and jump' }: { width?: number; label?: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      style={{ width }}
      className="flex h-ctrl min-w-0 shrink cursor-pointer items-center gap-2 rounded-[6px] border border-rule bg-soft pr-1.5 pl-3 text-ctrl text-muted transition-colors hover:border-rule-strong max-lg:w-auto!"
    >
      <Icon name="search" size={15} />
      <span className="min-w-0 grow truncate text-left max-lg:hidden">{label}</span>
      <Kbd>{MOD_KEY === '⌘' ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  )
}
