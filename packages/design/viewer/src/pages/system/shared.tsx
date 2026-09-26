import type { Theme, Token, TokenKind } from '@shared/types'
import { type ReactNode, useState } from 'react'
import { useTheme } from '../../lib/theme'
import { Segmented } from '../../ui/choice'
import { Icon } from '../../ui/icon'
import { Panel, PanelBody, PanelHead } from '../../ui/panel'
import { Mono } from '../../ui/text'

/** Tailwind classes a token feeds, such as `bg-ink` for `--color-ink`. */
export function utilityHints(token: Token): string[] {
  const key = token.utility
  if (key === undefined) return []
  const k = key ? `-${key}` : ''
  switch (token.kind) {
    case 'color':
      return [`bg${k}`, `text${k}`, `border${k}`]
    case 'font':
      return [`font${k}`]
    case 'text':
      return [`text${k}`]
    case 'weight':
      return [`font${k}`]
    case 'leading':
      return [`leading${k}`]
    case 'tracking':
      return [`tracking${k}`]
    case 'spacing':
      return key ? [`p${k}`, `gap${k}`] : ['p-1', 'gap-4', 'm-2']
    case 'radius':
      return [`rounded${k}`]
    case 'shadow':
      if (token.name.startsWith('--inset-shadow-')) return [`inset-shadow${k}`]
      if (token.name.startsWith('--drop-shadow-')) return [`drop-shadow${k}`]
      if (token.name.startsWith('--text-shadow-')) return [`text-shadow${k}`]
      return [`shadow${k}`]
    case 'blur':
      return [`blur${k}`, `backdrop-blur${k}`]
    case 'ease':
      return [`ease${k}`]
    case 'animation':
      return [`animate${k}`]
    case 'breakpoint':
      return token.name.startsWith('--container-') ? [`@${key}:`, `max-w${k}`] : [`${key}:`]
    default:
      return []
  }
}

export function byKind(tokens: Token[], ...kinds: TokenKind[]): Token[] {
  return tokens.filter((token) => kinds.includes(token.kind))
}

/** Tokens in the order their groups first appear. */
export function groupTokens(tokens: Token[]): { group: string; tokens: Token[] }[] {
  const groups = new Map<string, Token[]>()
  for (const token of tokens) {
    const list = groups.get(token.group) ?? []
    list.push(token)
    groups.set(token.group, list)
  }
  return [...groups].map(([group, list]) => ({ group, tokens: list }))
}

/** A CSS length in pixels, with rem and em at 16px; null when it is not a plain length. */
export function toPx(value: string): number | null {
  const match = /^(-?[\d.]+)(px|rem|em)?$/.exec(value.trim())
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n)) return null
  return match[2] === 'rem' || match[2] === 'em' ? n * 16 : n
}

/** The value a token has in `theme`, falling back to light. */
export function valueIn(token: Token, theme: Theme): string | undefined {
  return (theme === 'dark' ? token.dark?.value : undefined) ?? token.light?.value
}

/** A section's theme: follows the app until the reader picks one. */
export function useLocalTheme(): [Theme, (theme: Theme) => void] {
  const app = useTheme()
  const [picked, setPicked] = useState<Theme | null>(null)
  return [picked ?? app, setPicked]
}

export function ThemeSwitch({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return (
    <Segmented
      label="Theme"
      size="sm"
      value={value}
      onChange={onChange}
      items={[
        { value: 'light', label: <Icon name="sun" size={14} />, title: 'Light' },
        { value: 'dark', label: <Icon name="moon" size={14} />, title: 'Dark' },
      ]}
    />
  )
}

export function Hints({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
      {items.map((item) => (
        <Mono key={item} size={12} className="text-muted">
          {item}
        </Mono>
      ))}
    </span>
  )
}

/** What to add, and where, when a page has nothing to show. */
export function EmptyPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <PanelHead title={title} />
      <PanelBody>
        <div className="py-4 text-[13px] text-muted">{children}</div>
      </PanelBody>
    </Panel>
  )
}

export const TOKENS_FILE = '.design/system/tokens.css'

/** A token value in mono that wraps between words, never inside a number. */
export function Value({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[12px] text-muted [overflow-wrap:anywhere] ${className ?? ''}`}>{children}</span>
  )
}
