import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { getCredential } from '../cloud/credentials'
import { readLink } from '../cloud/state'
import type { DesignPaths } from '../core/paths'
import { ID_PATTERN } from '../core/schema'
import {
  applyOps,
  type ClientMessage,
  type Drawing,
  type DrawingKey,
  type DrawingOps,
  diffDrawings,
  emptyDrawing,
  MAX_MESSAGE,
  parseClientMessage,
  parseDrawings,
  parseServerMessage,
  type ServerMessage,
} from '../shared/drawings'
import { FRAME_HOST, isAllowedHost, parseHost } from './hosts'

/**
 * Boards and screen markup of the preview: one socket per open canvas, the drawings kept in the
 * canvas folder's `.drawings.json` (a dot-file, so cloud sync of the canvas itself passes it by).
 * When `.design` is linked to the cloud, the drawings of every canvas open here also go through
 * the cloud's socket both ways: members there see these strokes as they are drawn, and theirs show
 * up here.
 */

const FILE = '.drawings.json'
/** How long a canvas nobody has open keeps its cloud socket. */
const IDLE_MS = 30_000
/** How long the CLI waits for the cloud before it answers with what is here. */
export const SYNC_WAIT_MS = 6000

export const drawingsFile = (paths: DesignPaths, canvas: string) => path.join(paths.canvases, canvas, FILE)

export type CloudState = 'unlinked' | 'connecting' | 'synced' | 'offline'

interface Client {
  peer: string
  /** Strokes this client has on the way, so the cloud hears they ended when it leaves. */
  live: Map<string, DrawingKey>
}

const send = (socket: WebSocket, message: ServerMessage | ClientMessage) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function readFile(file: string): Record<DrawingKey, Drawing> {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  try {
    return parseDrawings((JSON.parse(raw) as { drawings?: unknown }).drawings)
  } catch {
    console.warn(`[design] ${file} is not valid JSON; its drawings are not shown`)
    return {}
  }
}

class Room {
  drawings: Record<DrawingKey, Drawing>
  readonly clients = new Map<WebSocket, Client>()
  private cloud: CloudRelay | null = null
  private written: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly hub: DrawingHub,
    readonly canvas: string,
  ) {
    this.drawings = readFile(this.file)
  }

  get file() {
    return drawingsFile(this.hub.paths, this.canvas)
  }

  canDraw() {
    return this.cloud?.canDraw ?? true
  }

  cloudState(): CloudState {
    return this.cloud ? this.cloud.state : 'unlinked'
  }

  /** The cloud's answer, or what is here once `timeout` passes. */
  async synced(timeout: number) {
    this.touch()
    if (this.cloud) await Promise.race([this.cloud.ready, new Promise((resolve) => setTimeout(resolve, timeout))])
  }

  /** Keep (or open) the cloud socket for a while even with nobody here: the CLI reads through it. */
  touch() {
    this.connectCloud()
    this.release()
  }

  private connectCloud() {
    clearTimeout(this.idleTimer)
    if (this.cloud) return
    const link = readLink(this.hub.paths)
    const credential = link ? getCredential(link.host) : null
    if (!link || !credential) return
    this.cloud = new CloudRelay(this, link.host, link.project, credential.token)
  }

  /** With nobody left, let the cloud socket go after a while. */
  private release() {
    clearTimeout(this.idleTimer)
    if (this.clients.size) return
    this.idleTimer = setTimeout(() => {
      if (this.clients.size) return
      this.cloud?.close()
      this.cloud = null
    }, IDLE_MS)
    this.idleTimer.unref()
  }

  join(socket: WebSocket) {
    const client: Client = { peer: this.hub.nextPeer(), live: new Map() }
    this.clients.set(socket, client)
    this.connectCloud()
    send(socket, { type: 'hello', peer: client.peer, canDraw: this.canDraw(), drawings: this.drawings })
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      const message = parseClientMessage(data.toString())
      if (message) this.fromClient(socket, client, message)
      else send(socket, { type: 'error', message: 'Not a drawings message.' })
    })
    socket.on('close', () => {
      this.clients.delete(socket)
      for (const [id, key] of client.live) this.cloud?.send({ type: 'live-end', key, id })
      this.broadcast({ type: 'gone', peer: client.peer })
      this.release()
    })
    socket.on('error', () => socket.terminate())
  }

  private fromClient(socket: WebSocket, client: Client, message: ClientMessage) {
    if (!this.canDraw()) {
      send(socket, { type: 'error', message: 'You can look at these drawings but not draw on them.' })
      return
    }
    if (message.type === 'ops') {
      this.change(message.key, { add: message.add, erase: message.erase }, client.peer)
      send(socket, { type: 'ack', id: message.id })
    } else if (message.type === 'live') {
      client.live.set(message.stroke.id, message.key)
      this.broadcast({ ...message, peer: client.peer }, socket)
      this.cloud?.send(message)
    } else {
      client.live.delete(message.id)
      this.broadcast({ ...message, peer: client.peer }, socket)
      this.cloud?.send(message)
    }
  }

  /** A change made here (a viewer, the CLI): applied, and passed on to the cloud. */
  change(key: DrawingKey, ops: DrawingOps, peer: string) {
    this.apply(key, ops, peer)
    this.cloud?.forward(key, ops)
  }

  /** Apply ops from anywhere; tell everyone here and save when they changed something. */
  apply(key: DrawingKey, ops: DrawingOps, peer: string): boolean {
    const next = applyOps(this.drawings[key] ?? emptyDrawing(), ops)
    if (!next) return false
    this.drawings = { ...this.drawings, [key]: next }
    this.broadcast({ type: 'ops', key, ...ops, peer })
    this.save()
    return true
  }

  /** A whole drawing from elsewhere, merged with this one; returns what this side has that it lacked. */
  merge(key: DrawingKey, drawing: Drawing): DrawingOps | null {
    const here = this.drawings[key] ?? emptyDrawing()
    const missing = diffDrawings(drawing, here)
    if (missing) {
      const next = applyOps(here, missing)
      if (next) {
        this.drawings = { ...this.drawings, [key]: next }
        this.broadcast({ type: 'doc', key, drawing: next })
        this.save()
      }
    }
    return diffDrawings(this.drawings[key] ?? emptyDrawing(), drawing)
  }

  /** The cloud's answer came in, or its verdict on drawing changed: everyone here starts over from it. */
  rehello() {
    for (const [socket, client] of this.clients)
      send(socket, { type: 'hello', peer: client.peer, canDraw: this.canDraw(), drawings: this.drawings })
  }

  broadcast(message: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(message)
    for (const socket of this.clients.keys())
      if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(data)
  }

  private save() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 150)
  }

  flush() {
    clearTimeout(this.saveTimer)
    const dir = path.dirname(this.file)
    if (!fs.existsSync(dir)) return
    const drawings = Object.fromEntries(
      Object.entries(this.drawings).filter(([, d]) => d.strokes.length || d.erased.length),
    )
    const text = `${JSON.stringify({ drawings })}\n`
    if (text === this.written) return
    const temp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(temp, text)
    fs.renameSync(temp, this.file)
    this.written = text
  }

  /** The file changed on disk: unless it was this server's own write, it is the drawings now. */
  reload() {
    let raw: string | null = null
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {}
    if (raw !== null && raw === this.written) return
    const next = readFile(this.file)
    for (const key of new Set([...Object.keys(this.drawings), ...Object.keys(next)])) {
      const drawing = next[key] ?? emptyDrawing()
      if (JSON.stringify(drawing) === JSON.stringify(this.drawings[key] ?? emptyDrawing())) continue
      this.broadcast({ type: 'doc', key, drawing })
      const ops = diffDrawings(drawing, this.drawings[key] ?? emptyDrawing())
      if (ops) this.cloud?.forward(key, ops)
    }
    this.drawings = next
    this.written = raw
  }

  close() {
    this.flush()
    this.cloud?.close()
    this.cloud = null
    clearTimeout(this.idleTimer)
    for (const socket of this.clients.keys()) socket.close(1001)
  }
}

/** The cloud's socket for one canvas: what is drawn here goes up, what members draw comes down. */
class CloudRelay {
  canDraw = true
  state: CloudState = 'connecting'
  /** Settles on the cloud's first answer, or once it is clear there will be none soon. */
  readonly ready: Promise<void>
  private settle: () => void = () => {}
  private socket: WebSocket | null = null
  private peer = ''
  private nextId = 1
  private delay = 1000
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  /** Cloud peers with strokes on the way here, cleared when the socket drops. */
  private peers = new Set<string>()

  constructor(
    private readonly room: Room,
    private readonly host: string,
    private readonly project: string,
    private readonly token: string,
  ) {
    this.ready = new Promise((resolve) => {
      this.settle = resolve
    })
    this.connect()
  }

  private url() {
    const base = new URL(this.host)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = `/api/projects/${encodeURIComponent(this.project)}/canvases/${encodeURIComponent(this.room.canvas)}/drawings`
    return base.href
  }

  private connect() {
    if (this.closed) return
    const socket = new WebSocket(this.url(), {
      headers: { Authorization: `Bearer ${this.token}` },
      maxPayload: MAX_MESSAGE * 4,
      handshakeTimeout: 10_000,
    })
    this.socket = socket
    let refusal = 0
    socket.on('unexpected-response', (_req, res) => {
      refusal = res.statusCode ?? 0
      res.resume()
      socket.terminate()
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      const message = parseServerMessage(data.toString())
      if (message) this.receive(message)
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      for (const peer of this.peers) this.room.broadcast({ type: 'gone', peer })
      this.peers.clear()
      if (this.closed) return
      const wasSynced = this.state === 'synced'
      this.state = 'offline'
      this.settle()
      // Refused: the canvas is not in the cloud yet, the project is archived, or access is gone.
      // Ask again much later; a token the cloud no longer takes waits for `design login`.
      const wait = refusal === 401 ? 30 * 60_000 : refusal >= 400 ? 5 * 60_000 : wasSynced ? 1000 : this.delay
      this.delay = Math.min(this.delay * 2, 30_000)
      if (!this.canDraw) {
        this.canDraw = true
        this.room.rehello()
      }
      this.timer = setTimeout(() => this.connect(), wait)
      this.timer.unref()
    })
  }

  private receive(message: ServerMessage) {
    const cloudPeer = (peer: string) => `cloud:${peer}`
    switch (message.type) {
      case 'hello': {
        this.peer = message.peer
        this.canDraw = message.canDraw
        this.state = 'synced'
        this.delay = 1000
        const keys = new Set([...Object.keys(message.drawings), ...Object.keys(this.room.drawings)])
        for (const key of keys) {
          const up = this.room.merge(key, message.drawings[key] ?? emptyDrawing())
          if (up && this.canDraw) this.forward(key, up)
        }
        this.room.rehello()
        this.settle()
        break
      }
      case 'ops':
        if (message.peer !== this.peer)
          this.room.apply(message.key, { add: message.add, erase: message.erase }, cloudPeer(message.peer))
        break
      case 'doc': {
        const up = this.room.merge(message.key, message.drawing)
        if (up && this.canDraw) this.forward(message.key, up)
        break
      }
      case 'live':
      case 'live-end':
        this.peers.add(cloudPeer(message.peer))
        this.room.broadcast({ ...message, peer: cloudPeer(message.peer) })
        break
      case 'gone':
        this.peers.delete(cloudPeer(message.peer))
        this.room.broadcast({ type: 'gone', peer: cloudPeer(message.peer) })
        break
      case 'error':
        console.warn(`[design] cloud drawings (${this.room.canvas}): ${message.message}`)
        break
    }
  }

  forward(key: DrawingKey, ops: DrawingOps) {
    this.send({ type: 'ops', id: this.nextId++, key, ...ops })
  }

  send(message: ClientMessage) {
    if (this.state !== 'synced' || !this.canDraw || !this.socket) return
    send(this.socket, message)
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    this.socket?.close(1000)
    this.socket = null
    this.settle()
  }
}

export class DrawingHub {
  private rooms = new Map<string, Room>()
  private server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE })
  private peers = 0

  constructor(
    readonly paths: DesignPaths,
    private readonly hasCanvas: (id: string) => boolean,
  ) {}

  nextPeer() {
    this.peers += 1
    return `p${this.peers}`
  }

  private room(canvas: string): Room | null {
    if (!ID_PATTERN.test(canvas) || !this.hasCanvas(canvas)) return null
    let room = this.rooms.get(canvas)
    if (!room) {
      room = new Room(this, canvas)
      this.rooms.set(canvas, room)
    }
    return room
  }

  /**
   * `GET /api/drawings/<canvas>` as a socket. Only the viewer's own pages may open one: the Origin
   * is this server on the viewer's host (a site elsewhere, or a frame on 127.0.0.1, is refused).
   */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number, extraHost?: string) {
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    }
    const host = req.headers.host
    const origin = req.headers.origin
    if (!isAllowedHost(host, port, extraHost) || parseHost(host)?.name === FRAME_HOST || origin !== `http://${host}`)
      return refuse(403, 'Forbidden')
    const url = new URL(req.url ?? '/', 'http://localhost')
    let canvas = ''
    try {
      canvas = decodeURIComponent(url.pathname.slice('/api/drawings/'.length))
    } catch {}
    const room = this.room(canvas)
    if (!room) return refuse(404, 'Not Found')
    this.server.handleUpgrade(req, socket, head, (ws) => room.join(ws))
  }

  /** Every drawing of a canvas, after the cloud had a moment to answer when `.design` is linked. */
  async read(canvas: string): Promise<{ drawings: Record<DrawingKey, Drawing>; cloud: CloudState } | null> {
    const room = this.room(canvas)
    if (!room) return null
    await room.synced(SYNC_WAIT_MS)
    return { drawings: room.drawings, cloud: room.cloudState() }
  }

  /** Erase everything in one drawing; the number of strokes erased, or null without such a canvas. */
  async clear(canvas: string, key: DrawingKey): Promise<number | null> {
    const room = this.room(canvas)
    if (!room) return null
    await room.synced(SYNC_WAIT_MS)
    const erase = (room.drawings[key]?.strokes ?? []).map((stroke) => stroke.id)
    if (!erase.length) return 0
    // With the cloud offline, the erasure goes up when it answers again.
    room.change(key, { erase }, 'cli')
    room.flush()
    return erase.length
  }

  /** A `.drawings.json` changed on disk. */
  fileChanged(canvas: string) {
    this.rooms.get(canvas)?.reload()
  }

  close() {
    for (const room of this.rooms.values()) room.close()
    this.rooms.clear()
    this.server.close()
  }
}
