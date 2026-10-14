import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect, OneBotClient } from '../../src/client.js'
import type { OneBotClientBase } from '../../src/clientBase.js'
import { createMockLogger, findClosedPort, silentLogger, TestServer } from '../helpers/index.js'

const servers: TestServer[] = []
const clients: OneBotClientBase[] = []

async function startServer(options?: { port?: number; rejectHandshakes?: number }): Promise<TestServer> {
  const server = await TestServer.start(options)
  servers.push(server)
  return server
}

function track<T extends OneBotClientBase>(client: T): T {
  clients.push(client)
  return client
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await Promise.resolve(client.disconnect()).catch(() => {})
  }
  for (const server of servers.splice(0)) {
    await server.close()
  }
})

describe('connect()', () => {
  it('resolves with a connected client built from baseUrl', async () => {
    const server = await startServer()
    const logger = createMockLogger()

    const bot = track(
      await connect({ baseUrl: server.url, logger, reconnection: { enable: false } }),
    )

    expect(bot).toBeInstanceOf(OneBotClient)
    expect(bot.connected).toBe(true)
    expect(server.connectionCount).toBe(1)
  })

  it('resolves for the protocol/host/port form too', async () => {
    const server = await startServer()
    const bot = track(
      await connect({
        protocol: 'ws',
        host: '127.0.0.1',
        port: server.port,
        accessToken: 'tok',
        logger: createMockLogger(),
        reconnection: { enable: false },
      }),
    )

    expect(bot.connected).toBe(true)
    expect(server.requestUrls[0]).toBe('/?access_token=tok')
  })

  it('falls back to the default reconnection settings when the option is omitted', async () => {
    const server = await startServer()
    const bot = track(await connect({ baseUrl: server.url, logger: createMockLogger() }))
    expect(bot.connected).toBe(true)
  })

  it('rejects after the retry budget when the handshake is refused', async () => {
    const server = await startServer({ rejectHandshakes: 401 })

    const rejection = (await connect({
      baseUrl: server.url,
      logger: createMockLogger(),
      reconnection: { enable: true, attempts: 2, delay: 5 },
    }).catch((error: unknown) => error)) as Error

    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.message).toMatch(
      new RegExp(`^could not connect to ${server.url.replace(/[.:]/g, '\\$&')} after 2 attempts \\(.+\\)$`),
    )
    expect(server.connectionCount).toBe(0)
  })

  it('uses the singular "attempt" wording when reconnection is disabled', async () => {
    const server = await startServer({ rejectHandshakes: 403 })

    await expect(
      connect({
        baseUrl: server.url,
        logger: createMockLogger(),
        reconnection: { enable: false },
      }),
    ).rejects.toThrow(new RegExp(`^could not connect to .+ after 1 attempt \\(.+\\)$`))
  })

  it('rejects with the underlying error when the URL is unusable', async () => {
    await expect(
      connect({ baseUrl: 'not-a-url', logger: createMockLogger(), reconnection: { enable: false } }),
    ).rejects.toThrow(/Invalid URL/)
  })

  it('reports the connection error when nothing is listening', async () => {
    const port = await findClosedPort()

    await expect(
      connect({
        baseUrl: `ws://127.0.0.1:${port}`,
        logger: createMockLogger(),
        reconnection: { enable: false },
      }),
    ).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('OneBotClient action surface', () => {
  /** An instance whose `send` is replaced by a recorder. */
  function stubClient() {
    const client = new OneBotClient({ baseUrl: 'ws://127.0.0.1:1', logger: silentLogger })
    const calls: Array<{ action: string; params: unknown }> = []
    const send = vi.fn(async (action: string, params: unknown) => {
      calls.push({ action, params })
      return {} as any
    })
    ;(client as any).send = send
    return { client, send, calls }
  }

  it('delegates every action method to send() under its own name', async () => {
    const { client, send } = stubClient()
    const names = Object.getOwnPropertyNames(OneBotClient.prototype).filter(
      (name) => name !== 'constructor',
    )

    // 表驱动：任何一个新增的 API 都会被自动带上，数量断言防止方法被悄悄删掉。
    expect(names.length).toBeGreaterThan(100)
    expect(names).not.toContain('.handle_quick_operation')

    for (const name of names) {
      send.mockClear()
      const returned = (client as any)[name]({})
      expect(send, `${name} should call send()`).toHaveBeenCalledWith(name, {})
      await expect(returned, `${name} should return the send() promise`).resolves.toEqual({})
    }
  })

  it('exposes .handle_quick_operation as an instance-bound action', async () => {
    const { client, send } = stubClient()
    const method = client['.handle_quick_operation']
    expect(method).toBeTypeOf('function')
    await method({ context: {}, operation: { approve: true } } as any)
    expect(send).toHaveBeenCalledWith('.handle_quick_operation', {
      context: {},
      operation: { approve: true },
    })
  })

  it('forwards params verbatim', async () => {
    const { client, send, calls } = stubClient()

    await client.send_msg({ message: 'hi' } as any)
    await client.send_private_msg({ user_id: 1, message: 'hi' } as any)
    await client.send_group_msg({ group_id: 2, message: 'hi' } as any)
    await client.set_group_ban({ group_id: 2, user_id: 3, duration: 60 } as any)

    expect(calls).toEqual([
      { action: 'send_msg', params: { message: 'hi' } },
      { action: 'send_private_msg', params: { user_id: 1, message: 'hi' } },
      { action: 'send_group_msg', params: { group_id: 2, message: 'hi' } },
      { action: 'set_group_ban', params: { group_id: 2, user_id: 3, duration: 60 } },
    ])
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('substitutes an empty object for the optional params', async () => {
    const { client, calls } = stubClient()

    await client.get_group_list()
    await client.get_group_list({ no_cache: true } as any)
    await client.get_group_system_msg()
    await client.get_group_system_msg({ count: 1 } as any)
    await client.get_recent_contact()
    await client.get_recent_contact({ count: 1 } as any)
    await client.fetch_custom_face()
    await client.fetch_custom_face([1] as any)
    await client.get_doubt_friends_add_request()
    await client.get_doubt_friends_add_request({ count: 1 } as any)

    expect(calls).toEqual([
      { action: 'get_group_list', params: {} },
      { action: 'get_group_list', params: { no_cache: true } },
      { action: 'get_group_system_msg', params: {} },
      { action: 'get_group_system_msg', params: { count: 1 } },
      { action: 'get_recent_contact', params: {} },
      { action: 'get_recent_contact', params: { count: 1 } },
      { action: 'fetch_custom_face', params: {} },
      { action: 'fetch_custom_face', params: [1] },
      { action: 'get_doubt_friends_add_request', params: {} },
      { action: 'get_doubt_friends_add_request', params: { count: 1 } },
    ])
  })

  it('sends parameterless actions with an empty object', async () => {
    const { client, calls } = stubClient()
    await client.get_login_info()
    await client.get_version_info()
    await client.nc_get_rkey()
    expect(calls).toEqual([
      { action: 'get_login_info', params: {} },
      { action: 'get_version_info', params: {} },
      { action: 'nc_get_rkey', params: {} },
    ])
  })
})
