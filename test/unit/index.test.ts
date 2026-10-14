import { afterEach, describe, expect, it } from 'vitest'
import * as api from '../../src/index.js'
import * as clientModule from '../../src/client.js'
import * as structsModule from '../../src/structs.js'
import * as utilsModule from '../../src/utils.js'
import type { OneBotClientBase } from '../../src/clientBase.js'
import { createMockLogger, TestServer } from '../helpers/index.js'

const servers: TestServer[] = []
const clients: OneBotClientBase[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await Promise.resolve(client.disconnect()).catch(() => {})
  }
  for (const server of servers.splice(0)) {
    await server.close()
  }
})

describe('package entry (src/index.ts)', () => {
  it('re-exports the whole client, structs and utils surface', () => {
    const expected = [
      ...Object.keys(clientModule),
      ...Object.keys(structsModule),
      ...Object.keys(utilsModule),
    ]
    expect(Object.keys(api).sort()).toEqual([...new Set(expected)].sort())

    expect(api.OneBotClient).toBeTypeOf('function')
    expect(api.OnebotApiError).toBeTypeOf('function')
    expect(api.connect).toBeTypeOf('function')
    expect(api.Structs).toBeTypeOf('object')
    expect(api.convertCQCodeToJSON).toBeTypeOf('function')
    expect(api.convertJSONToCQCode).toBeTypeOf('function')
    expect(api.CQCodeDecode).toBeTypeOf('function')
    expect(api.CQCodeEncode).toBeTypeOf('function')
  })

  it('drives a real round trip through the public entry', async () => {
    const server = await TestServer.start()
    servers.push(server)
    server.onFrame = (frame, socket) => {
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 7 }, echo: frame.echo }))
    }

    const bot = await api.connect({
      baseUrl: server.url,
      logger: createMockLogger(),
      reconnection: { enable: false },
    })
    clients.push(bot)

    expect(bot).toBeInstanceOf(api.OneBotClient)
    await expect(bot.get_login_info()).resolves.toEqual({ user_id: 7 })
    await expect(bot.send_msg({ message: [api.Structs.text('hi')] } as any)).resolves.toEqual({
      user_id: 7,
    })
    expect(server.lastFrame).toMatchObject({
      action: 'send_msg',
      params: { message: [{ type: 'text', data: { text: 'hi' } }] },
    })
  })
})
