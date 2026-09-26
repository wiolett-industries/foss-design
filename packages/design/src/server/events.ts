import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DesignEvent } from '../shared/types'

/** Server-sent events that tell open viewers to refetch. */
export class EventHub {
  private clients = new Set<ServerResponse>()
  private timer: ReturnType<typeof setInterval>

  constructor() {
    this.timer = setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n')
    }, 20000)
    this.timer.unref()
  }

  attach(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    this.clients.add(res)
    req.on('close', () => this.clients.delete(res))
  }

  send(event: DesignEvent) {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const client of this.clients) client.write(data)
  }

  close() {
    clearInterval(this.timer)
    for (const client of this.clients) client.end()
    this.clients.clear()
  }
}
