import type { SystemDoc, Token } from '@shared/types'
import { useState } from 'react'
import { copyText } from '../../lib/copy'
import { PageHead } from '../../ui/page'
import { Panel, PanelHead, Row, THead } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { byKind, EmptyPanel, Hints, TOKENS_FILE, utilityHints, Value } from './shared'

type Bezier = [number, number, number, number]

const KEYWORDS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

export function parseBezier(value: string): Bezier | null {
  const v = value.trim()
  if (KEYWORDS[v]) return KEYWORDS[v]!
  const match = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(v)
  if (!match) return null
  const points = match.slice(1).map(Number) as Bezier
  return points.every(Number.isFinite) ? points : null
}

/** Duration in ms of `120ms`, `0.2s`; null otherwise. */
function toMs(value: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1)
}

const SIZE = 132
const PAD = 22

/** The curve in a unit square, with room for overshoot above and below. */
function Curve({ bezier }: { bezier: Bezier }) {
  const [x1, y1, x2, y2] = bezier
  const minY = Math.min(0, y1, y2)
  const maxY = Math.max(1, y1, y2)
  const inner = SIZE - PAD * 2
  const scaleY = inner / (maxY - minY)
  const px = (x: number) => PAD + x * inner
  const py = (y: number) => PAD + (maxY - y) * scaleY
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="shrink-0">
      <rect x={px(0)} y={py(1)} width={inner} height={py(0) - py(1)} className="fill-none stroke-rule" />
      <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} className="stroke-rule-strong" strokeDasharray="3 3" />
      <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} className="stroke-rule-strong" strokeDasharray="3 3" />
      <path
        d={`M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`}
        className="fill-none stroke-ink"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={px(x1)} cy={py(y1)} r={3} className="fill-action" />
      <circle cx={px(x2)} cy={py(y2)} r={3} className="fill-action" />
    </svg>
  )
}

function EaseCard({ token, duration }: { token: Token; duration: number }) {
  const [on, setOn] = useState(false)
  const value = token.light?.value ?? ''
  const bezier = parseBezier(value)
  return (
    <button
      type="button"
      title="Hover to play; click to copy the variable"
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)}
      onBlur={() => setOn(false)}
      onClick={() => copyText(`var(${token.name})`)}
      className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-[8px] border border-transparent bg-transparent p-3 text-left transition-colors hover:border-rule hover:bg-soft"
    >
      <span className="flex h-[132px] items-center justify-center rounded-[6px] bg-soft">
        {bezier ? <Curve bezier={bezier} /> : <span className="text-[12.5px] text-muted">No curve to draw</span>}
      </span>
      <span className="relative mx-1 h-2 rounded-full bg-soft2">
        <span
          className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-ink"
          style={{ left: on ? 'calc(100% - 14px)' : '0px', transition: `left ${duration}ms ${value || 'ease'}` }}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-1">
        <Mono size={12.5} className="truncate text-ink">
          {token.name}
        </Mono>
        <Hints items={utilityHints(token)} />
        <Value>{value}</Value>
        {token.description ? <span className="text-[12.5px] text-ink2">{token.description}</span> : null}
      </span>
    </button>
  )
}

export function MotionPage({ system }: { system: SystemDoc }) {
  const eases = byKind(system.tokens, 'ease')
  const durations = byKind(system.tokens, 'duration')
  const animations = byKind(system.tokens, 'animation')
  const cols = 'minmax(170px,1fr) 100px minmax(0,2fr)'
  const animCols = 'minmax(170px,1fr) minmax(140px,0.7fr) minmax(0,2fr)'
  return (
    <>
      <PageHead title="Motion" sub="Hover an easing to see it move." />
      {!eases.length && !durations.length && !animations.length ? (
        <EmptyPanel title="No motion tokens">
          Add <Mono>--ease-*</Mono> and <Mono>--animate-*</Mono> to the <Mono>@theme</Mono> block, and durations as{' '}
          <Mono>--duration-*</Mono>, in <Mono>{TOKENS_FILE}</Mono>.
        </EmptyPanel>
      ) : null}
      {eases.length ? (
        <Panel>
          <PanelHead title="Easing" count={eases.length} />
          <div
            className="grid gap-2 border-t border-rule p-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
          >
            {eases.map((token) => (
              <EaseCard key={token.name} token={token} duration={900} />
            ))}
          </div>
        </Panel>
      ) : null}
      {durations.length ? (
        <Panel>
          <PanelHead title="Durations" count={durations.length} />
          <THead cols={cols} labels={['Token', 'Value', '']} />
          {durations.map((token) => {
            const ms = token.light ? toMs(token.light.value) : null
            return (
              <Row key={token.name} cols={cols} minH={40} onClick={() => copyText(`var(${token.name})`)}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Mono size={12.5} className="truncate text-ink">
                    {token.name}
                  </Mono>
                  {token.description ? (
                    <span className="truncate text-[12.5px] text-muted">{token.description}</span>
                  ) : null}
                </span>
                <Mono size={12} className="text-muted">
                  {token.light?.value}
                </Mono>
                {ms !== null ? (
                  <span
                    className="h-3 rounded-[3px] bg-action/70"
                    style={{ width: Math.max(2, Math.min(ms / 2, 480)) }}
                  />
                ) : (
                  <span />
                )}
              </Row>
            )
          })}
        </Panel>
      ) : null}
      {animations.length ? (
        <Panel>
          <PanelHead title="Animations" count={animations.length} sub="keyframes live in the system stylesheet" />
          <THead cols={animCols} labels={['Token', 'Class', 'Value']} />
          {animations.map((token) => (
            <Row key={token.name} cols={animCols} minH={40} onClick={() => copyText(`var(${token.name})`)}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <Mono size={12.5} className="truncate text-ink">
                  {token.name}
                </Mono>
                {token.description ? (
                  <span className="truncate text-[12.5px] text-muted">{token.description}</span>
                ) : null}
              </span>
              <Hints items={utilityHints(token)} />
              <Value>{token.light?.value}</Value>
            </Row>
          ))}
        </Panel>
      ) : null}
    </>
  )
}
