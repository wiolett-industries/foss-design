import type { ButtonHTMLAttributes } from 'react'

export type ButtonKind = 'primary' | 'secondary' | 'ghost'

const KIND: Record<ButtonKind, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-rule-strong bg-surface text-ink hover:bg-soft',
  ghost: 'text-ink-2 hover:bg-soft',
}

export function Button({
  kind = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind }) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-control px-3.5 text-body font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${KIND[kind]} ${className}`}
      {...rest}
    />
  )
}
