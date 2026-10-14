/**
 * Sanity-check the artifact that `pnpm publish` actually ships.
 *
 * The unit suite runs against `src/`; npm ships `dist/`. This guard runs in the
 * release workflow *after* `pnpm build` and before `pnpm publish`, so a broken
 * emit — a missing file, an `exports` target that does not exist, an entry that
 * cannot be imported — stops the release instead of reaching the registry.
 *
 * Usage: `pnpm build && pnpm verify:dist`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const problems = []
const check = (condition, message) => {
  if (!condition) problems.push(message)
}

const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'))
const exists = (relative) => existsSync(path.join(root, relative))

const pkg = readJson('package.json')

// 1) `main` / `types` / `exports` 指向的每个文件都必须真的存在。
const entryTargets = new Set([pkg.main, pkg.types].filter(Boolean))
for (const value of Object.values(pkg.exports ?? {})) {
  const targets = typeof value === 'string' ? [value] : Object.values(value ?? {})
  for (const target of targets) if (typeof target === 'string') entryTargets.add(target)
}
for (const target of entryTargets) {
  check(exists(target), `package.json points at a missing file: ${target}`)
}

// 2) src 里的每个模块都要有对应的 .js 和 .d.ts，别悄悄漏掉一个。
const sourceModules = readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.ts'))
for (const file of sourceModules) {
  const base = file.replace(/\.ts$/, '')
  check(exists(`dist/${base}.js`), `missing emit: dist/${base}.js`)
  check(exists(`dist/${base}.d.ts`), `missing declaration: dist/${base}.d.ts`)
}

// 3) 用真正的发布入口跑一遍最小行为，确认 dist 能 import、公开面和源码一致。
const entry = pkg.exports?.['.']?.default ?? pkg.main
const api = await import(pathToFileURL(path.join(root, entry)).href)

const expectedExports = {
  connect: 'function',
  OneBotClient: 'function',
  OnebotApiError: 'function',
  Structs: 'object',
  convertCQCodeToJSON: 'function',
  convertJSONToCQCode: 'function',
  CQCodeDecode: 'function',
  CQCodeEncode: 'function',
}
for (const [name, type] of Object.entries(expectedExports)) {
  check(typeof api[name] === type, `${entry} does not export ${name} as ${type}`)
}

check(
  JSON.stringify(api.convertCQCodeToJSON?.('[CQ:at,qq=1]')) ===
    JSON.stringify([{ type: 'at', data: { qq: '1' } }]),
  `${entry}: convertCQCodeToJSON() returned an unexpected result`,
)
check(
  api.Structs?.image?.(Buffer.from('abc'))?.data?.file === 'base64://YWJj',
  `${entry}: Structs.image() no longer base64-encodes a Buffer`,
)
check(
  api.Structs?.text?.('hi')?.data?.text === 'hi',
  `${entry}: Structs.text() is broken`,
)

const declarations = readFileSync(path.join(root, 'dist/client.d.ts'), 'utf8')
check(declarations.includes('OneBotClient'), 'dist/client.d.ts does not declare OneBotClient')

if (problems.length > 0) {
  console.error('verify-dist: the built package is not releasable')
  for (const problem of problems) console.error(`  x ${problem}`)
  process.exit(1)
}

console.log(
  `verify-dist: ok — ${sourceModules.length} modules emitted, `
    + `${entryTargets.size} entry points resolved, public API imports cleanly from ${entry}`,
)
