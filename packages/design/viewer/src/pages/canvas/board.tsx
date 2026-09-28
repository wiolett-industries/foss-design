import { boardKey, drawingBounds, isEmptyDrawing } from '@shared/drawings'
import type { CanvasPage } from '@shared/types'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { type DrawingClient, useDrawing } from '../../lib/drawings'
import { useStore } from '../../lib/store'
import { IconButton } from '../../ui/button'
import { Icon } from '../../ui/icon'
import { Kbd } from '../../ui/text'
import { Tooltip } from '../../ui/tooltip'
import { CameraStore, fitRect, gridMover, loadCamera } from './camera'
import {
  type DrawingEditor,
  DrawingSurface,
  DrawingToolbar,
  type ToolSizes,
  useDrawingEditor,
  useEditorKeys,
  useSpaceHeld,
} from './drawing/editor'
import { StrokeList } from './drawing/strokes'
import { isTyping } from './viewport'

export const BOARD_SIZES: ToolSizes = { pen: 5, line: 3.5, text: 28 }

/** Room around the drawing when the board fits it into view, and around it in the tile. */
const FIT_PAD = 56

const openKey = (canvas: string, page: string) => `foss-design.board.${canvas}.${page}`
const cameraKey = (canvas: string, page: string) => `foss-design.board-camera.${canvas}.${page}`

function loadOpen(key: string) {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/**
 * The page's idea board: a tile above the zoom controls with what is drawn on it, which opens over
 * the canvas. The board has no edges: it pans and zooms like the canvas, and a picture of it is
 * cropped to what is drawn. Whether it is open, and where it looks, is kept per page for the
 * session. Everyone with the canvas open sees it change as it is drawn on; those who may not draw
 * see it only once there is something on it.
 */
export function IdeaBoard({ client, canvasId, page }: { client: DrawingClient; canvasId: string; page: CanvasPage }) {
  const key = boardKey(page.id)
  const ready = useStore(client.store, (state) => state.ready)
  const canDraw = useStore(client.store, (state) => state.canDraw)
  const { drawing } = useDrawing(client, key)
  const storageKey = openKey(canvasId, page.id)
  const [open, setOpen] = useState(() => loadOpen(storageKey))
  useEffect(() => {
    try {
      if (open) sessionStorage.setItem(storageKey, '1')
      else sessionStorage.removeItem(storageKey)
    } catch {}
  }, [open, storageKey])

  if (!ready || (!canDraw && isEmptyDrawing(drawing))) return null
  const layoutId = `board:${canvasId}:${page.id}`
  return (
    <>
      <AnimatePresence initial={false}>
        {open ? (
          <BoardPanel
            key="panel"
            layoutId={layoutId}
            client={client}
            canvasId={canvasId}
            page={page}
            canDraw={canDraw}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </AnimatePresence>
      {open ? null : <BoardTile layoutId={layoutId} client={client} page={page} onOpen={() => setOpen(true)} />}
    </>
  )
}

function BoardTile({
  layoutId,
  client,
  page,
  onOpen,
}: {
  layoutId: string
  client: DrawingClient
  page: CanvasPage
  onOpen(): void
}) {
  const { drawing, ghosts } = useDrawing(client, boardKey(page.id))
  const bounds = useMemo(
    () => drawingBounds([...(drawing?.strokes ?? []), ...ghosts.map((ghost) => ghost.stroke)]),
    [drawing, ghosts],
  )
  return (
    <Tooltip content="Idea board" side="left">
      <motion.button
        type="button"
        data-ui
        layoutId={layoutId}
        aria-label="Open the idea board"
        onClick={onOpen}
        style={{ borderRadius: 10 }}
        transition={{ type: 'spring', duration: 0.34, bounce: 0.12 }}
        className="absolute right-4 bottom-[76px] z-20 flex size-[92px] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden border border-rule bg-surface p-0 text-muted shadow-pop hover:text-ink2"
      >
        {bounds ? (
          <svg
            viewBox={`${bounds.x - FIT_PAD} ${bounds.y - FIT_PAD} ${bounds.w + FIT_PAD * 2} ${bounds.h + FIT_PAD * 2}`}
            className="h-full w-full p-1.5"
            aria-hidden="true"
          >
            <StrokeList drawing={drawing} ghosts={ghosts} />
          </svg>
        ) : (
          <>
            <Icon name="lightbulb" size={20} />
            <span className="text-[11.5px] font-medium">Ideas</span>
          </>
        )}
      </motion.button>
    </Tooltip>
  )
}

function BoardPanel({
  layoutId,
  client,
  canvasId,
  page,
  canDraw,
  onClose,
}: {
  layoutId: string
  client: DrawingClient
  canvasId: string
  page: CanvasPage
  canDraw: boolean
  onClose(): void
}) {
  const key = boardKey(page.id)
  const editor = useDrawingEditor(canDraw ? client : null, key)
  const online = useStore(client.store, (state) => state.online)
  const camera = useMemo(() => new CameraStore(), [])
  const sheetRef = useRef<HTMLDivElement>(null)

  /** The whole drawing in view (at most at 100%), or the board's start near the top left when it is empty. */
  const fit = useCallback(
    (animate = true) => {
      const sheet = sheetRef.current
      if (!sheet) return
      const bounds = drawingBounds(client.store.get().drawings[key]?.strokes ?? [])
      const target = bounds
        ? fitRect(bounds, sheet.clientWidth, sheet.clientHeight, FIT_PAD, 1, camera.minZoom)
        : { x: FIT_PAD, y: FIT_PAD, z: 1 }
      if (animate) camera.animateTo(target)
      else camera.set(target)
    },
    [camera, client, key],
  )

  // Where it looked last in this session, else all of it.
  const storageKey = cameraKey(canvasId, page.id)
  useLayoutEffect(() => {
    const saved = loadCamera(storageKey)
    if (saved) camera.set(saved)
    else fit(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = camera.subscribe((c) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(c))
        } catch {}
      }, 250)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [camera, storageKey, fit])

  useEditorKeys(editor, true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.key === 'Escape') onClose()
      else if (e.shiftKey && e.code === 'Digit1') fit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, fit])

  return (
    <motion.div
      data-ui
      role="dialog"
      aria-label="Idea board"
      layoutId={layoutId}
      style={{ borderRadius: 12 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0.12 }}
      className="absolute inset-4 z-30 flex flex-col overflow-hidden border border-rule bg-surface shadow-pop"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.16 } }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        className="flex min-h-0 grow flex-col"
      >
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-rule pr-2 pl-4">
          <Icon name="lightbulb" size={16} className="text-muted" />
          <span className="text-[14px] font-semibold">Ideas</span>
          <span className="min-w-0 truncate text-[13px] text-muted">{page.title}</span>
          {online ? null : <span className="text-[12.5px] text-muted">· Reconnecting…</span>}
          <div className="ml-auto flex items-center gap-1">
            {editor ? (
              <DrawingToolbar editor={editor} />
            ) : (
              <span className="px-2 text-[12.5px] text-muted">View only</span>
            )}
            <div className="mx-1 h-5 w-px bg-rule" />
            <Tooltip
              content={
                <span className="flex items-center gap-1.5">
                  Show all <Kbd>⇧1</Kbd>
                </span>
              }
            >
              <IconButton icon="fit" label="Show all of the board" onClick={() => fit()} />
            </Tooltip>
            <Tooltip
              content={
                <span className="flex items-center gap-1.5">
                  Close <Kbd>Esc</Kbd>
                </span>
              }
            >
              <IconButton icon="minimize" label="Close the idea board" onClick={onClose} />
            </Tooltip>
          </div>
        </div>
        <BoardSheet sheetRef={sheetRef} client={client} drawingKey={key} editor={editor} camera={camera} />
      </motion.div>
    </motion.div>
  )
}

/**
 * The board's endless sheet: scroll pans, ⌘/Ctrl + scroll and a trackpad pinch zoom, and space,
 * the middle button or (for those who only look) any drag moves it.
 */
function BoardSheet({
  sheetRef,
  client,
  drawingKey,
  editor,
  camera,
}: {
  sheetRef: React.RefObject<HTMLDivElement | null>
  client: DrawingClient
  drawingKey: string
  editor: DrawingEditor | null
  camera: CameraStore
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const space = useSpaceHeld()
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)

  useLayoutEffect(() => {
    const move = gridMover(gridRef.current!)
    move(camera.camera)
    return camera.subscribe(move)
  }, [camera])

  useEffect(() => {
    const sheet = sheetRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = sheet.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1
      if (e.ctrlKey || e.metaKey) {
        const dy = e.deltaY * unit
        const speed = Math.abs(dy) < 40 ? 0.012 : 0.0025
        camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-dy * speed))
      } else camera.panBy(-e.deltaX * unit, -e.deltaY * unit)
    }
    sheet.addEventListener('wheel', onWheel, { passive: false })
    return () => sheet.removeEventListener('wheel', onWheel)
  }, [camera, sheetRef])

  const pans = (e: React.PointerEvent) => e.button === 1 || space.current === true || (!editor && e.button === 0)

  return (
    <div
      ref={sheetRef}
      className={cn('relative min-h-0 grow touch-none overflow-hidden bg-surface', panning && 'cursor-grabbing')}
      onPointerDown={(e) => {
        if (!pans(e)) return
        e.preventDefault()
        camera.interrupt()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        setPanning(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        camera.panBy(e.clientX - d.x, e.clientY - d.y)
        d.x = e.clientX
        d.y = e.clientY
      }}
      onPointerUp={(e) => {
        if (drag.current?.id !== e.pointerId) return
        drag.current = null
        setPanning(false)
      }}
      onPointerCancel={() => {
        drag.current = null
        setPanning(false)
      }}
    >
      <div ref={gridRef} className="canvas-grid" />
      <DrawingSurface
        client={client}
        drawingKey={drawingKey}
        editor={editor}
        sizes={BOARD_SIZES}
        camera={camera}
        className="absolute inset-0 h-full w-full"
        onPointerDownCapture={pans}
      />
    </div>
  )
}
