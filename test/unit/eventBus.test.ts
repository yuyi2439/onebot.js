import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OneBotClientBase } from '../../src/clientBase.js'
import { EventBus } from '../../src/eventBus.js'
import { createMockLogger, type MockLogger } from '../helpers/index.js'

type AnyRecord = Record<string, any>

let logger: MockLogger
let send: ReturnType<typeof vi.fn>
let sent: Array<{ action: string; params: AnyRecord }>
let bus: EventBus

beforeEach(() => {
  logger = createMockLogger()
  sent = []
  send = vi.fn((action: string, params: AnyRecord) => {
    sent.push({ action, params })
    return Promise.resolve({})
  })
  bus = new EventBus({ send } as unknown as OneBotClientBase, logger)
})

/** Replace `emit` with a recorder; every bubble step shows up in the result. */
function recordEmit() {
  const emitted: Array<{ event: string; context: any }> = []
  const original = bus.emit.bind(bus)
  bus.emit = ((event: string, context: any) => {
    emitted.push({ event, context })
    return original(event as any, context)
  }) as typeof bus.emit
  return emitted
}

function eventNames(emitted: Array<{ event: string }>) {
  return emitted.map((item) => item.event)
}

describe('EventBus subscription bookkeeping', () => {
  it('on() registers once and returns the bus', () => {
    const handler = vi.fn()
    expect(bus.on('message.group.normal' as any, handler as any)).toBe(bus)
    bus.on('message.group.normal' as any, handler as any)
    bus.emit('message.group.normal' as any, { id: 1 } as any)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ id: 1 })
  })

  it('off() removes a handler and tolerates unknown ones', () => {
    const handler = vi.fn()
    bus.on('notice.friend_add' as any, handler as any)
    expect(bus.off('notice.friend_add' as any, handler as any)).toBe(bus)
    bus.emit('notice.friend_add' as any, {} as any)
    expect(handler).not.toHaveBeenCalled()

    // 未注册过的 handler / 未注册过的事件名都只是空操作。
    expect(() => bus.off('notice.friend_add' as any, handler as any)).not.toThrow()
    expect(() => bus.off('never.heard.of' as any, handler as any)).not.toThrow()
  })

  it('once() fires a single time and unregisters itself', () => {
    const handler = vi.fn()
    expect(bus.once('message' as any, handler as any)).toBe(bus)
    bus.emit('message' as any, { n: 1 } as any)
    bus.emit('message' as any, { n: 2 } as any)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ n: 1 })
  })

  it('subscribe() returns a working unsubscribe handle', () => {
    const handler = vi.fn()
    const off = bus.subscribe('request.friend' as any, handler as any)
    bus.emit('request.friend' as any, {} as any)
    off()
    bus.emit('request.friend' as any, {} as any)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(() => off()).not.toThrow()
  })

  it('subscribeOnce() fires once and can be cancelled beforehand', () => {
    const handler = vi.fn()
    const off = bus.subscribeOnce('notice.group_recall' as any, handler as any)
    bus.emit('notice.group_recall' as any, { a: 1 } as any)
    bus.emit('notice.group_recall' as any, { a: 2 } as any)
    expect(handler).toHaveBeenCalledTimes(1)

    const cancelled = vi.fn()
    const off2 = bus.subscribeOnce('notice.group_recall' as any, cancelled as any)
    off2()
    bus.emit('notice.group_recall' as any, {} as any)
    expect(cancelled).not.toHaveBeenCalled()
    expect(() => off()).not.toThrow()
    expect(() => off2()).not.toThrow()
  })

  it('emit() bubbles a dotted event up to each parent, innermost first', () => {
    const order: string[] = []
    bus.on('message' as any, () => order.push('message'))
    bus.on('message.group' as any, () => order.push('message.group'))
    bus.on('message.group.normal' as any, () => order.push('message.group.normal'))

    expect(bus.emit('message.group.normal' as any, {} as any)).toBe(true)
    expect(order).toEqual(['message.group.normal', 'message.group', 'message'])
  })

  it('emit() on an undotted event does not recurse', () => {
    const handler = vi.fn()
    bus.on('socket' as any, handler as any)
    expect(bus.emit('socket' as any, {} as any)).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('EventBus.parseMessage dispatch tree', () => {
  const CASES: Array<[string, AnyRecord, string[]]> = [
    // ---- meta_event ----
    ['lifecycle connect', { post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect' }, ['meta_event.lifecycle.connect', 'meta_event.lifecycle', 'meta_event']],
    ['lifecycle enable', { post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'enable' }, ['meta_event.lifecycle.enable', 'meta_event.lifecycle', 'meta_event']],
    ['lifecycle disable', { post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'disable' }, ['meta_event.lifecycle.disable', 'meta_event.lifecycle', 'meta_event']],
    ['heartbeat', { post_type: 'meta_event', meta_event_type: 'heartbeat' }, ['meta_event.heartbeat', 'meta_event']],
    // ---- message ----
    ['private friend', { post_type: 'message', message_type: 'private', sub_type: 'friend' }, ['message.private.friend', 'message.private', 'message']],
    ['private group', { post_type: 'message', message_type: 'private', sub_type: 'group' }, ['message.private.group', 'message.private', 'message']],
    ['group normal', { post_type: 'message', message_type: 'group', sub_type: 'normal' }, ['message.group.normal', 'message.group', 'message']],
    // ---- message_sent ----
    ['sent private friend', { post_type: 'message_sent', message_type: 'private', sub_type: 'friend' }, ['message_sent.private.friend', 'message_sent.private', 'message_sent']],
    ['sent private group', { post_type: 'message_sent', message_type: 'private', sub_type: 'group' }, ['message_sent.private.group', 'message_sent.private', 'message_sent']],
    ['sent group normal', { post_type: 'message_sent', message_type: 'group', sub_type: 'normal' }, ['message_sent.group.normal', 'message_sent.group', 'message_sent']],
    // ---- request ----
    ['request friend', { post_type: 'request', request_type: 'friend' }, ['request.friend', 'request']],
    ['request group add', { post_type: 'request', request_type: 'group', sub_type: 'add' }, ['request.group.add', 'request.group', 'request']],
    ['request group invite', { post_type: 'request', request_type: 'group', sub_type: 'invite' }, ['request.group.invite', 'request.group', 'request']],
    // ---- notice: flat ----
    ['notice bot_offline', { post_type: 'notice', notice_type: 'bot_offline' }, ['notice.bot_offline', 'notice']],
    ['notice friend_add', { post_type: 'notice', notice_type: 'friend_add' }, ['notice.friend_add', 'notice']],
    ['notice friend_recall', { post_type: 'notice', notice_type: 'friend_recall' }, ['notice.friend_recall', 'notice']],
    ['notice group_card', { post_type: 'notice', notice_type: 'group_card' }, ['notice.group_card', 'notice']],
    ['notice group_recall', { post_type: 'notice', notice_type: 'group_recall' }, ['notice.group_recall', 'notice']],
    ['notice group_upload', { post_type: 'notice', notice_type: 'group_upload' }, ['notice.group_upload', 'notice']],
    ['notice group_msg_emoji_like', { post_type: 'notice', notice_type: 'group_msg_emoji_like' }, ['notice.group_msg_emoji_like', 'notice']],
    // ---- notice: nested ----
    ['notice group_admin set', { post_type: 'notice', notice_type: 'group_admin', sub_type: 'set' }, ['notice.group_admin.set', 'notice.group_admin', 'notice']],
    ['notice group_admin unset', { post_type: 'notice', notice_type: 'group_admin', sub_type: 'unset' }, ['notice.group_admin.unset', 'notice.group_admin', 'notice']],
    ['notice group_ban ban', { post_type: 'notice', notice_type: 'group_ban', sub_type: 'ban' }, ['notice.group_ban.ban', 'notice.group_ban', 'notice']],
    ['notice group_ban lift_ban', { post_type: 'notice', notice_type: 'group_ban', sub_type: 'lift_ban' }, ['notice.group_ban.lift_ban', 'notice.group_ban', 'notice']],
    ['notice group_decrease leave', { post_type: 'notice', notice_type: 'group_decrease', sub_type: 'leave' }, ['notice.group_decrease.leave', 'notice.group_decrease', 'notice']],
    ['notice group_decrease kick', { post_type: 'notice', notice_type: 'group_decrease', sub_type: 'kick' }, ['notice.group_decrease.kick', 'notice.group_decrease', 'notice']],
    ['notice group_decrease kick_me', { post_type: 'notice', notice_type: 'group_decrease', sub_type: 'kick_me' }, ['notice.group_decrease.kick_me', 'notice.group_decrease', 'notice']],
    ['notice essence add', { post_type: 'notice', notice_type: 'essence', sub_type: 'add' }, ['notice.essence.add', 'notice.essence', 'notice']],
    ['notice essence delete', { post_type: 'notice', notice_type: 'essence', sub_type: 'delete' }, ['notice.essence.delete', 'notice.essence', 'notice']],
    ['notice group_increase approve', { post_type: 'notice', notice_type: 'group_increase', sub_type: 'approve' }, ['notice.group_increase.approve', 'notice.group_increase', 'notice']],
    ['notice group_increase invite', { post_type: 'notice', notice_type: 'group_increase', sub_type: 'invite' }, ['notice.group_increase.invite', 'notice.group_increase', 'notice']],
    ['notice notify group_name', { post_type: 'notice', notice_type: 'notify', sub_type: 'group_name' }, ['notice.notify.group_name', 'notice.notify', 'notice']],
    ['notice notify title', { post_type: 'notice', notice_type: 'notify', sub_type: 'title' }, ['notice.notify.title', 'notice.notify', 'notice']],
    ['notice notify profile_like', { post_type: 'notice', notice_type: 'notify', sub_type: 'profile_like' }, ['notice.notify.profile_like', 'notice.notify', 'notice']],
    ['notice notify input_status group', { post_type: 'notice', notice_type: 'notify', sub_type: 'input_status', group_id: 7 }, ['notice.notify.input_status.group', 'notice.notify.input_status', 'notice.notify', 'notice']],
    ['notice notify input_status friend', { post_type: 'notice', notice_type: 'notify', sub_type: 'input_status', group_id: 0 }, ['notice.notify.input_status.friend', 'notice.notify.input_status', 'notice.notify', 'notice']],
    ['notice notify poke group', { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id: 7 }, ['notice.notify.poke.group', 'notice.notify.poke', 'notice.notify', 'notice']],
    ['notice notify poke friend', { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', user_id: 7 }, ['notice.notify.poke.friend', 'notice.notify.poke', 'notice.notify', 'notice']],
  ]

  it.each(CASES)('%s', (_name, payload, expected) => {
    const emitted = recordEmit()
    expect(bus.parseMessage(payload as any)).toBe(true)
    expect(eventNames(emitted)).toEqual(expected)
    expect(emitted.at(-1)?.context).toBe(payload)
  })

  it('returns false only for an unrecognised post_type', () => {
    const emitted = recordEmit()
    expect(bus.parseMessage({ post_type: 'bogus' } as any)).toBe(false)
    expect(emitted).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('[eventBus]', 'unknown post_type: bogus')
  })

  // 注意：parseMessage 的返回值只反映 post_type 认没认出来，嵌套类型不认识时
  // 内层返回 false，但外层仍然返回 true（见下面每条用例的注释）。
  const UNKNOWN: Array<[string, AnyRecord, string]> = [
    ['meta_event_type', { post_type: 'meta_event', meta_event_type: 'bogus' }, 'unknown meta_event_type: bogus'],
    ['lifecycle sub_type', { post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'bogus' }, 'unknown meta_event.lifecycle_type: bogus'],
    ['message_type', { post_type: 'message', message_type: 'bogus' }, 'unknown message_type: bogus'],
    ['private sub_type', { post_type: 'message', message_type: 'private', sub_type: 'bogus' }, 'unknown message_private_type: bogus'],
    ['group sub_type', { post_type: 'message', message_type: 'group', sub_type: 'bogus' }, 'unknown message_group_type: bogus'],
    ['sent message_type', { post_type: 'message_sent', message_type: 'bogus' }, 'unknown message_sent_type: bogus'],
    ['sent private sub_type', { post_type: 'message_sent', message_type: 'private', sub_type: 'bogus' }, 'unknown message_sent_private_type: bogus'],
    ['sent group sub_type', { post_type: 'message_sent', message_type: 'group', sub_type: 'bogus' }, 'unknown message_sent_group_type: bogus'],
    ['request_type', { post_type: 'request', request_type: 'bogus' }, 'unknown request_type: bogus'],
    ['request group sub_type', { post_type: 'request', request_type: 'group', sub_type: 'bogus' }, 'unknown request_group_type: bogus'],
    ['notice_type', { post_type: 'notice', notice_type: 'bogus' }, 'unknown notice_type: bogus'],
    ['group_admin sub_type', { post_type: 'notice', notice_type: 'group_admin', sub_type: 'bogus' }, 'unknown notice_group_admin_type: bogus'],
    ['group_ban sub_type', { post_type: 'notice', notice_type: 'group_ban', sub_type: 'bogus' }, 'unknown notice_group_ban_type: bogus'],
    ['group_decrease sub_type', { post_type: 'notice', notice_type: 'group_decrease', sub_type: 'bogus' }, 'unknown notice_group_decrease_type: bogus'],
    ['group_increase sub_type', { post_type: 'notice', notice_type: 'group_increase', sub_type: 'bogus' }, 'unknown notice_group_increase_type: bogus'],
    ['essence sub_type', { post_type: 'notice', notice_type: 'essence', sub_type: 'bogus' }, 'unknown notice_essence_type: bogus'],
    ['notify sub_type', { post_type: 'notice', notice_type: 'notify', sub_type: 'bogus' }, 'unknown notice_notify_type: bogus'],
  ]

  it.each(UNKNOWN)('warns about an unknown %s without emitting', (_name, payload, message) => {
    const emitted = recordEmit()
    expect(bus.parseMessage(payload as any)).toBe(true)
    expect(emitted).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('[eventBus]', message)
  })
})

describe('EventBus quick_action helpers', () => {
  it('attaches quick_action to a private message and replies through the client', async () => {
    const json: AnyRecord = { post_type: 'message', message_type: 'private', sub_type: 'friend' }
    bus.parseMessage(json as any)

    const reply = [{ type: 'text', data: { text: 'hi' } }]
    await json.quick_action(reply)

    expect(sent).toEqual([
      { action: '.handle_quick_operation', params: { context: json, operation: { reply } } },
    ])
  })

  it('attaches quick_action to a group message with at_sender', async () => {
    const json: AnyRecord = { post_type: 'message', message_type: 'group', sub_type: 'normal' }
    bus.parseMessage(json as any)

    const reply = [{ type: 'text', data: { text: 'hi' } }]
    await json.quick_action(reply, true)

    expect(sent).toEqual([
      { action: '.handle_quick_operation', params: { context: json, operation: { reply, at_sender: true } } },
    ])
  })

  it('attaches quick_action to a friend request', async () => {
    const json: AnyRecord = { post_type: 'request', request_type: 'friend' }
    bus.parseMessage(json as any)

    await json.quick_action(true)

    expect(sent).toEqual([
      { action: '.handle_quick_operation', params: { context: json, operation: { approve: true } } },
    ])
  })

  it('attaches quick_action to a group request with a reason', async () => {
    const json: AnyRecord = { post_type: 'request', request_type: 'group', sub_type: 'add' }
    bus.parseMessage(json as any)

    await json.quick_action(false, 'nope')

    expect(sent).toEqual([
      {
        action: '.handle_quick_operation',
        params: { context: json, operation: { approve: false, reason: 'nope' } },
      },
    ])
  })
})
