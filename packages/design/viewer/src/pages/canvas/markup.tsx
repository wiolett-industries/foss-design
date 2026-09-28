import { markupKey } from '@shared/drawings'
import type { CanvasItem } from '@shared/types'
import { motion } from 'motion/react'
import { memo, useMemo } from 'react'
import type { DrawingClient } from '../../lib/drawings'
import { useStore } from '../../lib/store'
import { Button } from '../../ui/button'
import { Kbd } from '../../ui/text'
import { Tooltip } from '../../ui/tooltip'
import { BottomDock } from './canvas-bar'
import { type DrawingEditor, DrawingSurface, DrawingToolbar, type ToolSizes, useSpaceHeld } from './drawing/editor'
import type { Layout, Placed } from './layout'
import type { ViewStore } from './view-state'

export const MARKUP_SIZES: ToolSizes = { pen: 4, line: 3, text: 20 }

/** About what the markup bar takes with every ink shown and a short screen name. */
const FULL_BAR = 600

/**
 * Markup over the screens that have some, in canvas space, so it moves and scales with them; the
 * screen being marked up takes the pointer. Everyone with the canvas open sees it as it is drawn.
 */
export function MarkupLayers({
  layout,
  client,
  store,
  editor,
}: {
  layout: Layout
  client: DrawingClient
  store: ViewStore
  editor: DrawingEditor | null
}) {
  const marking = useStore(store, (state) => state.markup)
  // Keys with strokes on them or on their way, as one string so this re-renders only when that changes.
  const drawn = useStore(client.store, (state) =>
    [
      ...new Set([
        ...Object.keys(state.drawings).filter((key) => state.drawings[key]!.strokes.length),
        ...Object.keys(state.ghosts),
      ]),
    ]
      .sort()
      .join('\n'),
  )
  const keys = useMemo(() => new Set(drawn.split('\n')), [drawn])
  const space = useSpaceHeld()
  return (
    <>
      {layout.items
        .filter(
          (placed) =>
            placed.item.kind === 'screen' && (placed.item.id === marking || keys.has(markupKey(placed.item.id))),
        )
        .map((placed) => (
          <MarkupLayer
            key={placed.item.id}
            placed={placed}
            client={client}
            editor={placed.item.id === marking ? editor : null}
            space={space}
          />
        ))}
    </>
  )
}

const MarkupLayer = memo(function MarkupLayer({
  placed,
  client,
  editor,
  space,
}: {
  placed: Placed
  client: DrawingClient
  editor: DrawingEditor | null
  space: React.RefObject<boolean>
}) {
  const { item, x, y, w, h } = placed
  return (
    <div
      className="absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        pointerEvents: editor ? 'auto' : 'none',
      }}
    >
      <DrawingSurface
        client={client}
        drawingKey={markupKey(item.id)}
        width={w}
        height={h}
        editor={editor}
        sizes={MARKUP_SIZES}
        className="h-full w-full overflow-visible"
        onPointerDownCapture={(e) => e.button === 1 || space.current === true}
      />
    </div>
  )
})

/**
 * In place of the selection bar while a screen is marked up: its tools and the way out. `room` is the
 * width the dock leaves it; short of it, the inks fold into one button.
 */
export function MarkupBar({
  item,
  editor,
  onDone,
  room,
}: {
  item: CanvasItem
  editor: DrawingEditor
  onDone(): void
  room: number
}) {
  return (
    <BottomDock>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', duration: 0.26, bounce: 0.12 }}
        className="pointer-events-auto flex h-[46px] max-w-full min-w-0 items-center gap-1 rounded-[10px] border border-rule bg-surface pr-1.5 pl-3.5 shadow-pop"
      >
        <span className="min-w-0 truncate pr-2 text-[13.5px]">
          <span className="text-muted">Marking up</span> <span className="font-medium">{item.title || item.id}</span>
        </span>
        <DrawingToolbar
          editor={editor}
          compact={room < FULL_BAR}
          end={
            <>
              <div className="mx-1 h-5 w-px bg-rule" />
              <Tooltip
                content={
                  <span className="flex items-center gap-1.5">
                    Done <Kbd>Esc</Kbd>
                  </span>
                }
              >
                <Button kind="secondary" onClick={onDone}>
                  Done
                </Button>
              </Tooltip>
            </>
          }
        />
      </motion.div>
    </BottomDock>
  )
}
