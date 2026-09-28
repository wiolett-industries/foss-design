import { type DrawingKey, INKS, type Ink, type Stroke, strokeId, textBox } from '@shared/drawings'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { cn } from '../../../lib/cn'
import { type DrawingClient, useDrawing } from '../../../lib/drawings'
import { IconButton } from '../../../ui/button'
import { Icon, type IconName } from '../../../ui/icon'
import { Menu, MenuItem } from '../../../ui/menu'
import { Kbd } from '../../../ui/text'
import { Tooltip } from '../../../ui/tooltip'
import type { CameraStore } from '../camera'
import { isTyping } from '../viewport'
import { distanceTo, INK_COLOR, StrokeList } from './strokes'

export type Tool = 'pen' | 'arrow' | 'rect' | 'text' | 'eraser'

/** Line widths and text size, in the drawing's own pixels. */
export interface ToolSizes {
  pen: number
  line: number
  text: number
}

type Action = { kind: 'add' | 'erase'; strokes: Stroke[] }

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'pen', icon: 'edit', label: 'Pen', key: 'P' },
  { tool: 'arrow', icon: 'arrow-up-right', label: 'Arrow', key: 'A' },
  { tool: 'rect', icon: 'square', label: 'Rectangle', key: 'R' },
  { tool: 'text', icon: 'type', label: 'Text', key: 'T' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
]

const INK_NAMES: Record<Ink, string> = { ink: 'Ink', red: 'Red', blue: 'Blue', green: 'Green' }

const fresh = (strokes: Stroke[]) => strokes.map((stroke) => ({ ...stroke, id: strokeId() }))
const tidy = (n: number) => Math.round(n * 10) / 10

/**
 * One drawing's tools and this user's history on it; null while there is no drawing to edit.
 * Undoing brings strokes back as new ones: an erased id stays erased everywhere.
 */
export function useDrawingEditor(client: DrawingClient | null, key: DrawingKey | null, defaultInk: Ink = 'ink') {
  const [tool, setTool] = useState<Tool>('pen')
  const [ink, setInk] = useState<Ink>(defaultInk)
  const history = useRef<{ undo: Action[]; redo: Action[] }>({ undo: [], redo: [] })
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  // Another drawing, another history.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is what resets it
  useEffect(() => {
    history.current = { undo: [], redo: [] }
    rerender()
  }, [key])

  if (!client || !key) return null
  const record = (action: Action) => {
    if (!action.strokes.length) return
    history.current.undo.push(action)
    history.current.redo = []
    rerender()
  }
  /** Erase without a history entry: the eraser records its whole gesture as one. */
  const eraseNow = (strokes: Stroke[]) => client.apply(key, { erase: strokes.map((s) => s.id) })
  const step = (from: 'undo' | 'redo') => {
    const stacks = history.current
    const action = stacks[from].pop()
    if (!action) return
    const to = from === 'undo' ? stacks.redo : stacks.undo
    // Undo an add, or redo an erase: those strokes go. Otherwise they come back, as new strokes.
    if ((action.kind === 'add') === (from === 'undo')) {
      eraseNow(action.strokes)
      to.push(action)
    } else {
      const strokes = fresh(action.strokes)
      client.apply(key, { add: strokes })
      to.push({ kind: action.kind, strokes })
    }
    rerender()
  }
  return {
    client,
    drawingKey: key,
    tool,
    setTool,
    ink,
    setInk,
    record,
    eraseNow,
    add(strokes: Stroke[]) {
      client.apply(key, { add: strokes })
      record({ kind: 'add', strokes })
    },
    clear() {
      const strokes = client.store.get().drawings[key]?.strokes ?? []
      eraseNow(strokes)
      record({ kind: 'erase', strokes })
    },
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: history.current.undo.length > 0,
    canRedo: history.current.redo.length > 0,
  }
}

export type DrawingEditor = NonNullable<ReturnType<typeof useDrawingEditor>>

/** Space held: a press on a drawing pans instead of drawing, as it does on the canvas. */
export function useSpaceHeld() {
  const held = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') held.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') held.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  return held
}

/** Tool keys, 1–4 for inks, ⌘Z and ⇧⌘Z while `active`; typing in a field is left alone. */
export function useEditorKeys(editor: DrawingEditor | null, active: boolean) {
  const ref = useRef(editor)
  ref.current = editor
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const editor = ref.current
      if (!editor || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) editor.redo()
        else editor.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        editor.redo()
      } else if (!mod && !e.altKey) {
        const found = TOOLS.find((item) => item.key.toLowerCase() === key)
        if (found) editor.setTool(found.tool)
        else if (/^[1-4]$/.test(e.key)) editor.setInk(INKS[Number(e.key) - 1]!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

/**
 * Tools, inks, undo and redo, clearing, and whatever the place adds at the end (a way out). Short
 * of room (`compact`), the inks fold into one button that picks among them.
 */
export function DrawingToolbar({
  editor,
  end,
  compact = false,
}: {
  editor: DrawingEditor
  end?: ReactNode
  compact?: boolean
}) {
  return (
    <div data-ui className="flex items-center gap-0.5">
      {TOOLS.map((item) => (
        <Tooltip
          key={item.tool}
          content={
            <span className="flex items-center gap-1.5">
              {item.label} <Kbd>{item.key}</Kbd>
            </span>
          }
        >
          <button
            type="button"
            aria-label={item.label}
            aria-pressed={editor.tool === item.tool}
            onClick={() => editor.setTool(item.tool)}
            className={cn(
              'inline-flex h-ctrl w-ctrl shrink-0 cursor-pointer items-center justify-center rounded-[6px] border p-0 transition-[color,background-color,scale] duration-100 active:scale-[0.94]',
              editor.tool === item.tool
                ? 'border-action-line bg-action-soft text-action'
                : 'border-transparent bg-transparent text-muted hover:bg-soft2 hover:text-ink2',
            )}
          >
            <Icon name={item.icon} size={16} />
          </button>
        </Tooltip>
      ))}
      <div className="mx-1 h-5 w-px bg-rule" />
      {compact ? (
        <Menu
          side="top"
          align="center"
          width={170}
          trigger={
            <button
              type="button"
              aria-label={`Ink: ${INK_NAMES[editor.ink]}`}
              className="inline-flex h-ctrl w-ctrl shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 hover:bg-soft2"
            >
              <span className="size-[14px] rounded-full" style={{ background: INK_COLOR[editor.ink] }} />
            </button>
          }
        >
          {INKS.map((ink, i) => (
            <MenuItem key={ink} active={editor.ink === ink} onSelect={() => editor.setInk(ink)} hint={i + 1}>
              <span className="size-[12px] rounded-full" style={{ background: INK_COLOR[ink] }} />
              {INK_NAMES[ink]}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
      {compact
        ? null
        : INKS.map((ink, i) => (
            <Tooltip
              key={ink}
              content={
                <span className="flex items-center gap-1.5">
                  {INK_NAMES[ink]} <Kbd>{i + 1}</Kbd>
                </span>
              }
            >
              <button
                type="button"
                aria-label={INK_NAMES[ink]}
                aria-pressed={editor.ink === ink}
                onClick={() => editor.setInk(ink)}
                className={cn(
                  'inline-flex h-ctrl w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 hover:bg-soft2',
                )}
              >
                <span
                  className={cn(
                    'size-[14px] rounded-full',
                    editor.ink === ink && 'ring-2 ring-action ring-offset-2 ring-offset-surface',
                  )}
                  style={{ background: INK_COLOR[ink] }}
                />
              </button>
            </Tooltip>
          ))}
      <div className="mx-1 h-5 w-px bg-rule" />
      <Tooltip
        content={
          <span className="flex items-center gap-1.5">
            Undo <Kbd>⌘Z</Kbd>
          </span>
        }
      >
        <IconButton icon="undo" label="Undo" disabled={!editor.canUndo} onClick={editor.undo} />
      </Tooltip>
      <Tooltip
        content={
          <span className="flex items-center gap-1.5">
            Redo <Kbd>⇧⌘Z</Kbd>
          </span>
        }
      >
        <IconButton icon="redo" label="Redo" disabled={!editor.canRedo} onClick={editor.redo} />
      </Tooltip>
      <Tooltip content="Erase everything">
        <IconButton icon="trash" label="Erase everything" onClick={editor.clear} />
      </Tooltip>
      {end}
    </div>
  )
}

interface TextDraft {
  x: number
  y: number
  value: string
}

/**
 * A drawing as SVG in its own coordinates (`width` × `height`), fitted to its box. With an editor
 * it takes the pointer and draws with the editor's tool; strokes on their way go out live.
 */
export function DrawingSurface({
  client,
  drawingKey,
  width,
  height,
  editor,
  sizes,
  className,
  camera,
  onPointerDownCapture,
}: {
  client: DrawingClient
  drawingKey: DrawingKey
  /** The drawing's size, when it has one (a screen's markup); a board has a camera instead. */
  width?: number
  height?: number
  editor?: DrawingEditor | null
  sizes: ToolSizes
  className?: string
  /** An endless drawing (a board): what shows is where this camera looks. */
  camera?: CameraStore
  /** Before the surface acts on a press: return true to leave it to what is under the surface (a pan). */
  onPointerDownCapture?: (e: React.PointerEvent) => boolean
}) {
  const { drawing, ghosts } = useDrawing(client, drawingKey)
  // A camera moves the view without a render: the viewBox follows it, and the element's size.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!camera || !svg) return
    const apply = () => {
      const { x, y, z } = camera.camera
      svg.setAttribute('viewBox', `${-x / z} ${-y / z} ${(svg.clientWidth || 1) / z} ${(svg.clientHeight || 1) / z}`)
    }
    apply()
    const off = camera.subscribe(apply)
    const resize = new ResizeObserver(apply)
    resize.observe(svg)
    return () => {
      off()
      resize.disconnect()
    }
  }, [camera])
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Stroke | null>(null)
  const [text, setText] = useState<TextDraft | null>(null)
  const gesture = useRef<{
    stroke: Stroke | null
    sent: number
    lastSend: number
    frame: number
    erased: Stroke[]
    startX: number
    startY: number
    pointer: number
  } | null>(null)

  const toPoint = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y, scale: matrix.a || 1 }
  }

  const textRef = useRef<TextDraft | null>(null)
  textRef.current = text
  const editorRef = useRef(editor)
  editorRef.current = editor
  const commitText = useCallback(() => {
    const current = textRef.current
    const editor = editorRef.current
    textRef.current = null
    setText(null)
    if (!current || !editor || !current.value.trim()) return
    editor.add([
      {
        id: strokeId(),
        kind: 'text',
        ink: editor.ink,
        size: sizes.text,
        points: [tidy(current.x), tidy(current.y)],
        text: current.value.replace(/\s+$/, ''),
      },
    ])
  }, [sizes.text])

  // Leaving the editor (or switching tools) keeps what was typed.
  const tool = editor?.tool
  useEffect(() => {
    if (tool !== 'text') commitText()
  }, [tool, commitText])
  useEffect(() => commitText, [commitText])

  const sendLive = (force: boolean) => {
    const g = gesture.current
    if (!g?.stroke) return
    const now = performance.now()
    if (!force && now - g.lastSend < 40) return
    g.lastSend = now
    const at = g.stroke.kind === 'pen' ? g.sent : 0
    client.live(drawingKey, g.stroke, at)
    g.sent = g.stroke.points.length
  }

  const eraseAt = (x: number, y: number, scale: number) => {
    const g = gesture.current
    const strokes = client.store.get().drawings[drawingKey]?.strokes ?? []
    const reach = 8 / scale
    const hit = strokes.filter((stroke) => distanceTo(stroke, x, y) <= reach + stroke.size / 2)
    if (!hit.length || !editor) return
    editor.eraseNow(hit)
    g?.erased.push(...hit)
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!editor || e.button !== 0) return
    if (onPointerDownCapture?.(e)) return
    e.stopPropagation()
    e.preventDefault()
    const point = toPoint(e)
    if (!point) return
    if (text) {
      commitText()
      return
    }
    svgRef.current?.setPointerCapture(e.pointerId)
    const base = { id: strokeId(), ink: editor.ink }
    let stroke: Stroke | null = null
    if (editor.tool === 'pen') {
      const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
      stroke = { ...base, kind: 'pen', size: sizes.pen, points: [tidy(point.x), tidy(point.y), pressure] }
    } else if (editor.tool === 'arrow' || editor.tool === 'rect') {
      stroke = { ...base, kind: editor.tool, size: sizes.line, points: [point.x, point.y, point.x, point.y] }
    }
    gesture.current = {
      stroke,
      sent: 0,
      lastSend: 0,
      frame: 0,
      erased: [],
      startX: point.x,
      startY: point.y,
      pointer: e.pointerId,
    }
    if (editor.tool === 'eraser') eraseAt(point.x, point.y, point.scale)
    setDraft(stroke)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId || !editor) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const event of events.length ? events : [e.nativeEvent]) {
      const point = toPoint(event)
      if (!point) continue
      if (editor.tool === 'eraser') eraseAt(point.x, point.y, point.scale)
      else if (g.stroke?.kind === 'pen') {
        const pressure = event.pointerType === 'pen' ? event.pressure || 0.5 : 0.5
        g.stroke.points.push(tidy(point.x), tidy(point.y), pressure)
      } else if (g.stroke) {
        g.stroke.points = [g.stroke.points[0]!, g.stroke.points[1]!, point.x, point.y]
      }
    }
    if (g.stroke && !g.frame) {
      g.frame = requestAnimationFrame(() => {
        g.frame = 0
        if (g.stroke) setDraft({ ...g.stroke, points: [...g.stroke.points] })
      })
    }
    sendLive(false)
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId || !editor) return
    gesture.current = null
    cancelAnimationFrame(g.frame)
    setDraft(null)
    const point = toPoint(e)
    if (editor.tool === 'eraser') {
      editor.record({ kind: 'erase', strokes: g.erased })
      return
    }
    if (editor.tool === 'text') {
      if (point && Math.hypot(point.x - g.startX, point.y - g.startY) * point.scale < 6)
        setText({ x: g.startX, y: g.startY - sizes.text * 0.6, value: '' })
      return
    }
    const stroke = g.stroke
    if (!stroke) return
    if (g.sent) client.liveEnd(drawingKey, stroke.id)
    if (stroke.kind !== 'pen') {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = stroke.points
      if (Math.hypot(x2 - x1, y2 - y1) * (point?.scale ?? 1) < 4) return
      stroke.points = stroke.points.map(tidy)
    }
    editor.add([stroke])
  }

  const onPointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    gesture.current = null
    cancelAnimationFrame(g.frame)
    setDraft(null)
    if (g.stroke && g.sent) client.liveEnd(drawingKey, g.stroke.id)
    if (g.erased.length) editor?.record({ kind: 'erase', strokes: g.erased })
  }

  const cursor = !editor ? undefined : editor.tool === 'text' ? 'text' : editor.tool === 'eraser' ? 'cell' : 'crosshair'

  const box = useMemo(
    () =>
      text
        ? textBox({
            id: 'draft',
            kind: 'text',
            ink: 'ink',
            size: sizes.text,
            points: [text.x, text.y],
            text: text.value,
          })
        : null,
    [text, sizes.text],
  )

  return (
    <svg
      ref={svgRef}
      viewBox={camera ? undefined : `0 0 ${width ?? 0} ${height ?? 0}`}
      preserveAspectRatio={camera ? 'xMinYMin meet' : 'xMidYMid meet'}
      role="img"
      aria-label={editor ? 'Drawing: draw here' : 'Drawing'}
      className={cn('block touch-none select-none', className)}
      style={{ cursor, pointerEvents: editor ? 'auto' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <StrokeList drawing={drawing} ghosts={ghosts} draft={draft} />
      {text && box && editor ? (
        <foreignObject
          x={text.x}
          y={text.y}
          width={Math.max(box.w + sizes.text * 2, sizes.text * 8)}
          height={box.h + 8}
        >
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the text goes where the user just clicked
            autoFocus
            aria-label="Text"
            value={text.value}
            onChange={(e) => setText({ ...text, value: e.target.value })}
            onBlur={commitText}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
                e.preventDefault()
                commitText()
              }
            }}
            spellCheck={false}
            className="block h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
            style={{
              font: `500 ${sizes.text}px/1.25 var(--font-sans)`,
              color: INK_COLOR[editor.ink],
              caretColor: INK_COLOR[editor.ink],
              whiteSpace: 'pre',
            }}
          />
        </foreignObject>
      ) : null}
    </svg>
  )
}
