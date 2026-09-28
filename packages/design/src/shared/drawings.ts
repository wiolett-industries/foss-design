/**
 * Drawings: an idea board for each canvas page and markup over each screen. They are not screens:
 * people draw them in the viewer, agents read them, and in the cloud every member sees the same
 * ones as they are drawn. A drawing is a set of strokes plus the ids of erased ones, so two copies
 * merge by union whatever order their changes arrive in.
 */

/** `board:<page id>` or `markup:<item id>`. */
export type DrawingKey = string

export const INKS = ['ink', 'red', 'blue', 'green'] as const
export type Ink = (typeof INKS)[number]

export const STROKE_KINDS = ['pen', 'arrow', 'rect', 'text'] as const
export type StrokeKind = (typeof STROKE_KINDS)[number]

export interface Stroke {
  id: string
  kind: StrokeKind
  ink: Ink
  /** Line width in drawing pixels; the font size for text. */
  size: number
  /** pen: x, y, pressure triples; arrow and rect: x1, y1, x2, y2; text: x, y of its top left. */
  points: number[]
  text?: string
}

export interface Drawing {
  strokes: Stroke[]
  /** Erased strokes stay erased, even when a copy that still has them merges in later. */
  erased: string[]
}

export interface DrawingOps {
  add?: Stroke[]
  erase?: string[]
}

export const MAX_STROKES = 4000
const MAX_ERASED = 20000
const MAX_NUMBERS = 12000
const MAX_TEXT = 2000
const MAX_COORD = 100000
/** Longest message either side takes. */
export const MAX_MESSAGE = 256 * 1024

const KEY = /^(board|markup):[a-z0-9][a-z0-9_-]{0,127}$/i
const STROKE_ID = /^[a-z0-9_-]{1,40}$/i

export const boardKey = (page: string): DrawingKey => `board:${page}`
export const markupKey = (item: string): DrawingKey => `markup:${item}`
export const isDrawingKey = (value: unknown): value is DrawingKey => typeof value === 'string' && KEY.test(value)

export const emptyDrawing = (): Drawing => ({ strokes: [], erased: [] })

/** A random stroke id. */
export function strokeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('')
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

export function parseStroke(value: unknown): Stroke | null {
  const data = record(value)
  if (!data) return null
  const { id, kind, ink, size, points, text } = data
  if (typeof id !== 'string' || !STROKE_ID.test(id)) return null
  if (!STROKE_KINDS.includes(kind as StrokeKind) || !INKS.includes(ink as Ink)) return null
  if (typeof size !== 'number' || !(size >= 0.5 && size <= 400)) return null
  if (!Array.isArray(points) || points.length > MAX_NUMBERS) return null
  if (!points.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD)) return null
  const need =
    kind === 'pen' ? points.length >= 3 && points.length % 3 === 0 : points.length === (kind === 'text' ? 2 : 4)
  if (!need) return null
  if (kind === 'text' && (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT)) return null
  const stroke: Stroke = { id, kind: kind as StrokeKind, ink: ink as Ink, size, points: points as number[] }
  if (kind === 'text') stroke.text = text as string
  return stroke
}

function parseIds(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null
  return value.every((id) => typeof id === 'string' && STROKE_ID.test(id)) ? (value as string[]) : null
}

export function parseOps(value: unknown): DrawingOps | null {
  const data = record(value)
  if (!data) return null
  const ops: DrawingOps = {}
  if (data.add !== undefined) {
    if (!Array.isArray(data.add) || data.add.length > MAX_STROKES) return null
    const add = data.add.map(parseStroke)
    if (add.some((stroke) => !stroke)) return null
    ops.add = add as Stroke[]
  }
  if (data.erase !== undefined) {
    const erase = parseIds(data.erase, MAX_ERASED)
    if (!erase) return null
    ops.erase = erase
  }
  return ops
}

export function parseDrawing(value: unknown): Drawing | null {
  const data = record(value)
  if (!data) return null
  const erased = parseIds(data.erased ?? [], MAX_ERASED)
  if (!erased || !Array.isArray(data.strokes) || data.strokes.length > MAX_STROKES) return null
  const strokes = data.strokes.map(parseStroke)
  if (strokes.some((stroke) => !stroke)) return null
  return { strokes: strokes as Stroke[], erased }
}

/** `{ [key]: Drawing }`, dropping what does not parse. */
export function parseDrawings(value: unknown): Record<DrawingKey, Drawing> {
  const out: Record<DrawingKey, Drawing> = {}
  for (const [key, drawing] of Object.entries(record(value) ?? {})) {
    const parsed = isDrawingKey(key) ? parseDrawing(drawing) : null
    if (parsed) out[key] = parsed
  }
  return out
}

/** `drawing` with `ops` applied, or null when they change nothing. Strokes past MAX_STROKES are not added. */
export function applyOps(drawing: Drawing, ops: DrawingOps): Drawing | null {
  const erased = new Set(drawing.erased)
  let changed = false
  const newlyErased: string[] = []
  for (const id of ops.erase ?? []) {
    if (erased.has(id)) continue
    erased.add(id)
    newlyErased.push(id)
    changed = true
  }
  const strokes = newlyErased.length ? drawing.strokes.filter((stroke) => !erased.has(stroke.id)) : [...drawing.strokes]
  const ids = new Set(strokes.map((stroke) => stroke.id))
  for (const stroke of ops.add ?? []) {
    if (erased.has(stroke.id) || ids.has(stroke.id) || strokes.length >= MAX_STROKES) continue
    strokes.push(stroke)
    ids.add(stroke.id)
    changed = true
  }
  if (!changed) return null
  // The oldest erased ids go first once there are too many; a copy that old is long merged.
  const erasedList = [...drawing.erased, ...newlyErased]
  return { strokes, erased: erasedList.length > MAX_ERASED ? erasedList.slice(-MAX_ERASED) : erasedList }
}

/** What `from` has that `to` lacks, as ops that bring `to` up to it. */
export function diffDrawings(from: Drawing, to: Drawing): DrawingOps | null {
  const toErased = new Set(to.erased)
  const toIds = new Set(to.strokes.map((stroke) => stroke.id))
  const add = from.strokes.filter((stroke) => !toIds.has(stroke.id) && !toErased.has(stroke.id))
  const erase = from.erased.filter((id) => !toErased.has(id))
  if (!add.length && !erase.length) return null
  return { ...(add.length ? { add } : {}), ...(erase.length ? { erase } : {}) }
}

export function isEmptyDrawing(drawing: Drawing | undefined): boolean {
  return !drawing || drawing.strokes.length === 0
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Text lines are this many font sizes apart. */
export const TEXT_LINE_HEIGHT = 1.25

/** The box a text stroke takes, roughly (no font metrics here): for erasing, cropping and its editor. */
export function textBox(stroke: Stroke): Box {
  const lines = (stroke.text ?? '').split('\n')
  const longest = Math.max(...lines.map((line) => line.length), 1)
  return {
    x: stroke.points[0]!,
    y: stroke.points[1]!,
    w: longest * stroke.size * 0.56,
    h: lines.length * stroke.size * TEXT_LINE_HEIGHT,
  }
}

/** The box a stroke takes, its line width, arrowhead and text included. */
export function strokeBounds(stroke: Stroke): Box {
  if (stroke.kind === 'text') return textBox(stroke)
  const step = stroke.kind === 'pen' ? 3 : 2
  const pad = stroke.kind === 'arrow' ? Math.max(10, stroke.size * 4.5) : stroke.size
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i + 1 < stroke.points.length; i += step) {
    minX = Math.min(minX, stroke.points[i]!)
    minY = Math.min(minY, stroke.points[i + 1]!)
    maxX = Math.max(maxX, stroke.points[i]!)
    maxY = Math.max(maxY, stroke.points[i + 1]!)
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** The box all the strokes take; null for none. */
export function drawingBounds(strokes: Stroke[]): Box | null {
  return strokes.length ? strokes.map(strokeBounds).reduce(union) : null
}

/** Strokes closer than this belong to one idea on a board. */
export const GROUP_GAP = 240

/**
 * A board's strokes in groups: what is drawn close together (less than GROUP_GAP apart) is one
 * group, empty space between sketches parts them. In reading order: rows top to bottom, then left
 * to right. A picture of a board is one per group, so far-apart ideas do not shrink into specks.
 */
export function drawingGroups(strokes: Stroke[]): { box: Box; strokes: Stroke[] }[] {
  let groups = strokes.map((stroke) => ({ box: strokeBounds(stroke), strokes: [stroke] }))
  const near = (a: Box, b: Box) =>
    a.x - GROUP_GAP < b.x + b.w &&
    b.x - GROUP_GAP < a.x + a.w &&
    a.y - GROUP_GAP < b.y + b.h &&
    b.y - GROUP_GAP < a.y + a.h
  // Merge until no two groups are near: a merged box can reach groups neither part reached.
  for (let merged = true; merged; ) {
    merged = false
    const next: typeof groups = []
    for (const group of groups) {
      const into = next.find((other) => near(other.box, group.box))
      if (into) {
        into.box = union(into.box, group.box)
        into.strokes.push(...group.strokes)
        merged = true
      } else next.push({ box: group.box, strokes: [...group.strokes] })
    }
    groups = next
  }
  // A group's strokes keep the drawing's order, so they paint as they do on the board.
  const order = new Map(strokes.map((stroke, i) => [stroke.id, i]))
  for (const group of groups) group.strokes.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  // Rows: a group starts a new row when it begins below the middle of the row's first group.
  groups.sort((a, b) => a.box.y - b.box.y)
  const rows: (typeof groups)[] = []
  for (const group of groups) {
    const row = rows.at(-1)
    if (row && group.box.y < row[0]!.box.y + row[0]!.box.h / 2) row.push(group)
    else rows.push([group])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box.x - b.box.x))
}

/**
 * A stroke on its way, sent every few frames while it is drawn and not kept: `points` continue the
 * stroke's points from index `at` (0 starts it over, as a shape does on every move).
 */
export interface LiveStroke {
  id: string
  kind: StrokeKind
  ink: Ink
  size: number
  text?: string
  at: number
  points: number[]
}

/** Messages to the server over the drawings socket of one canvas. */
export type ClientMessage =
  | { type: 'ops'; id: number; key: DrawingKey; add?: Stroke[]; erase?: string[] }
  | { type: 'live'; key: DrawingKey; stroke: LiveStroke }
  | { type: 'live-end'; key: DrawingKey; id: string }

/** Messages from the server. */
export type ServerMessage =
  /** First thing on a connection: every drawing of the canvas, and whether this peer may draw. */
  | { type: 'hello'; peer: string; canDraw: boolean; drawings: Record<DrawingKey, Drawing> }
  /** Someone's change, this peer's own included. */
  | { type: 'ops'; key: DrawingKey; add?: Stroke[]; erase?: string[]; peer: string }
  /** The server kept the ops the client numbered `id`. */
  | { type: 'ack'; id: number }
  /** The whole drawing, where a change came some other way than ops (a file edited here, another server). */
  | { type: 'doc'; key: DrawingKey; drawing: Drawing }
  | { type: 'live'; key: DrawingKey; stroke: LiveStroke; peer: string; name?: string }
  | { type: 'live-end'; key: DrawingKey; id: string; peer: string }
  /** A peer left: its strokes on the way go with it. */
  | { type: 'gone'; peer: string }
  | { type: 'error'; message: string }

function parseLive(value: unknown): LiveStroke | null {
  const data = record(value)
  if (!data) return null
  const { id, kind, ink, size, text, at, points } = data
  if (typeof id !== 'string' || !STROKE_ID.test(id)) return null
  if (!STROKE_KINDS.includes(kind as StrokeKind) || !INKS.includes(ink as Ink)) return null
  if (typeof size !== 'number' || !(size >= 0.5 && size <= 400)) return null
  if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at > MAX_NUMBERS) return null
  if (!Array.isArray(points) || points.length > MAX_NUMBERS) return null
  if (!points.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD)) return null
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT)) return null
  const stroke: LiveStroke = { id, kind: kind as StrokeKind, ink: ink as Ink, size, at, points: points as number[] }
  if (typeof text === 'string') stroke.text = text
  return stroke
}

function parseJson(raw: string): Record<string, unknown> | null {
  if (raw.length > MAX_MESSAGE) return null
  try {
    return record(JSON.parse(raw))
  } catch {
    return null
  }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  const data = parseJson(raw)
  if (!data || !isDrawingKey(data.key)) return null
  const key = data.key
  if (data.type === 'ops') {
    if (typeof data.id !== 'number' || !Number.isInteger(data.id)) return null
    const ops = parseOps(data)
    return ops ? { type: 'ops', id: data.id, key, ...ops } : null
  }
  if (data.type === 'live') {
    const stroke = parseLive(data.stroke)
    return stroke ? { type: 'live', key, stroke } : null
  }
  if (data.type === 'live-end')
    return typeof data.id === 'string' && STROKE_ID.test(data.id) ? { type: 'live-end', key, id: data.id } : null
  return null
}

export function parseServerMessage(raw: string): ServerMessage | null {
  const data = parseJson(raw)
  if (!data) return null
  const peer = typeof data.peer === 'string' ? data.peer : ''
  switch (data.type) {
    case 'hello':
      return { type: 'hello', peer, canDraw: data.canDraw === true, drawings: parseDrawings(data.drawings) }
    case 'ops': {
      const ops = isDrawingKey(data.key) ? parseOps(data) : null
      return ops ? { type: 'ops', key: data.key as DrawingKey, ...ops, peer } : null
    }
    case 'ack':
      return typeof data.id === 'number' ? { type: 'ack', id: data.id } : null
    case 'doc': {
      const drawing = isDrawingKey(data.key) ? parseDrawing(data.drawing) : null
      return drawing ? { type: 'doc', key: data.key as DrawingKey, drawing } : null
    }
    case 'live': {
      const stroke = isDrawingKey(data.key) ? parseLive(data.stroke) : null
      if (!stroke) return null
      const name = typeof data.name === 'string' ? data.name.slice(0, 80) : undefined
      return { type: 'live', key: data.key as DrawingKey, stroke, peer, ...(name ? { name } : {}) }
    }
    case 'live-end':
      return isDrawingKey(data.key) && typeof data.id === 'string'
        ? { type: 'live-end', key: data.key, id: data.id, peer }
        : null
    case 'gone':
      return { type: 'gone', peer }
    case 'error':
      return { type: 'error', message: typeof data.message === 'string' ? data.message.slice(0, 500) : 'error' }
  }
  return null
}
