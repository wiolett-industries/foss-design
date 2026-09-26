import type { SystemDoc, Token } from '@shared/types'
import { cn } from '../../lib/cn'
import { copyText } from '../../lib/copy'
import { PageHead } from '../../ui/page'
import { Panel, PanelHead, Row } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { byKind, EmptyPanel, groupTokens, Hints, TOKENS_FILE, utilityHints } from './shared'

function Swatch({ color, label, className }: { color?: string; label: string; className?: string }) {
  if (!color) return <span className={cn('h-[30px] w-[44px] shrink-0', className)} />
  return (
    <span
      title={`${label}: ${color}`}
      className={cn('checker relative h-[30px] w-[44px] shrink-0 overflow-hidden rounded-[6px]', className)}
    >
      <span
        className="absolute inset-0 rounded-[6px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
        style={{ background: color }}
      />
    </span>
  )
}

/** Every color of a group side by side, light on top and dark below when the group has dark values. */
function Strip({ tokens }: { tokens: Token[] }) {
  const hasDark = tokens.some((token) => token.dark)
  const row = (theme: 'light' | 'dark') => (
    <div className="relative flex h-9 min-w-0 grow overflow-hidden rounded-[6px]">
      <span className="pointer-events-none absolute inset-0 z-10 rounded-[6px] shadow-[inset_0_0_0_1px_var(--rule-strong)] opacity-60" />
      {tokens.map((token) => {
        const color = theme === 'dark' ? (token.dark?.value ?? token.light?.value) : token.light?.value
        return (
          <button
            key={token.name}
            type="button"
            title={`${token.name}: ${color}`}
            onClick={() => copyText(`var(${token.name})`)}
            className="h-full min-w-0 flex-1 cursor-pointer border-0 p-0 transition-[flex-grow] duration-150 hover:grow-[1.6]"
            style={{ background: color }}
          />
        )
      })}
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5 border-t border-rule px-4 py-3">
      <div className="flex items-center gap-3">
        {hasDark ? <span className="w-9 shrink-0 text-[12px] text-muted">Light</span> : null}
        {row('light')}
      </div>
      {hasDark ? (
        <div className="flex items-center gap-3">
          <span className="w-9 shrink-0 text-[12px] text-muted">Dark</span>
          {row('dark')}
        </div>
      ) : null}
    </div>
  )
}

function ColorRow({ token }: { token: Token }) {
  return (
    <Row
      cols="100px minmax(170px, 0.9fr) minmax(0, 1.4fr)"
      minH={56}
      title="Copy the variable"
      onClick={() => copyText(`var(${token.name})`)}
    >
      <span className="flex items-center gap-1.5">
        <Swatch color={token.light?.value} label="Light" />
        {token.dark ? <Swatch color={token.dark.value} label="Dark" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Mono size={12.5} className="truncate text-ink">
          {token.name}
        </Mono>
        <Hints items={utilityHints(token).slice(0, 2)} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap gap-x-3">
          <Mono size={12} className="text-muted">
            {token.light?.value}
          </Mono>
          {token.dark ? (
            <Mono size={12} className="text-muted">
              dark {token.dark.value}
            </Mono>
          ) : null}
        </span>
        {token.description ? <span className="text-[13px] text-ink2">{token.description}</span> : null}
      </span>
    </Row>
  )
}

export function ColorsPage({ system }: { system: SystemDoc }) {
  const colors = byKind(system.tokens, 'color')
  const groups = groupTokens(colors)
  return (
    <>
      <PageHead
        title="Colors"
        sub={colors.length ? `${colors.length} tokens · click a color to copy its variable` : undefined}
      />
      {groups.length ? (
        groups.map(({ group, tokens }) => (
          <Panel key={group}>
            <PanelHead title={group} count={tokens.length} />
            <Strip tokens={tokens} />
            {tokens.map((token) => (
              <ColorRow key={token.name} token={token} />
            ))}
          </Panel>
        ))
      ) : (
        <EmptyPanel title="No color tokens">
          Add them to <Mono>{TOKENS_FILE}</Mono>: light values in <Mono>:root</Mono>, dark ones in{' '}
          <Mono>:root[data-theme="dark"]</Mono>, and map them to Tailwind with <Mono>--color-*</Mono> in{' '}
          <Mono>@theme inline</Mono>.
        </EmptyPanel>
      )}
    </>
  )
}
