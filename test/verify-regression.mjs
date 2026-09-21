/**
 * 证明「回归测试真的能抓住这个 bug」：把修复**逐条关掉**（在 reducer.js 的一份临时副本上，
 * 不动生产文件），用同一批场景跑一遍，对照 legacy（修好前）与 fixed（现在）的结果。
 *
 * 跑法：node test/verify-regression.mjs
 */
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_ERROR_TTL_MS,
  DEFAULT_STALE_STICKY_MS,
  WorkIconReducer,
} from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

const SOURCE = fileURLToPath(new URL('../src/reducer.js', import.meta.url))
const LEGACY = fileURLToPath(new URL('../src/__legacy-reducer.verify.mjs', import.meta.url))

/** 把修复逐条改回"修好前"的行为。每一条都是精确字符串替换，改不到就报错（防止静默失效）。 */
function makeLegacy(source) {
  const edits = [
    ['关闭 ERROR 的 TTL 出口', 'const expired = record.stickyTtlMs > 0 && now - record.stickySince >= record.stickyTtlMs', 'const expired = false'],
    ['关闭 WAITING 的"轮已结束"淘汰', 'const turnOver = record.turnActive !== true', 'const turnOver = false'],
    ['关闭 WAITING 的陈旧淘汰', 'const stale = silentMs >= this.staleStickyMs && record.agentStatus !== \'running\'', 'const stale = false'],
    ['关闭一般性陈旧淘汰', 'if (record.turnActive !== true && silentMs >= this.staleStickyMs', 'if (false && record.turnActive !== true && silentMs >= this.staleStickyMs'],
    ['恢复 max-tokens 也算红色故障', 'if (kind === \'max-tokens\') {', 'if (false) {'],
    ['恢复"粘性期间不上屏新活动"', 'if (record.sticky) return this.#render()', 'if (record.sticky) return []'],
    [
      '恢复"粘性期间连工具名都不记"',
      '    if (record.sticky) {\n      record.toolName = name\n      record.activity = activity\n      return this.#render()\n    }',
      '    if (record.sticky) return []',
    ],
    ['关闭"确认清除错误"出口', 'acknowledgeError() {\n    let changed = false', 'acknowledgeError() {\n    return []\n    let changed = false'],
  ]
  let text = source
  for (const [label, from, to] of edits) {
    if (!text.includes(from)) throw new Error(`legacy 补丁失效（找不到锚点）：${label}`)
    text = text.split(from).join(to)
  }
  return text
}

/** 一次性脚本：把副本写成 .mjs 才能被 import（相对 import 仍指向 src/，所以必须放在 src/ 下）。 */
copyFileSync(SOURCE, LEGACY)
writeFileSync(LEGACY, makeLegacy(readFileSync(SOURCE, 'utf8')), 'utf8')
const { WorkIconReducer: LegacyReducer } = await import(new URL(`file://${LEGACY.replace(/\\/gu, '/')}`).href)

const session = (id, extra = {}) => ({ header: { id, cwd: 'C:\\demo', ...extra } })
const sub = (id, parent) => session(id, { origin: 'subagent', parentSession: parent })

function clock(start = 1_000_000) {
  let current = start
  return { now: () => current, advance: (ms) => { current += ms } }
}

/** 每个场景返回"最终聚合状态 + 序列"，legacy 与 fixed 各跑一次。 */
const scenarios = {
  '① 子代理 max-tokens 结束 → 静默': (Reducer) => {
    const c = clock()
    const r = new Reducer({ includeSubagents: true, now: c.now })
    const main = session('main')
    const child = sub('child', 'main')
    r.handle(main, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(main, { type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' } })
    r.handle(child, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(child, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'max-tokens' } } })
    c.advance(2000)
    r.tick()
    return { state: r.snapshot().state, session: r.snapshot().sessionId }
  },
  '② 子代理 error 结束 → 静默超过 TTL': (Reducer) => {
    const c = clock()
    const r = new Reducer({ includeSubagents: true, now: c.now })
    const main = session('main')
    const child = sub('child', 'main')
    r.handle(main, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(main, { type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' } })
    r.handle(child, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(child, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
    c.advance(DEFAULT_ERROR_TTL_MS + 1000)
    r.tick()
    return { state: r.snapshot().state, session: r.snapshot().sessionId }
  },
  '③ 陈旧 ERROR 压制新会话的 WORKING': (Reducer) => {
    const c = clock()
    const r = new Reducer({ includeSubagents: true, now: c.now })
    const stale = session('stale')
    const fresh = session('fresh')
    r.handle(stale, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(stale, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
    c.advance(DEFAULT_STALE_STICKY_MS + 1000)
    r.handle(fresh, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(fresh, { type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' } })
    r.tick()
    return { state: r.snapshot().state, session: r.snapshot().sessionId }
  },
  '④ 粘性期间新活动是否上屏': (Reducer) => {
    const c = clock()
    const r = new Reducer({ now: c.now })
    const s = session('s')
    r.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(s, { type: 'tool/call', seq: 2, data: { name: 'Read', callId: 'c1', arguments: '{"file_path":"a.js"}' } })
    r.handle(s, { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }] } } })
    c.advance(500)
    const messages = r.handle(s, { type: 'tool/call', seq: 4, data: { name: 'pwsh', callId: 'c2', arguments: '{"command":"npm run build"}' } })
    return {
      state: r.snapshot().state,
      新工具名上屏: messages.some((m) => m.kind === 'state' && m.toolName === 'pwsh'),
    }
  },
  '⑤ 人确认（点击/菜单）清除错误': (Reducer) => {
    const c = clock()
    const r = new Reducer({ now: c.now })
    const s = session('s')
    r.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    r.handle(s, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
    const messages = r.acknowledgeError()
    return { state: r.snapshot().state, 确认后产出消息数: messages.length }
  },
}

const rows = []
for (const [name, run] of Object.entries(scenarios)) {
  let legacy
  let fixed
  try {
    legacy = JSON.stringify(run(LegacyReducer))
  } catch (error) {
    legacy = `抛异常：${error.message}`
  }
  fixed = JSON.stringify(run(WorkIconReducer))
  rows.push({ 场景: name, 'legacy（修好前）': legacy, 'fixed（现在）': fixed, 有区别: legacy !== fixed ? '✅ 测试能抓住' : '❌ 抓不住' })
}

console.log('\n=== 回归测试有效性自检（legacy = 把修复逐条关掉后的副本）===')
for (const row of rows) {
  console.log(`\n${row.场景}`)
  console.log(`  legacy（修好前） : ${row['legacy（修好前）']}`)
  console.log(`  fixed（现在）    : ${row['fixed（现在）']}`)
  console.log(`  ${row.有区别}`)
}
const allCaught = rows.every((row) => row.有区别 === '✅ 测试能抓住')
console.log(`\n结论：${allCaught ? '全部 5 个场景都能区分修复前后 ✅' : '有场景无法区分 ❌'}`)
console.log(`（WORKING 期望值参考：${WorkState.WORKING} / ${WorkState.ERROR}）`)

rmSync(LEGACY, { force: true })
process.exit(allCaught ? 0 : 1)
