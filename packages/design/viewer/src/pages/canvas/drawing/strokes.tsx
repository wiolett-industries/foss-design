import { type Drawing, type Ink, type Stroke, TEXT_LINE_HEIGHT, textBox } from '@shared/drawings'
import { getStroke } from 'perfect-freehand'
import { memo } from 'react'
import type { Ghost } from '../../../lib/drawings'

export const INK_COLOR: Record<Ink, string> = {
  ink: 'var(--draw-ink)',
  red: 'var(--draw-red)',
  blue: 'var(--draw-blue)',
  green: 'var(--draw-green)',
}

const round = (n: number) => Math.round(n * 100) / 100

/** A pen stroke's outline, pressure and all: mouse strokes (all at 0.5) get pressure from their speed. */
function penPath(stroke: Stroke, done: boolean): string {
  const points: [number, number, number][] = []
  for (let i = 0; i + 2 < stroke.points.length; i += 3)
    points.push([stroke.points[i]!, stroke.points[i + 1]!, stroke.points[i + 2]!])
  const outline = getStroke(points, {
    size: stroke.size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: points.every((point) => point[2] === 0.5),
    last: done,
  })
  if (!outline.length) return ''
  const d: (string | number)[] = ['M', round(outline[0]![0]!), round(outline[0]![1]!), 'Q']
  outline.forEach(([x0, y0], i) => {
    const [x1, y1] = outline[(i + 1) % outline.length]!
    d.push(round(x0!), round(y0!), round((x0! + x1!) / 2), round((y0! + y1!) / 2))
  })
  d.push('Z')
  return d.join(' ')
}

function arrowPath([x1, y1, x2, y2]: number[], size: number): string {
  const angle = Math.atan2(y2! - y1!, x2! - x1!)
  const head = Math.max(10, size * 4.5)
  const wing = (turn: number) =>
    `${round(x2! - head * Math.cos(angle + turn))} ${round(y2! - head * Math.sin(angle + turn))}`
  return `M ${round(x1!)} ${round(y1!)} L ${round(x2!)} ${round(y2!)} M ${wing(0.45)} L ${round(x2!)} ${round(y2!)} L ${wing(-0.45)}`
}

export const StrokeView = memo(function StrokeView({ stroke, done = true }: { stroke: Stroke; done?: boolean }) {
  const color = INK_COLOR[stroke.ink]
  const [a = 0, b = 0, c = 0, d = 0] = stroke.points
  switch (stroke.kind) {
    case 'pen':
      return <path d={penPath(stroke, done)} fill={color} />
    case 'arrow':
      return (
        <path
          d={arrowPath(stroke.points, stroke.size)}
          fill="none"
          stroke={color}
          strokeWidth={stroke.size}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    case 'rect':
      return (
        <rect
          x={Math.min(a, c)}
          y={Math.min(b, d)}
          width={Math.abs(c - a)}
          height={Math.abs(d - b)}
          rx={Math.min(stroke.size * 1.5, Math.abs(c - a) / 2, Math.abs(d - b) / 2)}
          fill="none"
          stroke={color}
          strokeWidth={stroke.size}
          strokeLinejoin="round"
        />
      )
    case 'text':
      return (
        <text
          x={a}
          y={b}
          fill={color}
          fontSize={stroke.size}
          fontFamily="var(--font-sans)"
          fontWeight={500}
          dominantBaseline="text-before-edge"
          style={{ whiteSpace: 'pre' }}
        >
          {(stroke.text ?? '').split('\n').map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one text have no other identity
            <tspan key={i} x={a} dy={i ? `${TEXT_LINE_HEIGHT}em` : 0}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )
  }
})

/** The strokes of a drawing, then those on their way (someone else's, and this user's own). */
export function StrokeList({
  drawing,
  ghosts,
  draft,
}: {
  drawing: Drawing | undefined
  ghosts?: Ghost[]
  draft?: Stroke | null
}) {
  return (
    <>
      {drawing?.strokes.map((stroke) => (
        <StrokeView key={stroke.id} stroke={stroke} />
      ))}
      {ghosts?.map((ghost) => (
        <g key={`${ghost.peer}:${ghost.stroke.id}`} opacity={0.8}>
          <StrokeView stroke={ghost.stroke} done={false} />
        </g>
      ))}
      {draft ? <StrokeView stroke={draft} done={false} /> : null}
    </>
  )
}

/** How far `(x, y)` is from the stroke's line, in drawing pixels (0 inside a text). */
export function distanceTo(stroke: Stroke, x: number, y: number): number {
  const p = stroke.points
  const segment = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const length = dx * dx + dy * dy
    const t = length ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length)) : 0
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
  }
  if (stroke.kind === 'text') {
    const box = textBox(stroke)
    const dx = Math.max(box.x - x, 0, x - (box.x + box.w))
    const dy = Math.max(box.y - y, 0, y - (box.y + box.h))
    return Math.hypot(dx, dy)
  }
  if (stroke.kind === 'pen') {
    let best = Number.POSITIVE_INFINITY
    if (p.length === 3) return Math.hypot(x - p[0]!, y - p[1]!)
    for (let i = 0; i + 5 < p.length; i += 3) best = Math.min(best, segment(p[i]!, p[i + 1]!, p[i + 3]!, p[i + 4]!))
    return best
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p
  if (stroke.kind === 'arrow') return segment(x1, y1, x2, y2)
  return Math.min(segment(x1, y1, x2, y1), segment(x2, y1, x2, y2), segment(x2, y2, x1, y2), segment(x1, y2, x1, y1))
}
