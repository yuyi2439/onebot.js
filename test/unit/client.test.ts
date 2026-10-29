import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect, OneBotClient } from '../../src/client.js'
import type { OneBotClientBase } from '../../src/clientBase.js'
import type { WSSendParam, WSSendReturn } from '../../src/interfaces.js'
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
    await client.fetch_custom_face({ count: '10' })
    await client.fetch_custom_face_detail()
    await client.fetch_custom_face_detail({ count: 10 })
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
      { action: 'fetch_custom_face', params: { count: '10' } },
      { action: 'fetch_custom_face_detail', params: {} },
      { action: 'fetch_custom_face_detail', params: { count: 10 } },
      { action: 'get_doubt_friends_add_request', params: {} },
      { action: 'get_doubt_friends_add_request', params: { count: 1 } },
    ])
  })

  it('preserves custom face paths, optional metadata, aliases and explicit false flags', async () => {
    const { client, calls } = stubClient()
    const add: WSSendParam['add_custom_face'] = {
      file: '/napcat/收藏表情.png', emoji_id: '0001', package_id: 0,
      file_name: '收藏表情.png', file_size: '123', md5: 'image-md5',
      is_mark_face: false, is_origin: false,
    }
    await client.add_custom_face(add)
    expect(calls[0]).toEqual({ action: 'add_custom_face', params: add })
    expect(calls[0].params).toBe(add)

    const deletes: WSSendParam['delete_custom_face'][] = [
      { res_id: 'res-1' }, { res_id: ['res-1', 'res-2'] },
      { id: 'res-1' }, { id: ['res-1', 'res-2'] },
      { ids: ['res-1', 'res-2'], md5: ['md5-1', 'md5-2'] },
    ]
    for (const params of deletes) {
      await client.delete_custom_face(params)
      expect(calls.at(-1)).toEqual({ action: 'delete_custom_face', params })
      expect(calls.at(-1)?.params).toBe(params)
    }

    const desc: WSSendParam['set_custom_face_desc'] = {
      emoji_id: '0001', res_id: 'res-1', md5: 'image-md5', desc: '',
    }
    await client.set_custom_face_desc(desc)
    expect(calls.at(-1)).toEqual({ action: 'set_custom_face_desc', params: desc })
    expect(calls.at(-1)?.params).toBe(desc)
  })

  it('round-trips custom face details and native operation results unchanged', async () => {
    const server = await startServer()
    const details: WSSendReturn['fetch_custom_face_detail'] = [{
      uin: '10001', emoId: 1, emoPath: '/napcat/face.png', isExist: true,
      resId: 'res-1', url: 'https://example.com/face.png', md5: 'image-md5',
      emoOriginalPath: '/napcat/original.png', thumbPath: '/napcat/thumb.png',
      RomaingType: '0', isAPNG: true, isMarkFace: false, eId: '1', epId: '0',
      ocrWord: '', modifyWord: '', exposeNum: 0, clickNum: 0, desc: '测试',
    }]
    const results: Record<string, unknown> = {
      fetch_custom_face: [details[0].url], fetch_custom_face_detail: details,
      add_custom_face: { result: 0, nativeField: ['res-1'] },
      delete_custom_face: null, set_custom_face_desc: { result: 0 },
    }
    server.onFrame = (frame, socket) => {
      server.reply(frame.echo, { status: 'ok', retcode: 0, data: results[frame.action] }, socket)
    }
    const bot = track(await connect({ baseUrl: server.url, logger: createMockLogger() }))
    await expect(bot.fetch_custom_face()).resolves.toEqual(results.fetch_custom_face)
    await expect(bot.fetch_custom_face_detail({ count: '10' })).resolves.toEqual(details)
    await expect(bot.add_custom_face({ file: '/napcat/face.png' })).resolves.toEqual(results.add_custom_face)
    await expect(bot.delete_custom_face({ ids: ['res-1'] })).resolves.toBeNull()
    await expect(bot.set_custom_face_desc({ emoji_id: 1, res_id: 'res-1', md5: 'image-md5', desc: '新描述' }))
      .resolves.toEqual(results.set_custom_face_desc)
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
