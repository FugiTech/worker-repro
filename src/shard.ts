type Session = {
  rooms: Set<string>
}

type Room = {
  sessions: Set<WebSocket>
  cache?: string
}

export class Shard {
  state: DurableObjectState
  env: Env
  sessions: Map<WebSocket, Session>
  rooms: Map<string, Room>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.sessions = new Map()
    this.rooms = new Map()
    this.state.getWebSockets().forEach((webSocket) => {
      const session = webSocket.deserializeAttachment() as Session
      this.sessions.set(webSocket, session)
      for (const room of session.rooms) {
        const r = this.rooms.get(room) || {
          sessions: new Set(),
        }
        r.sessions.add(webSocket)
        this.rooms.set(room, r)
      }
    })
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    const url = new URL(request.url)
    switch (url.pathname) {
      case '/publish':
        return this.publish(request)
      case '/':
        return this.subscribe(request)
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  async publish(request: Request) {
    const room = request.headers.get('X-Room')!
    const t = await request.text()

    const r = this.rooms.get(room) || {
      sessions: new Set(),
    }
    r.cache = t
    r.sessions.forEach((webSocket) => {
      try {
        webSocket.send(t)
      } catch (err) {
        this.unsubscribe(webSocket)
      }
    })
    this.rooms.set(room, r)

    return new Response()
  }

  async subscribe(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 })
    }

    const { 0: client, 1: server } = new WebSocketPair()
    await this.handleSession(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async handleSession(webSocket: WebSocket) {
    this.state.acceptWebSocket(webSocket)
    const session: Session = {
      rooms: new Set(),
    }
    webSocket.serializeAttachment(session)
    this.sessions.set(webSocket, session)
    this.report()
  }

  async webSocketMessage(webSocket: WebSocket, msg: string) {
    const session = this.sessions.get(webSocket)
    if (!session) {
      webSocket.close(1011, 'WebSocket broken.')
      return
    }

    const data = JSON.parse(msg) as {
      event: string
      cluster: string
      room: string
    }
    switch (data.event) {
      case 'subscribe':
        const room = `${data.cluster}-${data.room}`
        session.rooms.add(room)
        webSocket.serializeAttachment(session)

        const r = this.rooms.get(room) || {
          sessions: new Set(),
        }
        r.sessions.add(webSocket)
        this.rooms.set(room, r)

        // TODO: report analytics on cache hit ratio
        if (r.cache) {
          try {
            webSocket.send(r.cache)
          } catch (err) {
            this.unsubscribe(webSocket)
          }
        } else {
          // Queue webhook
          console.log('here i would queue webhook for', room)
        }
        return
    }
  }

  async webSocketClose(webSocket: WebSocket) {
    this.unsubscribe(webSocket)
  }

  async webSocketError(webSocket: WebSocket) {
    this.unsubscribe(webSocket)
  }

  async unsubscribe(webSocket: WebSocket) {
    const session = this.sessions.get(webSocket)
    if (!session) return

    for (const room of session.rooms) {
      this.rooms.get(room)?.sessions.delete(webSocket)
    }
    this.sessions.delete(webSocket)

    this.report()
  }

  async report() {
    const manager = this.env.MANAGER.get(this.env.MANAGER.idFromName('global'))
    return manager.fetch('https://realtime.fugi.tech/report', {
      method: 'POST',
      body: JSON.stringify({
        shard: this.state.id.toString(),
        conns: this.sessions.size,
      }),
    })
  }
}

interface Env {
  MANAGER: DurableObjectNamespace
}
