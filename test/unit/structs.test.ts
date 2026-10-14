import { describe, expect, it } from 'vitest'
import { Structs } from '../../src/structs.js'

describe('Structs', () => {
  it('text', () => {
    expect(Structs.text('hello')).toEqual({ type: 'text', data: { text: 'hello' } })
  })

  it('at', () => {
    expect(Structs.at(123)).toEqual({ type: 'at', data: { qq: '123' } })
    expect(Structs.at('456')).toEqual({ type: 'at', data: { qq: '456' } })
    expect(Structs.at('all')).toEqual({ type: 'at', data: { qq: 'all' } })
  })

  it('reply', () => {
    expect(Structs.reply(1)).toEqual({ type: 'reply', data: { id: '1' } })
    expect(Structs.reply('2')).toEqual({ type: 'reply', data: { id: '2' } })
  })

  it('face', () => {
    expect(Structs.face(172)).toEqual({ type: 'face', data: { id: '172' } })
  })

  it('mface', () => {
    expect(Structs.mface(1, '2', 'key')).toEqual({
      type: 'mface',
      data: { summary: undefined, emoji_id: '1', emoji_package_id: '2', key: 'key' },
    })
    expect(Structs.mface(1, '2', 'key', 'sum')).toEqual({
      type: 'mface',
      data: { summary: 'sum', emoji_id: '1', emoji_package_id: '2', key: 'key' },
    })
  })

  it('image', () => {
    expect(Structs.image('a.png')).toEqual({
      type: 'image',
      data: { file: 'a.png', summary: undefined, sub_type: undefined },
    })
    expect(Structs.image('a.png', 'sum', 1)).toEqual({
      type: 'image',
      data: { file: 'a.png', summary: 'sum', sub_type: '1' },
    })
    expect(Structs.image('a.png', 'sum', 'flash')).toEqual({
      type: 'image',
      data: { file: 'a.png', summary: 'sum', sub_type: 'flash' },
    })
    expect(Structs.image(Buffer.from('abc'))).toEqual({
      type: 'image',
      data: { file: 'base64://YWJj', summary: undefined, sub_type: undefined },
    })
  })

  it('file', () => {
    expect(Structs.file('a.txt')).toEqual({
      type: 'file',
      data: { file: 'a.txt', name: undefined },
    })
    expect(Structs.file('a.txt', 'n')).toEqual({ type: 'file', data: { file: 'a.txt', name: 'n' } })
    expect(Structs.file(Buffer.from('abc'))).toEqual({
      type: 'file',
      data: { file: 'base64://YWJj', name: undefined },
    })
  })

  it('video', () => {
    expect(Structs.video('a.mp4')).toEqual({
      type: 'video',
      data: { file: 'a.mp4', name: undefined, thumb: undefined },
    })
    expect(Structs.video('a.mp4', 'n', 't.png')).toEqual({
      type: 'video',
      data: { file: 'a.mp4', name: 'n', thumb: 't.png' },
    })
    expect(Structs.video(Buffer.from('abc'))).toEqual({
      type: 'video',
      data: { file: 'base64://YWJj', name: undefined, thumb: undefined },
    })
  })

  it('record', () => {
    expect(Structs.record('a.silk')).toEqual({
      type: 'record',
      data: { file: 'a.silk', name: undefined, thumb: undefined },
    })
    expect(Structs.record('a.silk', 'n', 't.png')).toEqual({
      type: 'record',
      data: { file: 'a.silk', name: 'n', thumb: 't.png' },
    })
    expect(Structs.record(Buffer.from('abc'))).toEqual({
      type: 'record',
      data: { file: 'base64://YWJj', name: undefined, thumb: undefined },
    })
  })

  it('json', () => {
    expect(Structs.json('{"a":1}')).toEqual({ type: 'json', data: { data: '{"a":1}' } })
  })

  it('dice / rps', () => {
    expect(Structs.dice()).toEqual({ type: 'dice', data: {} })
    expect(Structs.rps()).toEqual({ type: 'rps', data: {} })
  })

  it('markdown', () => {
    expect(Structs.markdown('# hi')).toEqual({ type: 'markdown', data: { content: '# hi' } })
  })

  it('music', () => {
    expect(Structs.music('qq', 100)).toEqual({ type: 'music', data: { type: 'qq', id: '100' } })
  })

  it('customMusic', () => {
    expect(Structs.customMusic('custom', 'https://x', 'https://i')).toEqual({
      type: 'music',
      data: {
        type: 'custom',
        url: 'https://x',
        audio: undefined,
        title: undefined,
        image: 'https://i',
        singer: undefined,
      },
    })
    expect(Structs.customMusic('163', 'u', 'i', 'a', 't', 's')).toEqual({
      type: 'music',
      data: { type: '163', url: 'u', audio: 'a', title: 't', image: 'i', singer: 's' },
    })
  })

  it('node', () => {
    expect(Structs.node(1)).toEqual({
      type: 'node',
      data: {
        id: '1',
        user_id: undefined,
        nickname: undefined,
        source: undefined,
        news: undefined,
        summary: undefined,
        prompt: undefined,
        time: undefined,
      },
    })
    expect(Structs.node(1, 2, 'nick', 'src', [{ text: 'n' }], 'sum', 'prompt', 123)).toEqual({
      type: 'node',
      data: {
        id: '1',
        user_id: '2',
        nickname: 'nick',
        source: 'src',
        news: [{ text: 'n' }],
        summary: 'sum',
        prompt: 'prompt',
        time: '123',
      },
    })
    expect(Structs.node('1', '2')).toEqual({
      type: 'node',
      data: {
        id: '1',
        user_id: '2',
        nickname: undefined,
        source: undefined,
        news: undefined,
        summary: undefined,
        prompt: undefined,
        time: undefined,
      },
    })
  })

  it('customNode', () => {
    const content = [Structs.text('hi')]
    expect(Structs.customNode(content)).toEqual({
      type: 'node',
      data: {
        content,
        user_id: undefined,
        nickname: undefined,
        source: undefined,
        news: undefined,
        summary: undefined,
        prompt: undefined,
        time: undefined,
      },
    })
    expect(Structs.customNode(content, 2, 'nick', 'src', [{ text: 'n' }], 'sum', 'prompt', '123')).toEqual({
      type: 'node',
      data: {
        content,
        user_id: '2',
        nickname: 'nick',
        source: 'src',
        news: [{ text: 'n' }],
        summary: 'sum',
        prompt: 'prompt',
        time: '123',
      },
    })
  })

  it('forward', () => {
    expect(Structs.forward(42)).toEqual({ type: 'forward', data: { id: '42' } })
  })

  it('contact', () => {
    expect(Structs.contact('group', 5)).toEqual({ type: 'contact', data: { type: 'group', id: '5' } })
    expect(Structs.contact('qq', '6')).toEqual({ type: 'contact', data: { type: 'qq', id: '6' } })
  })
})
