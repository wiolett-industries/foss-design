import type { InputHTMLAttributes } from 'react'
import { Label } from './label'

export function Input({ label, hint, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <Label hint={hint}>{label}</Label>
      <input
        className={`h-9 rounded-control border bg-surface px-3 text-body text-ink outline-none placeholder:text-muted focus:border-accent ${error ? 'border-danger' : 'border-rule-strong'}`}
        {...rest}
      />
      {error ? <span className="text-caption text-danger">{error}</span> : null}
    </label>
  )
}
