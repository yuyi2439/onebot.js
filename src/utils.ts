import type { Receive, SendMessageSegment, UnSafeStruct } from './structs.js'

const getTime = () => new Date().toLocaleString()

export const logger = {
  warn: (...args: any[]) => {
    console.warn(`[${getTime()}]`, ...args)
  },
  debug: (...args: any[]) => {
    console.debug(`[${getTime()}]`, ...args)
  },
  dir: (json: any) => {
    console.dir(json, { depth: null })
  },
}

export const SPLIT = /(?=\[CQ:)|(?<=])/
export const CQ_TAG_REGEXP = /^\[CQ:([a-z]+)(?:,([^\]]+))?]$/

/**
 * CQ码转JSON
 *
 * 必须先按原始（仍带转义）字符串切分，再对各部分分别 decode：
 * 若先整体 decode，`&#44;` 会被还原成 `,` 而被当作分隔符切断，
 * `&#91;`/`&#93;` 还原成 `[`/`]` 后还可能拼出假的 CQ 码。
 */
export function convertCQCodeToJSON(msg: string): Receive[keyof Receive][] | SendMessageSegment[] {
  return msg
    .split(SPLIT)
    .map((tagStr) => {
      const match = CQ_TAG_REGEXP.exec(tagStr)
      if (match === null) return { type: 'text', data: { text: CQCodeDecode(tagStr) } }

      const [, tagName, value] = match
      if (value === undefined) return { type: tagName, data: {} }

      // 键值只按第一个 `=` 切分（值里可能含 `=`，如 url=https://x?a=b），
      // 之后再对键、值分别 decode，还原 `&#44;` 等转义。
      const data = Object.fromEntries(
        value.split(',').map((item) => {
          const eq = item.indexOf('=')
          if (eq < 0) return [CQCodeDecode(item), '']
          return [CQCodeDecode(item.slice(0, eq)), CQCodeDecode(item.slice(eq + 1))]
        }),
      )
      return { type: tagName, data }
    }) as Receive[keyof Receive][] | SendMessageSegment[]
}

const _conver = (json: any) => {
  if (json.type === 'text') return json.data.text
  return `[CQ:${json.type}${Object.entries(json.data)
    .map(([k, v]) => (v ? `,${k}=${v}` : ''))
    .join('')}]`
}

/**
 * JSON转CQ码
 */
export function convertJSONToCQCode(json: UnSafeStruct | UnSafeStruct[]): string {
  if (Array.isArray(json)) {
    return json.map((item) => _conver(item)).join('')
  } else {
    return _conver(json)
  }
}

export function CQCodeDecode(str: string | any): string {
  if (typeof str !== 'string') return String(str || '') // 尝试转换为字符串，或返回空字符串
  return str
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&')
}

export function CQCodeEncode(str: string): string {
  return str
    .replace(/,/g, '&#44;')
    .replace(/\[/g, '&#91;')
    .replace(/]/g, '&#93;')
    .replace(/&/g, '&amp;')
}
