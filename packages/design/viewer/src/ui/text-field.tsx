import { type ComponentPropsWithRef, type ReactNode, useId } from 'react'
import { cn } from '../lib/cn'
import { Icon, type IconName } from './icon'
import { Muted } from './text'

interface FieldProps {
  label?: ReactNode
  /** Muted line under the field. */
  hint?: ReactNode
  /** Replaces the hint and marks the field invalid. */
  error?: ReactNode
  className?: string
}

/** The box of the ⌘K search field, at control height. */
const frame = (invalid: boolean, disabled?: boolean) =>
  cn(
    'flex w-full min-w-0 items-center gap-2.5 rounded-[6px] border bg-surface px-3 text-ctrl transition-colors',
    'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action',
    invalid ? 'border-danger' : 'border-rule hover:border-rule-strong',
    disabled && 'cursor-not-allowed opacity-45',
  )

const control =
  'min-w-0 grow border-0 bg-transparent p-0 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed'

function Field({ id, label, hint, error, className, children }: FieldProps & { id: string; children: ReactNode }) {
  const note = error ?? hint
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="w-fit">
          <Muted size={12.5}>{label}</Muted>
        </label>
      ) : null}
      {children}
      {note ? (
        <span id={`${id}-note`} className={cn('text-[12.5px]', error ? 'text-danger-text' : 'text-muted')}>
          {note}
        </span>
      ) : null}
    </div>
  )
}

export type TextFieldProps = FieldProps & { icon?: IconName } & Omit<ComponentPropsWithRef<'input'>, 'className'>

/** A one-line text input with a label above and a hint or an error below. */
export function TextField({ label, hint, error, icon, className, id, disabled, ...rest }: TextFieldProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <Field id={fieldId} label={label} hint={hint} error={error} className={className}>
      <div className={cn(frame(!!error, disabled), 'h-ctrl')}>
        {icon ? <Icon name={icon} size={16} className="text-muted" /> : null}
        <input
          id={fieldId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-note` : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn(control, 'h-full')}
          {...rest}
        />
      </div>
    </Field>
  )
}

export type TextAreaProps = FieldProps & Omit<ComponentPropsWithRef<'textarea'>, 'className'>

/** TextField for several lines. */
export function TextArea({ label, hint, error, className, id, disabled, rows = 4, ...rest }: TextAreaProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <Field id={fieldId} label={label} hint={hint} error={error} className={className}>
      <div className={cn(frame(!!error, disabled), 'py-2')}>
        <textarea
          id={fieldId}
          rows={rows}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-note` : undefined}
          className={cn(control, 'resize-y leading-[1.45]')}
          {...rest}
        />
      </div>
    </Field>
  )
}
