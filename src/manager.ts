type ShardData = {
  conns: number
  assigned: number
}

export class Manager {
  state: DurableObjectState
  env: Env
  shards: Map<string, ShardData>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.shards = new Map()

    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get('shards')
      if (stored) {
        this.shards = stored as Map<string, ShardData>
      }
    })
  }

  saveShards() {
    this.state.storage.put('shards', this.shards, {
      // allowUnconfirmed: true,
    })
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    const url = new URL(request.url)
    switch (url.pathname) {
      case '/publish':
        return this.publish(request)
      case '/assign':
        return this.assign(request)
      case '/report':
        return this.report(request)
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  // TODO: have a minutely cron that reports analytics of how many conns & shards we have

  async publish(request: Request) {
    const t = await request.text()

    await Promise.all(
      Array.from(this.shards.keys()).map((shardID) =>
        this.env.SHARD.get(this.env.SHARD.idFromString(shardID)).fetch(
          'https://realtime.fugi.tech/publish',
          {
            method: 'POST',
            headers: request.headers,
            body: t,
          },
        ),
      ),
    )

    return new Response()
  }

  async assign(_request: Request) {
    for (const [shardID, data] of this.shards.entries()) {
      if (data.conns + data.assigned < 1000) {
        data.assigned++
        this.saveShards()
        return new Response(shardID)
      }
    }

    const shardID = this.env.SHARD.newUniqueId().toString()
    this.shards.set(shardID, { conns: 0, assigned: 1 })
    this.saveShards()
    return new Response(shardID)
  }

  async report(request: Request) {
    const d = (await request.json()) as { shard: string; conns: number }
    if (d.conns > 0) {
      this.shards.set(d.shard, {
        conns: d.conns,
        assigned: 0,
      })
    } else {
      this.shards.delete(d.shard)
    }
    this.saveShards()
    return new Response(null)
  }
}

interface Env {
  SHARD: DurableObjectNamespace
}
