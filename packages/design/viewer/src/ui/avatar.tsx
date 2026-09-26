import { useState } from 'react'
import { cn } from '../lib/cn'

/** Up to two letters: the first of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/**
 * A person's picture, or their initials when there is none or it fails to
 * load. The picture is fetched without a referrer: it usually sits on a
 * third-party host.
 */
export function Avatar({
  src,
  name,
  size = 28,
  shape = 'circle',
  className,
}: {
  src?: string | null
  name: string
  size?: number
  shape?: 'circle' | 'square'
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const round = shape === 'circle' ? 'rounded-full' : 'rounded-[6px]'
  const box = cn('inline-flex shrink-0 items-center justify-center overflow-hidden bg-soft2', round, className)
  if (src && failed !== src) {
    return (
      <span className={box} style={{ width: size, height: size }}>
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(src)}
          className="block h-full w-full object-cover"
        />
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(box, 'font-semibold text-ink2 select-none')}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {initials(name)}
    </span>
  )
}
