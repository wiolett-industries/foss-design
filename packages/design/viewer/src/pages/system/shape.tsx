import type { SystemDoc, Token } from '@shared/types'
import type { ReactNode } from 'react'
import { copyText } from '../../lib/copy'
import { useTheme } from '../../lib/theme'
import { PageHead } from '../../ui/page'
import { Panel, PanelHead, Row, THead } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { byKind, EmptyPanel, Hints, TOKENS_FILE, toPx, utilityHints, Value, valueIn } from './shared'

const MULTIPLES = [1, 2, 3, 4, 6, 8, 12, 16]
const BAR_MAX = 480

function Bar({ px }: { px: number | null }) {
  if (px === null) return <span className="text-[12.5px] text-muted">not a plain length</span>
  return (
    <span className="flex h-3 items-center">
      <span
        className="h-3 rounded-[3px] bg-action/70"
        style={{ width: Math.max(2, Math.min(px, BAR_MAX)) }}
        title={`${px}px`}
      />
      {px > BAR_MAX ? <span className="ml-1.5 text-[12px] text-muted">…</span> : null}
    </span>
  )
}

function Spacing({ tokens }: { tokens: Token[] }) {
  const base = tokens.find((token) => token.name === '--spacing')
  const named = tokens.filter((token) => token !== base)
  const basePx = base?.light ? toPx(base.light.value) : null
  const cols = 'minmax(150px,0.8fr) 110px minmax(0,2fr)'
  return (
    <Panel>
      <PanelHead title="Spacing" count={tokens.length} sub={base ? `base ${base.light?.value}` : undefined} />
      <THead cols={cols} labels={['Class or token', 'Value', '']} />
      {base && basePx !== null
        ? MULTIPLES.map((n) => (
            <Row key={n} cols={cols} minH={36} pad="6px 16px">
              <Mono size={12.5} className="text-ink">
                p-{n} · gap-{n}
              </Mono>
              <Mono size={12} className="text-muted">
                {basePx * n}px
              </Mono>
              <Bar px={basePx * n} />
            </Row>
          ))
        : null}
      {named.map((token) => (
        <Row
          key={token.name}
          cols={cols}
          minH={40}
          pad="6px 16px"
          title="Copy the variable"
          onClick={() => copyText(`var(${token.name})`)}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <Mono size={12.5} className="truncate text-ink">
              {token.name}
            </Mono>
            {token.description ? <span className="truncate text-[12.5px] text-muted">{token.description}</span> : null}
          </span>
          <Mono size={12} className="text-muted">
            {token.light?.value}
          </Mono>
          <Bar px={token.light ? toPx(token.light.value) : null} />
        </Row>
      ))}
    </Panel>
  )
}

function Tile({ token, children }: { token: Token; children: ReactNode }) {
  return (
    <button
      type="button"
      title="Copy the variable"
      onClick={() => copyText(`var(${token.name})`)}
      className="flex min-w-0 cursor-pointer flex-col items-stretch gap-2.5 rounded-[8px] border border-transparent bg-transparent p-2 text-left transition-colors hover:border-rule hover:bg-soft"
    >
      {children}
      <span className="flex min-w-0 flex-col gap-0.5 px-1">
        <Mono size={12.5} className="truncate text-ink">
          {token.name}
        </Mono>
        <Hints items={utilityHints(token)} />
        <Value>{token.light?.value}</Value>
        {token.description ? <span className="text-[12.5px] text-ink2">{token.description}</span> : null}
      </span>
    </button>
  )
}

function TileGrid({
  title,
  tokens,
  min = 170,
  children,
}: {
  title: string
  tokens: Token[]
  min?: number
  children: (token: Token) => ReactNode
}) {
  return (
    <Panel>
      <PanelHead title={title} count={tokens.length} />
      <div
        className="grid gap-2 border-t border-rule p-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}
      >
        {tokens.map((token) => (
          <Tile key={token.name} token={token}>
            {children(token)}
          </Tile>
        ))}
      </div>
    </Panel>
  )
}

function Breakpoints({ tokens }: { tokens: Token[] }) {
  const cols = 'minmax(170px,1fr) minmax(90px,0.6fr) 110px 90px'
  return (
    <Panel>
      <PanelHead title="Breakpoints" count={tokens.length} />
      <THead cols={cols} labels={['Token', 'Variant', 'Value', 'Pixels']} align="lllr" />
      {tokens.map((token) => {
        const px = token.light ? toPx(token.light.value) : null
        return (
          <Row key={token.name} cols={cols} align="lllr" minH={40} onClick={() => copyText(`var(${token.name})`)}>
            <Mono size={12.5} className="truncate text-ink">
              {token.name}
            </Mono>
            <Hints items={utilityHints(token)} />
            <Mono size={12} className="text-muted">
              {token.light?.value}
            </Mono>
            <Mono size={12} className="text-muted">
              {px === null ? '' : `${px}px`}
            </Mono>
          </Row>
        )
      })}
    </Panel>
  )
}

export function ShapePage({ system }: { system: SystemDoc }) {
  const theme = useTheme()
  const spacing = byKind(system.tokens, 'spacing')
  const radii = byKind(system.tokens, 'radius')
  const shadows = byKind(system.tokens, 'shadow')
  const blurs = byKind(system.tokens, 'blur')
  const breakpoints = byKind(system.tokens, 'breakpoint')
  const empty = !spacing.length && !radii.length && !shadows.length && !blurs.length && !breakpoints.length
  return (
    <>
      <PageHead title="Spacing & shape" sub="Click a token to copy its variable." />
      {empty ? (
        <EmptyPanel title="No spacing or shape tokens">
          Add <Mono>--spacing</Mono> (the base step), <Mono>--spacing-*</Mono>, <Mono>--radius-*</Mono>,{' '}
          <Mono>--shadow-*</Mono> and <Mono>--breakpoint-*</Mono> to the <Mono>@theme</Mono> block in{' '}
          <Mono>{TOKENS_FILE}</Mono>.
        </EmptyPanel>
      ) : null}
      {spacing.length ? <Spacing tokens={spacing} /> : null}
      {radii.length ? (
        <TileGrid title="Radii" tokens={radii}>
          {(token) => (
            <span className="flex h-[88px] items-center justify-center rounded-[6px] bg-soft">
              <span
                className="size-14 border border-rule-strong bg-surface"
                style={{ borderRadius: token.light?.value }}
              />
            </span>
          )}
        </TileGrid>
      ) : null}
      {shadows.length ? (
        <TileGrid title="Shadows" tokens={shadows} min={200}>
          {(token) => (
            <span className="flex h-[112px] items-center justify-center rounded-[6px] bg-soft">
              <span
                className="h-[60px] w-[108px] rounded-[8px] bg-surface"
                style={{ boxShadow: valueIn(token, theme) }}
              />
            </span>
          )}
        </TileGrid>
      ) : null}
      {blurs.length ? (
        <TileGrid title="Blur" tokens={blurs}>
          {(token) => (
            <span className="relative flex h-[88px] items-center justify-center overflow-hidden rounded-[6px] bg-soft">
              <span className="absolute left-5 top-4 size-10 rounded-full bg-action" />
              <span className="absolute right-6 bottom-3 size-12 rounded-[6px] bg-ink2" />
              <span
                className="absolute inset-x-6 inset-y-5 rounded-[6px] bg-surface/40"
                style={{ backdropFilter: `blur(${token.light?.value})` }}
              />
            </span>
          )}
        </TileGrid>
      ) : null}
      {breakpoints.length ? <Breakpoints tokens={breakpoints} /> : null}
    </>
  )
}
