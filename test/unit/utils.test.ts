import { describe, expect, it } from 'vitest'
import {
  CQ_TAG_REGEXP,
  CQCodeDecode,
  CQCodeEncode,
  SPLIT,
  convertCQCodeToJSON,
  convertJSONToCQCode,
} from '../../src/utils.js'

describe('SPLIT / CQ_TAG_REGEXP', () => {
  it('splits a CQ string on tag boundaries only', () => {
    expect('hi [CQ:at,qq=1] there'.split(SPLIT)).toEqual(['hi ', '[CQ:at,qq=1]', ' there'])
    expect('[CQ:at,qq=1]'.split(SPLIT)).toEqual(['[CQ:at,qq=1]'])
    expect(''.split(SPLIT)).toEqual([''])
  })

  it('leaves stray brackets in text alone', () => {
    expect('a]b'.split(SPLIT)).toEqual(['a]', 'b'])
  })

  it('only matches a whole tag', () => {
    expect(CQ_TAG_REGEXP.exec('[CQ:at,qq=1]')?.slice(1)).toEqual(['at', 'qq=1'])
    expect(CQ_TAG_REGEXP.exec('[CQ:shake]')?.slice(1)).toEqual(['shake', undefined])
    expect(CQ_TAG_REGEXP.exec('prefix[CQ:at,qq=1]')).toBeNull()
    expect(CQ_TAG_REGEXP.exec('[CQ:At,qq=1]')).toBeNull()
  })
})

describe('convertCQCodeToJSON', () => {
  it('returns a single text segment for an empty string', () => {
    expect(convertCQCodeToJSON('')).toEqual([{ type: 'text', data: { text: '' } }])
  })

  it('parses a tag with a key/value body', () => {
    expect(convertCQCodeToJSON('[CQ:at,qq=1]')).toEqual([{ type: 'at', data: { qq: '1' } }])
    expect(convertCQCodeToJSON('[CQ:face,id=172]')).toEqual([{ type: 'face', data: { id: '172' } }])
  })

  it('parses a valueless tag into an empty data bag', () => {
    expect(convertCQCodeToJSON('[CQ:shake]')).toEqual([{ type: 'shake', data: {} }])
  })

  it('keeps surrounding text as text segments', () => {
    expect(convertCQCodeToJSON('hi [CQ:at,qq=1] there')).toEqual([
      { type: 'text', data: { text: 'hi ' } },
      { type: 'at', data: { qq: '1' } },
      { type: 'text', data: { text: ' there' } },
    ])
  })

  it('parses several adjacent tags', () => {
    expect(convertCQCodeToJSON('[CQ:at,qq=1][CQ:face,id=172]')).toEqual([
      { type: 'at', data: { qq: '1' } },
      { type: 'face', data: { id: '172' } },
    ])
  })

  it('decodes escapes after splitting, so &#44; is not a separator', () => {
    expect(convertCQCodeToJSON('[CQ:at,qq=1&#44;2]')).toEqual([{ type: 'at', data: { qq: '1,2' } }])
    expect(convertCQCodeToJSON('[CQ:text,text=&#91;x&#93;]')).toEqual([
      { type: 'text', data: { text: '[x]' } },
    ])
    expect(convertCQCodeToJSON('[CQ:text,text=a&amp;b]')).toEqual([
      { type: 'text', data: { text: 'a&b' } },
    ])
  })

  it('splits key/value on the first = only', () => {
    expect(convertCQCodeToJSON('[CQ:image,file=a.png,url=https://x.com/?a=b]')).toEqual([
      { type: 'image', data: { file: 'a.png', url: 'https://x.com/?a=b' } },
    ])
  })

  it('turns a body item without = into an empty-string value', () => {
    expect(convertCQCodeToJSON('[CQ:foo,bar]')).toEqual([{ type: 'foo', data: { bar: '' } }])
  })

  it('splits unescaped ] in plain text into separate text segments', () => {
    expect(convertCQCodeToJSON('a]b')).toEqual([
      { type: 'text', data: { text: 'a]' } },
      { type: 'text', data: { text: 'b' } },
    ])
  })
})

describe('convertJSONToCQCode', () => {
  it('emits the bare text for a text segment', () => {
    expect(convertJSONToCQCode({ type: 'text', data: { text: 'hi' } })).toBe('hi')
  })

  it('serialises an array by concatenation', () => {
    expect(
      convertJSONToCQCode([
        { type: 'text', data: { text: 'hi' } },
        { type: 'at', data: { qq: '1' } },
      ]),
    ).toBe('hi[CQ:at,qq=1]')
  })

  it('omits falsy values and keeps truthy ones', () => {
    expect(convertJSONToCQCode({ type: 'image', data: { file: '', summary: 's', n: 0 } })).toBe(
      '[CQ:image,summary=s]',
    )
  })

  it('serialises a segment without data as a bare tag', () => {
    expect(convertJSONToCQCode({ type: 'shake', data: {} })).toBe('[CQ:shake]')
  })
})

describe('CQCodeDecode', () => {
  it('restores the four escapes', () => {
    expect(CQCodeDecode('&#44;&#91;&#93;&amp;')).toBe(',[]&')
  })

  it('stringifies non-strings and maps empty-ish values to an empty string', () => {
    expect(CQCodeDecode(123)).toBe('123')
    expect(CQCodeDecode(null)).toBe('')
    expect(CQCodeDecode(undefined)).toBe('')
    expect(CQCodeDecode(0)).toBe('')
    expect(CQCodeDecode({})).toBe('[object Object]')
  })
})

describe('CQCodeEncode', () => {
  it('escapes the four reserved characters', () => {
    // `&` 的替换排在最后，所以它把前面生成的实体里的 `&` 也一起换掉了。
    expect(CQCodeEncode('a,b[c]d')).toBe('a&amp;#44;b&amp;#91;c&amp;#93;d')
  })

  it('does not round-trip: the & pass re-escapes the escapes it just produced', () => {
    // 已知缺陷（未在本任务中修改库行为）：`&` 最后才替换，于是前面插入的 `&#44;`
    // 里的 `&` 也被换成 `&amp;`，encode→decode 得到的是 `&#44;` 而不是 `,`。
    expect(CQCodeEncode(',')).toBe('&amp;#44;')
    expect(CQCodeDecode(CQCodeEncode(','))).toBe('&#44;')
  })

  it('escapes a bare ampersand', () => {
    expect(CQCodeEncode('a&b')).toBe('a&amp;b')
  })
})
