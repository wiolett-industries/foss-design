import {
  applyOps,
  type ClientMessage,
  type Drawing,
  type DrawingKey,
  type DrawingOps,
  diffDrawings,
  emptyDrawing,
  parseServerMessage,
  type ServerMessage,
  type Stroke,
} from '@shared/drawings'
import { useEffect, useState } from 'react'
import { Store, useStore } from './store'
import { useViewer } from './viewer'

/** A stroke someone else is drawing right now. */
export interface Ghost {
  peer: string
  name?: string
  stroke: Stroke
  seen: number
}

export interface DrawingsState {
  /** The server said hello: the drawings are the real ones. */
  ready: boolean
  online: boolean
  canDraw: boolean
  drawings: Record<DrawingKey, Drawing>
  ghosts: Record<DrawingKey, Ghost[]>
}

/** A ghost that stops moving for this long is dropped: its peer went quiet without saying so. */
const GHOST_TTL = 8000

/**
 * The drawings of one canvas over its socket. What shows is the server's drawings with this user's
 * changes it has not acknowledged yet on top: they show at once, go out numbered, and go out again
 * after a reconnect (applying them twice changes nothing). A change the server refuses comes back
 * as the stored drawing, then the acknowledgement, and so drops out of view.
 */
export class DrawingClient {
  readonly store = new Store<DrawingsState>({ ready: false, online: false, canDraw: false, drawings: {}, ghosts: {} })
  private socket: WebSocket | null = null
  /** The server's drawings, as far as it told. */
  private confirmed: Record<DrawingKey, Drawing> = {}
  private pending = new Map<number, { key: DrawingKey; ops: DrawingOps }>()
  private nextId = 1
  private delay = 500
  private timer: ReturnType<typeof setTimeout> | undefined
  private sweep: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly url: string) {
    this.connect()
    this.sweep = setInterval(() => this.dropStale(), 2000)
  }

  private connect() {
    if (this.closed) return
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch {
      this.retry()
      return
    }
    this.socket = socket
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const message = parseServerMessage(event.data)
      if (message) this.receive(message)
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.store.set((state) => ({ ...state, online: false, ghosts: {} }))
      this.retry()
    }
  }

  private retry() {
    if (this.closed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), this.delay)
    this.delay = Math.min(this.delay * 2, 10_000)
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** The drawing to show: the server's, with the changes still on their way applied. */
  private shown(key: DrawingKey): Drawing {
    let drawing = this.confirmed[key] ?? emptyDrawing()
    for (const pending of this.pending.values())
      if (pending.key === key) drawing = applyOps(drawing, pending.ops) ?? drawing
    return drawing
  }

  private show(keys: Iterable<DrawingKey>) {
    this.store.set((state) => {
      const drawings = { ...state.drawings }
      for (const key of keys) drawings[key] = this.shown(key)
      return { ...state, drawings }
    })
  }

  private receive(message: ServerMessage) {
    switch (message.type) {
      // First on each connection, and again when the server's verdict on drawing changes.
      case 'hello': {
        this.delay = 500
        this.confirmed = message.drawings
        const keys = new Set([...Object.keys(this.confirmed), ...[...this.pending.values()].map((p) => p.key)])
        const drawings: Record<DrawingKey, Drawing> = {}
        for (const key of keys) drawings[key] = this.shown(key)
        this.store.set({ ready: true, online: true, canDraw: message.canDraw, drawings, ghosts: {} })
        if (message.canDraw) for (const [id, { key, ops }] of this.pending) this.send({ type: 'ops', id, key, ...ops })
        else this.pending.clear()
        break
      }
      case 'ops': {
        const next = applyOps(this.confirmed[message.key] ?? emptyDrawing(), message)
        if (next) this.confirmed = { ...this.confirmed, [message.key]: next }
        const done = new Set((message.add ?? []).map((stroke) => stroke.id))
        this.store.set((state) => {
          const ghosts = state.ghosts[message.key]?.filter((ghost) => !done.has(ghost.stroke.id))
          return {
            ...state,
            drawings: next ? { ...state.drawings, [message.key]: this.shown(message.key) } : state.drawings,
            ghosts: ghosts ? { ...state.ghosts, [message.key]: ghosts } : state.ghosts,
          }
        })
        break
      }
      case 'ack': {
        const acked = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (acked) this.show([acked.key])
        break
      }
      // A whole drawing from the server: merged, since one that crossed a newer change must not undo it.
      case 'doc': {
        const here = this.confirmed[message.key] ?? emptyDrawing()
        const missing = diffDrawings(message.drawing, here)
        const next = missing ? applyOps(here, missing) : null
        if (next) {
          this.confirmed = { ...this.confirmed, [message.key]: next }
          this.show([message.key])
        }
        break
      }
      case 'live':
        this.store.set((state) => {
          const list = state.ghosts[message.key] ?? []
          const found = list.find((ghost) => ghost.stroke.id === message.stroke.id)
          const { at, points, ...rest } = message.stroke
          const stroke: Stroke = {
            ...rest,
            points: at && found ? [...found.stroke.points.slice(0, at), ...points] : points,
          }
          const ghost: Ghost = { peer: message.peer, name: message.name, stroke, seen: Date.now() }
          const next = found ? list.map((item) => (item === found ? ghost : item)) : [...list, ghost]
          return { ...state, ghosts: { ...state.ghosts, [message.key]: next } }
        })
        break
      case 'live-end':
        this.dropGhosts((ghost, key) => key === message.key && ghost.stroke.id === message.id)
        break
      case 'gone':
        this.dropGhosts((ghost) => ghost.peer === message.peer)
        break
      case 'error':
        console.warn(`[design] drawings: ${message.message}`)
        break
    }
  }

  private dropGhosts(drop: (ghost: Ghost, key: DrawingKey) => boolean) {
    this.store.set((state) => {
      let changed = false
      const ghosts: Record<DrawingKey, Ghost[]> = {}
      for (const [key, list] of Object.entries(state.ghosts)) {
        const kept = list.filter((ghost) => !drop(ghost, key))
        if (kept.length !== list.length) changed = true
        if (kept.length) ghosts[key] = kept
      }
      return changed ? { ...state, ghosts } : state
    })
  }

  private dropStale() {
    const now = Date.now()
    this.dropGhosts((ghost) => now - ghost.seen > GHOST_TTL)
  }

  /** A change of this user's: shown at once, sent, and sent again after a reconnect until acknowledged. */
  apply(key: DrawingKey, ops: DrawingOps) {
    const state = this.store.get()
    if (!state.canDraw) return
    if (!applyOps(state.drawings[key] ?? emptyDrawing(), ops)) return
    const id = this.nextId++
    this.pending.set(id, { key, ops })
    this.show([key])
    this.send({ type: 'ops', id, key, ...ops })
  }

  /** A stroke on its way: its points from `at` on (0 sends it whole). */
  live(key: DrawingKey, stroke: Stroke, at: number) {
    const { points, ...rest } = stroke
    this.send({ type: 'live', key, stroke: { ...rest, at, points: points.slice(at) } })
  }

  liveEnd(key: DrawingKey, id: string) {
    this.send({ type: 'live-end', key, id })
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    clearInterval(this.sweep)
    const socket = this.socket
    this.socket = null
    socket?.close()
  }
}

/** The drawings of a canvas while it is open, or null when the source has none. */
export function useDrawingClient(canvas: string, enabled = true): DrawingClient | null {
  const { source } = useViewer()
  const url = enabled ? (source.drawings?.(canvas) ?? null) : null
  const [client, setClient] = useState<DrawingClient | null>(null)
  useEffect(() => {
    if (!url) return
    const next = new DrawingClient(url)
    setClient(next)
    return () => {
      next.close()
      setClient(null)
    }
  }, [url])
  return client
}

const NO_GHOSTS: Ghost[] = []

/** One drawing and the strokes on their way onto it. */
export function useDrawing(client: DrawingClient, key: DrawingKey): { drawing: Drawing | undefined; ghosts: Ghost[] } {
  const drawing = useStore(client.store, (state) => state.drawings[key])
  const ghosts = useStore(client.store, (state) => state.ghosts[key] ?? NO_GHOSTS)
  return { drawing, ghosts }
}

/** For hooks that need a store before the canvas's drawings are there. */
export const noDrawings = new Store<DrawingsState>({
  ready: false,
  online: false,
  canDraw: false,
  drawings: {},
  ghosts: {},
})
