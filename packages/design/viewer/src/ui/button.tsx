import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { Link } from 'wouter'
import { cn } from '../lib/cn'
import { Icon, type IconName } from './icon'

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'dashed' | 'danger'

const KIND: Record<ButtonKind, string> = {
  primary: 'border border-primary bg-primary text-primary-ink hover:opacity-90',
  secondary: 'border border-rule-strong bg-surface text-ink hover:bg-soft',
  ghost: 'border border-transparent bg-transparent text-ink2 hover:bg-soft2',
  dashed: 'border border-dashed border-rule-strong bg-transparent text-ink2 hover:bg-soft',
  danger: 'border border-danger bg-danger text-on-danger hover:opacity-90',
}

export const buttonClass = (kind: ButtonKind = 'secondary', extra?: string) =>
  cn(
    'inline-flex h-ctrl shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-ctrl text-ctrl font-medium leading-none no-underline transition-[background-color,opacity,scale] duration-100 active:not-disabled:scale-[0.97]',
    'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45',
    KIND[kind],
    extra,
  )

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind
  icon?: IconName
  loading?: boolean
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = 'secondary', icon, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(kind, className)}
      {...rest}
    >
      {loading ? (
        <Icon name="loader" size={15} className="animate-spin" />
      ) : icon ? (
        <Icon name={icon} size={15} />
      ) : null}
      {children}
    </button>
  )
})

const ICON_KIND = {
  ghost: 'border border-transparent bg-transparent text-muted hover:bg-soft2 hover:text-ink2',
  secondary: 'border border-rule-strong bg-surface text-ink2 hover:bg-soft',
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  kind?: keyof typeof ICON_KIND
  size?: number
}

export const iconButtonClass = (kind: keyof typeof ICON_KIND = 'ghost', extra?: string) =>
  cn(
    'inline-flex h-ctrl w-ctrl shrink-0 cursor-pointer items-center justify-center rounded-[6px] p-0 transition-[color,background-color,scale] duration-100 active:not-disabled:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-45',
    ICON_KIND[kind],
    extra,
  )

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, kind = 'ghost', size = 16, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={iconButtonClass(kind, className)}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
})

/** An in-app link styled as a button. */
export function ButtonLink({
  to,
  kind = 'secondary',
  icon,
  className,
  children,
}: {
  to: string
  kind?: ButtonKind
  icon?: IconName
  className?: string
  children?: ReactNode
}) {
  return (
    <Link href={to} className={buttonClass(kind, className)}>
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </Link>
  )
}

/** A link out of the app (a frame in a new tab), styled as a button. */
export function ButtonAnchor({
  kind = 'secondary',
  icon,
  className,
  children,
  ...rest
}: { kind?: ButtonKind; icon?: IconName } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={buttonClass(kind, className)} {...rest}>
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </a>
  )
}
