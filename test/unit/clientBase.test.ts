import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneBotClient } from '../../src/client.js'
import { OneBotClientBase, OnebotApiError } from '../../src/clientBase.js'
import { createMockLogger, findClosedPort, TestServer } from '../helpers/index.js'

const servers: TestServer[] = []
const clients: OneBotClientBase[] = []

async function startServer(options?: { port?: number }): Promise<TestServer> {
  const server = await TestServer.start(options)
  servers.push(server)
  return server
}

function makeClient(options: any, debug = false): OneBotClient {
  const client = new OneBotClient(options, debug)
  clients.push(client)
  return client
}

/** Connect a client to a fresh server and keep both registered for cleanup. */
async function connectedPair(options: Record<string, any> = {}, debug = false) {
  const logger = createMockLogger()
  const server = await startServer()
  const client = makeClient({ baseUrl: server.url, logger, ...options }, debug)
  await client.connect()
  return { server, client, logger }
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await Promise.resolve(client.disconnect()).catch(() => {})
  }
  for (const server of servers.splice(0)) {
    await server.close()
  }
})

describe('OneBotClientBase constructor', () => {
  it('accepts an explicit baseUrl', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({ baseUrl: server.url, logger })
    expect(client).toBeInstanceOf(OneBotClientBase)
    await client.connect()
    expect(client.connected).toBe(true)
  })

  it('builds the baseUrl from protocol/host/port', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({
      protocol: 'ws',
      host: '127.0.0.1',
      port: server.port,
      logger,
    })
    await client.connect()
    expect(client.connected).toBe(true)
    expect(server.requestUrls[0]).toBe('/')
  })

  it('rejects options that carry neither form', async () => {
    expect(() => new OneBotClient({} as any)).toThrow(
      'OneBotClientOptions must contain either "protocol && host && port" or "baseUrl"',
    )
    expect(() => new OneBotClient({ host: 'x', port: 1 } as any)).toThrow(/must contain either/)
    // 有 protocol/host 但缺 port：也走同一条兜底分支。
    expect(() => new OneBotClient({ protocol: 'ws', host: 'x' } as any)).toThrow(/must contain either/)
    expect(() => new OneBotClient({ protocol: 'ws', port: 1 } as any)).toThrow(/must contain either/)
  })

  it('defaults reconnection to enabled, 10 attempts, 5s delay', async () => {
    const port = await findClosedPort()
    const client = makeClient({ baseUrl: `ws://127.0.0.1:${port}`, logger: createMockLogger() })
    const connecting = vi.fn()
    client.subscribe('socket.connecting', connecting)

    // 默认开启重连，第一次失败后只会安排下一次重试，不会 reject；afterEach 的
    // disconnect() 会清掉那个定时器。
    void client.connect().catch(() => {})

    await vi.waitFor(() => expect(connecting).toHaveBeenCalledTimes(1))
    expect(connecting.mock.calls[0][0].reconnection).toMatchObject({
      enable: true,
      attempts: 10,
      delay: 5000,
      nowAttempts: 1,
    })
  })

  it('honours explicit reconnection numbers', async () => {
    const connecting = vi.fn()
    const client = makeClient({
      baseUrl: 'ws://127.0.0.1:1',
      logger: createMockLogger(),
      reconnection: { enable: false, attempts: 3, delay: 25 },
    })
    client.subscribe('socket.connecting', connecting)
    await expect(client.connect()).rejects.toThrow()
    expect(connecting.mock.calls[0][0].reconnection).toEqual({
      enable: false,
      attempts: 3,
      delay: 25,
      nowAttempts: 1,
    })
  })

  it('falls back to the console logger when none is supplied', () => {
    // 只验证“不传 logger 也能构造”，不往真实控制台写东西。
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      clients.push(new OneBotClient({ baseUrl: 'ws://127.0.0.1:1' }))
      expect(info).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
      warn.mockRestore()
    }
  })
})

describe('connecting', () => {
  it('emits socket.connecting then socket.open, and logs the connection', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({ baseUrl: server.url, logger, reconnection: { enable: false } })

    const events: string[] = []
    client.subscribe('socket.connecting', () => events.push('connecting'))
    client.subscribe('socket.open', () => events.push('open'))

    expect(client.connected).toBe(false)
    await client.connect()

    expect(events).toEqual(['connecting', 'open'])
    expect(client.connected).toBe(true)
    expect(logger.info).toHaveBeenCalledWith(`connected to ${server.url}`)
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it('is a no-op when a connection is already established', async () => {
    const { server, client } = await connectedPair()
    await client.connect()
    expect(server.connectionCount).toBe(1)
  })

  it('shares one pending connection between concurrent callers', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({ baseUrl: server.url, logger, reconnection: { enable: false } })

    await Promise.all([client.connect(), client.connect(), client.connect()])
    expect(server.connectionCount).toBe(1)
    expect(client.connected).toBe(true)
  })

  it('appends a URL-encoded access_token as a query parameter', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({
      baseUrl: server.url,
      accessToken: 'a b&c',
      logger,
      reconnection: { enable: false },
    })
    await client.connect()
    expect(server.requestUrls[0]).toBe(`/?access_token=${encodeURIComponent('a b&c')}`)
  })

  it('continues the query string when the baseUrl already has one', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({
      baseUrl: `${server.url}/?x=1`,
      accessToken: 'tok',
      logger,
      reconnection: { enable: false },
    })
    await client.connect()
    expect(server.requestUrls[0]).toBe('/?x=1&access_token=tok')
  })

  it('sends no query parameter for an empty access_token', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({
      baseUrl: server.url,
      accessToken: '',
      logger,
      reconnection: { enable: false },
    })
    await client.connect()
    expect(server.requestUrls[0]).toBe('/')
  })
})

describe('send()', () => {
  it('resolves with response.data on retcode 0', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(
        JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 99 }, echo: frame.echo }),
      )
    }

    const preSend = vi.fn()
    const success = vi.fn()
    client.subscribe('api.preSend', preSend)
    client.subscribe('api.response.success', success)

    const result = await client.send('send_msg', { message: 'hi' } as any)

    expect(result).toEqual({ message_id: 99 })
    expect(preSend).toHaveBeenCalledTimes(1)
    expect(preSend.mock.calls[0][0]).toMatchObject({
      action: 'send_msg',
      params: { message: 'hi' },
    })
    expect(typeof preSend.mock.calls[0][0].echo).toBe('string')
    expect(success).toHaveBeenCalledTimes(1)
    expect(server.lastFrame).toMatchObject({ action: 'send_msg', params: { message: 'hi' } })
  })

  it('accepts a bare status:"ok" response without retcode', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(JSON.stringify({ status: 'ok', data: { user_id: 1 }, echo: frame.echo }))
    }
    await expect(client.send('get_login_info', {} as any)).resolves.toEqual({ user_id: 1 })
  })

  it('rejects with OnebotApiError on a non-zero retcode', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(
        JSON.stringify({
          status: 'failed',
          retcode: 1400,
          data: { message: 'bad request' },
          echo: frame.echo,
        }),
      )
    }

    const failure = vi.fn()
    client.subscribe('api.response.failure', failure)

    const error = await client.send('send_msg', {} as any).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(OnebotApiError)
    expect(error).toBeInstanceOf(Error)
    const apiError = error as OnebotApiError
    expect(apiError.name).toBe('OnebotApiError')
    expect(apiError.action).toBe('send_msg')
    expect(apiError.response).toMatchObject({ status: 'failed', retcode: 1400 })
    expect(apiError.message).toBe('send_msg failed: status=failed retcode=1400, detail="bad request"')
    expect(failure).toHaveBeenCalledTimes(1)
  })

  it('rejects when the socket is not connected', async () => {
    const client = makeClient({ baseUrl: 'ws://127.0.0.1:1', logger: createMockLogger() })
    const error = (await client.send('get_login_info', {} as any).catch((err: unknown) => err)) as OnebotApiError
    expect(error).toBeInstanceOf(OnebotApiError)
    expect(error.message).toBe(
      'get_login_info failed: status=failed retcode=-1, message=api socket is not connected',
    )
  })

  it('rejects a send issued while the socket is still connecting', async () => {
    const logger = createMockLogger()
    const server = await startServer()
    const client = makeClient({ baseUrl: server.url, logger, reconnection: { enable: false } })

    // 不 await：connect() 的同步段已经把 socket 建出来了，此时 readyState 仍是 CONNECTING。
    const opening = client.connect()
    const error = (await client.send('get_login_info', {} as any).catch((err: unknown) => err)) as OnebotApiError

    expect(error.message).toBe(
      'get_login_info failed: status=failed retcode=-1, message=api socket is not connected',
    )
    await opening
    expect(client.connected).toBe(true)
  })

  it('treats a response with neither retcode:0 nor status:"ok" as a failure', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(JSON.stringify({ status: 'failed', data: null, message: 'nope', echo: frame.echo }))
    }
    const error = (await client.send('get_login_info', {} as any).catch((err: unknown) => err)) as OnebotApiError
    expect(error.message).toBe('get_login_info failed: status=failed retcode=unknown, message=nope')
  })

  it('rejects after apiTimeout when no response arrives', async () => {
    const { client } = await connectedPair({ apiTimeout: 30 })
    const error = (await client.send('get_login_info', {} as any).catch((err: unknown) => err)) as OnebotApiError
    expect(error.message).toBe(
      'get_login_info failed: status=failed retcode=-1, message=api response timeout',
    )
  })

  it('dumps both directions when debug is on', async () => {
    const { server, client, logger } = await connectedPair({}, true)
    server.onFrame = (frame, socket) => {
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: {}, echo: frame.echo }))
    }
    await client.send('get_login_info', {} as any)
    expect(logger.debug).toHaveBeenCalledWith(
      'send request',
      expect.objectContaining({ action: 'get_login_info' }),
    )
    await vi.waitFor(() => {
      expect(logger.debug).toHaveBeenCalledWith('[socket]', 'receive data', expect.anything())
    })
  })
})

describe('invoke()', () => {
  it('passes a successful call straight through', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { nickname: 'bot' }, echo: frame.echo }))
    }
    await expect(client.invoke('get_login_info', {} as any)).resolves.toEqual({ nickname: 'bot' })
  })

  it('appends the hint to the failure message', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(
        JSON.stringify({ status: 'failed', retcode: 100, data: null, message: 'no', echo: frame.echo }),
      )
    }
    await expect(
      client.invoke('get_login_info', {} as any, { hint: 'check token' }),
    ).rejects.toThrow('get_login_info failed: status=failed retcode=100, message=no — check token')
  })

  it('keeps the bare message when no hint is given', async () => {
    const { server, client } = await connectedPair()
    server.onFrame = (frame, socket) => {
      socket.send(
        JSON.stringify({ status: 'failed', retcode: 100, data: null, message: 'no', echo: frame.echo }),
      )
    }
    await expect(client.invoke('get_login_info', {} as any)).rejects.toThrow(
      'get_login_info failed: status=failed retcode=100, message=no',
    )
  })

  it('stringifies a non-Error rejection and still appends the hint', async () => {
    const client = makeClient({ baseUrl: 'ws://127.0.0.1:1', logger: createMockLogger() })
    // send() 只会抛 OnebotApiError，但 invoke() 对任何 rejection 都做了兜底。
    ;(client as any).send = () => Promise.reject('boom')

    await expect(client.invoke('get_login_info', {} as any)).rejects.toThrow('boom')
    await expect(client.invoke('get_login_info', {} as any, { hint: 'why' })).rejects.toThrow('boom — why')
  })
})

describe('OnebotApiError message formatting', () => {
  it('falls back to "unknown" for a bare envelope', () => {
    const error = new OnebotApiError('act', {})
    expect(error.message).toBe('act failed: status=unknown retcode=unknown')
    expect(error.action).toBe('act')
    expect(error.response).toEqual({})
  })

  it('prefers data.message as the detail', () => {
    expect(new OnebotApiError('act', { status: 'failed', retcode: 1, data: { message: 'm' } }).message).toBe(
      'act failed: status=failed retcode=1, detail="m"',
    )
  })

  it('falls back to data.error as the detail', () => {
    expect(new OnebotApiError('act', { status: 'failed', retcode: 1, data: { error: 'e' } }).message).toBe(
      'act failed: status=failed retcode=1, detail="e"',
    )
  })

  it('uses the envelope message only when there is no detail', () => {
    expect(new OnebotApiError('act', { status: 'failed', retcode: 1, message: 'top' }).message).toBe(
      'act failed: status=failed retcode=1, message=top',
    )
  })

  it('omits empty or non-string envelope messages', () => {
    expect(new OnebotApiError('act', { status: 'failed', retcode: 1, message: '' }).message).toBe(
      'act failed: status=failed retcode=1',
    )
    expect(new OnebotApiError('act', { status: 'failed', retcode: 1, message: 42 }).message).toBe(
      'act failed: status=failed retcode=1',
    )
    expect(new OnebotApiError('act', { status: 'failed', retcode: 1, data: {} }).message).toBe(
      'act failed: status=failed retcode=1',
    )
  })
})

describe('incoming frames', () => {
  it('warns and ignores a non-JSON frame', async () => {
    const { server, client, logger } = await connectedPair()
    server.sendRaw('hello there')
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('[socket]', 'received non-JSON data:', 'hello there')
    })
    expect(client.connected).toBe(true)
  })

  it('warns and swallows a malformed JSON frame', async () => {
    const { server, logger } = await connectedPair()
    server.sendRaw('{oops')
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('[socket]', 'failed to parse JSON')
    })
    expect(logger.warn).toHaveBeenCalledWith(expect.any(SyntaxError))
  })

  it('routes a non-event payload to the event bus', async () => {
    const { server, logger } = await connectedPair()
    server.sendRaw('[1,2]')
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('[eventBus]', 'unknown post_type: undefined')
    })
  })

  it('converts a string-format message and decodes raw_message', async () => {
    const { server, client } = await connectedPair()
    const handler = vi.fn()
    client.on('message.group.normal' as any, handler as any)

    server.send({
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_format: 'string',
      message: 'hi[CQ:at,qq=1]',
      raw_message: 'a&#91;b&#93;',
      group_id: 1,
      self_id: 2,
    })

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    const context = handler.mock.calls[0][0]
    expect(context.message).toEqual([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { qq: '1' } },
    ])
    expect(context.message_format).toBe('array')
    expect(context.raw_message).toBe('a[b]')
    expect(typeof context.quick_action).toBe('function')
  })

  it('converts a string-format message_sent frame as well', async () => {
    const { server, client } = await connectedPair()
    const handler = vi.fn()
    client.on('message_sent.group.normal' as any, handler as any)

    server.send({
      post_type: 'message_sent',
      message_type: 'group',
      sub_type: 'normal',
      message_format: 'string',
      message: '[CQ:face,id=1]',
      group_id: 1,
    })

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    const context = handler.mock.calls[0][0]
    expect(context.message).toEqual([{ type: 'face', data: { id: '1' } }])
    expect(context.message_format).toBe('array')
    expect(context.raw_message).toBeUndefined()
  })

  it('leaves an already-array message untouched', async () => {
    const { server, client } = await connectedPair()
    const handler = vi.fn()
    client.on('message.private.friend' as any, handler as any)

    const message = [{ type: 'text', data: { text: 'hi' } }]
    server.send({
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_format: 'array',
      message,
      raw_message: 'hi',
    })

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    const context = handler.mock.calls[0][0]
    expect(context.message).toEqual(message)
    // message_format 已经是 'array'，所以不会被重新转换。
    expect(context.message_format).toBe('array')
    expect(context.raw_message).toBe('hi')
  })

  it('routes a "failed" frame that carries no echo to the event bus', async () => {
    const { server, logger } = await connectedPair()
    server.send({ status: 'failed', data: null, message: 'still just an event' })
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('[eventBus]', 'unknown post_type: undefined')
    })
  })

  it('ignores an echo that belongs to nobody', async () => {
    const { server, client, logger } = await connectedPair()
    server.send({ status: 'ok', retcode: 0, data: {}, echo: 'not-a-known-echo' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(logger.warn).not.toHaveBeenCalled()
    expect(client.connected).toBe(true)
  })

  it('treats status:"failed" with echo:null as a fatal auth error', async () => {
    const { server, client } = await connectedPair({ reconnection: { enable: true, attempts: 5 } })
    const errors: any[] = []
    client.subscribe('socket.error', (payload) => errors.push(payload))

    server.send({ status: 'failed', echo: null, retcode: 1403, message: 'invalid token' })

    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toMatchObject({
      error_type: 'response_error',
      info: { url: server.url, errno: 1403, message: 'invalid token' },
    })
    expect(errors[0].reconnection.enable).toBe(false)
    await vi.waitFor(() => expect(client.connected).toBe(false))
  })

  it('fails in-flight requests when the connection closes', async () => {
    const { server, client } = await connectedPair({ apiTimeout: 60_000 })
    server.onFrame = () => {}

    const pending = client.send('get_login_info', {} as any)
    await server.waitForFrame((frame) => frame.action === 'get_login_info')

    server.socket!.close(1000, 'bye')

    await expect(pending).rejects.toThrow(
      'get_login_info failed: status=failed retcode=-1, message=connection closed',
    )
    await vi.waitFor(() => expect(client.connected).toBe(false))
  })
})

describe('reconnection', () => {
  it('re-establishes the socket and resolves the original connect()', async () => {
    const logger = createMockLogger()
    const port = await findClosedPort()
    const client = makeClient({
      baseUrl: `ws://127.0.0.1:${port}`,
      logger,
      reconnection: { enable: true, attempts: 3, delay: 200 },
    })

    const closed = new Promise<void>((resolve) => {
      client.subscribe('socket.close', () => resolve())
    })

    const pending = client.connect()
    // 第一次连接被拒（端口没人监听），随后在重连窗口内把实现端拉起来。
    await closed
    const server = await startServer({ port })

    await expect(pending).resolves.toBeUndefined()
    expect(client.connected).toBe(true)
    expect(server.connectionCount).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('disconnected; retrying in 200ms'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('(attempt 2/3)'))
  })

  it('rejects when reconnection is disabled', async () => {
    const port = await findClosedPort()
    const client = makeClient({
      baseUrl: `ws://127.0.0.1:${port}`,
      logger: createMockLogger(),
      reconnection: { enable: false },
    })
    await expect(client.connect()).rejects.toThrow(
      `could not connect to ws://127.0.0.1:${port}: reconnection disabled`,
    )
  })

  it('rejects once the attempt budget is exhausted', async () => {
    const port = await findClosedPort()
    const client = makeClient({
      baseUrl: `ws://127.0.0.1:${port}`,
      logger: createMockLogger(),
      reconnection: { enable: true, attempts: 2, delay: 10 },
    })
    await expect(client.connect()).rejects.toThrow(
      `could not connect to ws://127.0.0.1:${port}: reconnection attempts exhausted (2/2)`,
    )
  })

  it('reconnects on demand after a drop', async () => {
    const { server, client } = await connectedPair({ reconnection: { enable: false } })
    expect(server.connectionCount).toBe(1)
    server.socket!.close(1000, 'bye')
    await vi.waitFor(() => expect(client.connected).toBe(false))

    await client.reconnect()
    expect(client.connected).toBe(true)
    expect(server.connectionCount).toBe(2)
  })

  it('reports connect errors through the socket.error event', async () => {
    const port = await findClosedPort()
    const client = makeClient({
      baseUrl: `ws://127.0.0.1:${port}`,
      logger: createMockLogger(),
      reconnection: { enable: false },
    })
    const errors: any[] = []
    client.subscribe('socket.error', (payload) => errors.push(payload))

    // clientBase 的 reject 只说明「为什么不再重试」；操作系统级的失败原因在事件里。
    await expect(client.connect()).rejects.toThrow(
      `could not connect to ws://127.0.0.1:${port}: reconnection disabled`,
    )

    expect(errors).toHaveLength(1)
    expect(errors[0].error_type).toBe('connect_error')
    expect(Array.isArray(errors[0].errors)).toBe(true)
    expect(errors[0].errors[0]).toBeInstanceOf(Error)
    expect(errors[0].errors[0].message).toMatch(/ECONNREFUSED/)
    expect(errors[0].reconnection).toBeDefined()
  })
})

describe('disconnect()', () => {
  it('resolves immediately when nothing was ever connected', async () => {
    const client = makeClient({ baseUrl: 'ws://127.0.0.1:1', logger: createMockLogger() })
    await expect(client.disconnect()).resolves.toBeUndefined()
    expect(client.connected).toBe(false)
  })

  it('closes an open socket and clears the state', async () => {
    const { server, client } = await connectedPair()
    expect(client.connected).toBe(true)
    await client.disconnect()
    expect(client.connected).toBe(false)
    await vi.waitFor(() => expect(server.socket!.readyState).toBe(3))
  })

  it('short-circuits when the socket is already closed', async () => {
    const { server, client } = await connectedPair({
      reconnection: { enable: true, attempts: 5, delay: 10_000 },
    })
    server.socket!.close(1000, 'bye')
    await vi.waitFor(() => expect(client.connected).toBe(false))
    await expect(client.disconnect()).resolves.toBeUndefined()
  })
})

describe('event facade', () => {
  it('delegates on/once/off/subscribe/subscribeOnce/emit', () => {
    const client = makeClient({ baseUrl: 'ws://127.0.0.1:1', logger: createMockLogger() })

    const onHandler = vi.fn()
    expect(client.on('message' as any, onHandler as any)).toBe(client)
    expect(client.emit('message' as any, { n: 1 } as any)).toBe(client)
    expect(onHandler).toHaveBeenCalledWith({ n: 1 })

    expect(client.off('message' as any, onHandler as any)).toBe(client)
    client.emit('message' as any, { n: 2 } as any)
    expect(onHandler).toHaveBeenCalledTimes(1)

    const onceHandler = vi.fn()
    expect(client.once('request.friend' as any, onceHandler as any)).toBe(client)
    client.emit('request.friend' as any, {} as any)
    client.emit('request.friend' as any, {} as any)
    expect(onceHandler).toHaveBeenCalledTimes(1)

    const subscribed = vi.fn()
    const unsubscribe = client.subscribe('notice.group_card' as any, subscribed as any)
    client.emit('notice.group_card' as any, {} as any)
    unsubscribe()
    client.emit('notice.group_card' as any, {} as any)
    expect(subscribed).toHaveBeenCalledTimes(1)

    const onceSubscribed = vi.fn()
    const unsubscribeOnce = client.subscribeOnce('notice.group_upload' as any, onceSubscribed as any)
    client.emit('notice.group_upload' as any, {} as any)
    client.emit('notice.group_upload' as any, {} as any)
    unsubscribeOnce()
    expect(onceSubscribed).toHaveBeenCalledTimes(1)
  })
})
