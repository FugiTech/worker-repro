// In order for the workers runtime to find the class that implements
// our Durable Object namespace, we must export it from the root module.
export { Manager } from './manager'
export { Shard } from './shard'

const HTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Worker Repro</title>
  </head>
  <body>
    <button id="publish">Send Message</button>
    <hr />
    <h3>Message Log</h3>
    <pre id="log"></pre>
    <script>
      document.getElementById('publish').addEventListener('click', () => {
        fetch('http://localhost:8787/publish', {
          method: 'POST',
          body: JSON.stringify({
            cluster: 'test',
            room: 'test',
            data: { a: 1, b: '2', rng: Math.random() },
          }),
        })
      })

      const log = document.getElementById('log')
      const ws = new WebSocket('ws://localhost:8787/')
      ws.addEventListener('open', (e) => {
        log.innerText += \`websocket open\\n\`
        ws.send(
          JSON.stringify({ event: 'subscribe', cluster: 'test', room: 'test' }),
        )
      })
      ws.addEventListener('message', (e) => {
        log.innerText += \`\${e.data}\\n\`
      })
      ws.addEventListener('close', (e) => {
        log.innerText += \`websocket close\\n\`
      })
      ws.addEventListener('error', (e) => {
        log.innerText += \`websocket error\\n\`
      })
    </script>
  </body>
</html>
`

export default {
  async fetch(request: Request, env: Env) {
    try {
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/publish') {
        return await publish(request, env)
      } else if (
        request.method === 'GET' &&
        url.pathname === '/' &&
        request.headers.get('Upgrade') === 'websocket'
      ) {
        return await subscribe(request, env)
      } else if (request.method === 'GET' && url.pathname === '/') {
        return new Response(HTML, {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        })
      } else {
        return new Response('Not found', { status: 404 })
      }
    } catch (e) {
      console.error(e)
      const error = e instanceof Error && e.stack ? e.stack : `${e}`
      if (request.headers.get('Upgrade') === 'websocket') {
        // Send errors to websocket requests as a message
        const { 0: client, 1: server } = new WebSocketPair()
        server.accept()
        server.send(JSON.stringify({ error }))
        server.close(1011, 'Uncaught exception during session setup')
        return new Response(null, { status: 101, webSocket: client })
      } else {
        return new Response(error, { status: 500 })
      }
    }
  },
}

async function publish(request: Request, env: Env) {
  const t = await request.text()

  // TODO: Validate headers

  const d = JSON.parse(t) as { cluster: string; room: string; data: any }
  const room = `${d.cluster}-${d.room}`

  const manager = env.MANAGER.get(env.MANAGER.idFromName('global'))
  return manager.fetch('https://realtime.fugi.tech/publish', {
    method: 'POST',
    headers: { 'X-Room': room },
    body: JSON.stringify(d),
  })
  // TODO: report analytics of publish duration
}

async function subscribe(request: Request, env: Env) {
  const manager = env.MANAGER.get(env.MANAGER.idFromName('global'))
  const r = await manager.fetch('https://realtime.fugi.tech/assign')
  const shard = env.SHARD.get(env.SHARD.idFromString(await r.text()))
  return shard.fetch(request)
}

interface Env {
  MANAGER: DurableObjectNamespace
  SHARD: DurableObjectNamespace
}
