/**
 * 【第一步：先量，再改】多根会话并存时的现状实测探针。
 *
 * 目的（不是测试，是测量）：
 *   1. token / 花费 / 工具数 / 轮数 / 耗时 / 上下文 这六个量，两个根会话并存时**各自实际取的是谁**；
 *   2. 图标 state 在两个会话轮流活动时**实际怎么跳**，以及跳由什么驱动。
 *
 * 做法：**喂合成事件序列**（直接向 reducer 投 DSH 事件），不需要真的开两个会话。
 * 运行：node test/measure-multisession.mjs
 */

import { WorkIconReducer, STATE_RANK } from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

// ── 可控时钟 ───────────────────────────────────────────────────────────────
let t = 1_700_000_000_000
const now = () => t
const tick = (ms = 1000) => { t += ms; return t }

// ── 合成会话 ───────────────────────────────────────────────────────────────
const session = (id) => ({ header: { id, cwd: 'C:\\Users\\david\\Desktop\\构建\\demo' } })
const A = session('root-a')
const B = session('root-b')

const USAGE = (input, cacheRead = 0, cacheWrite = 0, output = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
})

const toolCall = (callId, name, args, seq) => ({
  type: 'tool/call', seq, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
})
const toolResult = (callId, seq, isError = false) => ({
  type: 'tool/result', seq, data: { callId, message: { content: [{ isError }] } },
})
const usageMsg = (input, seq, extra = {}) => ({
  type: 'assistant/message',
  seq,
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage: USAGE(input, 0, 0, 10), ...extra },
})
const usageChunk = (seq) => ({ type: 'assistant/chunk', seq, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: USAGE(1) } } })

const reducer = new WorkIconReducer({ now, successTtlMs: 2500, errorTtlMs: 20000, toolErrorTtlMs: 5000 })
reducer.setCapabilities(['todos', 'cost', 'progress', 'context', 'subagents', 'sessions', 'text'])

// ── 记录器 ─────────────────────────────────────────────────────────────────
const emittedStates = []
const rows = []

function probe(label) {
  const snap = reducer.snapshot()
  const msg = reducer.currentStateMessage()
  const candidates = [...reducer.sessions.values()]
    .sort((l, r) => (STATE_RANK[r.state] ?? 0) - (STATE_RANK[l.state] ?? 0) || r.updatedAt - l.updatedAt)
    .map((r) => `${r.id}=${r.state}(rank ${STATE_RANK[r.state] ?? 0},updatedAt ${r.updatedAt})`)
  rows.push({
    label,
    tMs: t - 1_700_000_000_000,
    iconState: msg.state,
    focusSession: snap.sessionId,
    candidates: candidates.join(' | '),
    tokens: msg.tokens?.total,
    costKey: typeof msg.cost?.cost?.CNY === 'number' ? msg.cost.cost.CNY : msg.cost?.status,
    toolCalls: msg.metrics?.toolCalls,
    turns: msg.metrics?.turns,
    elapsedMs: msg.elapsedMs,
    ctxUsed: msg.context?.used,
    ctxLimit: msg.context?.limit,
    plan: msg.progress?.applicable === true ? `${msg.progress.done}/${msg.progress.total}` : `n/a:${msg.progress?.reason}`,
  })
}

function feed(s, event) {
  tick()
  const messages = reducer.handle(s, event)
  for (const m of messages) if (m.kind === 'state') emittedStates.push({ tMs: t - 1_700_000_000_000, state: m.state, session: m.session })
  return messages
}

/** 模拟宿主 1s 一次的 refreshCost：跨**全部会话**收集 id 集合并求和（= 修复后的宿主口径）。 */
const FAKE_LEDGER = { 'root-a': 1.23, 'root-b': 4.56 }
function refreshCostLikeHost() {
  const ids = reducer.costSessionIds()
  let sum = 0
  for (const id of ids) sum += FAKE_LEDGER[id] ?? 0
  const changed = reducer.setCost({ status: 'ok', cost: { CNY: sum }, priced: 1, unpriced: 0 })
  return { ids, sum, changed }
}

// ══ 场景：两个根会话轮流干活 ═══════════════════════════════════════════════

console.log('══ A 先开跑 ═════════════════════════════════════════════════')
feed(A, { type: 'turn/start', seq: 1, data: { turn: 1 } })
feed(A, { type: 'session/title', seq: 2, data: { title: '会话 A' } })
feed(A, { type: 'request/context', seq: 3, data: { provider: 'deepseek', model: 'm', contextWindow: 200000 } })
feed(A, { type: 'assistant/message', seq: 4, data: { turn: 1, step: 1, message: {}, usage: USAGE(100000, 50000) } })
feed(A, toolCall('a1', 'pwsh', { command: 'npm test' }, 5))
console.log('A 花费（模拟宿主）：', JSON.stringify(refreshCostLikeHost()))
probe('A 在跑（B 未出现）')

console.log('\n══ B 也开跑（A 仍在跑）═══════════════════════════════════════')
feed(B, { type: 'turn/start', seq: 1, data: { turn: 1 } })
feed(B, { type: 'session/title', seq: 2, data: { title: '会话 B' } })
feed(B, { type: 'request/context', seq: 3, data: { provider: 'deepseek', model: 'm', contextWindow: 1000000 } })
feed(B, { type: 'assistant/message', seq: 4, data: { turn: 1, step: 1, message: {}, usage: USAGE(2000) } })
feed(B, toolCall('b1', 'Write', { file_path: 'x.js' }, 5))
console.log('B 花费（模拟宿主）：', JSON.stringify(refreshCostLikeHost()))
probe('B 刚动过（A、B 都在跑）')

console.log('\n══ 两边轮流动（这就是"抢夺"的现场）═════════════════════════')
for (let round = 0; round < 3; round += 1) {
  feed(A, toolResult('a1', 10 + round * 4))
  tick(500)
  feed(A, toolCall('a1', 'pwsh', { command: 'npm test' }, 11 + round * 4))
  tick(500)
  feed(B, toolResult('b1', 10 + round * 4))
  tick(500)
  feed(B, toolCall('b1', 'Write', { file_path: 'x.js' }, 11 + round * 4))
  tick(500)
  refreshCostLikeHost()
  probe(`轮流第 ${round + 1} 轮结束（B 最近动过）`)
  feed(A, toolResult('a1', 20 + round * 4))
  tick(500)
  feed(A, toolCall('a1', 'pwsh', { command: 'npm test' }, 21 + round * 4))
  tick(500)
  refreshCostLikeHost()
  probe(`轮流第 ${round + 1} 轮（A 最近动过）`)
}

console.log('\n══ 一个等待输入、另一个在跑 ═════════════════════════════════')
feed(B, { type: 'approval/asked', seq: 90, data: { id: 'ap1', toolName: 'Bash' } })
probe('B 等待输入（A 仍在跑）')

console.log('\n══ 等待被处理，回到都在跑 ═══════════════════════════════════')
feed(B, { type: 'approval/decided', seq: 91, data: { id: 'ap1', outcome: 'approved' } })
probe('B 等待解除（A、B 都在跑）')

console.log('\n══ B 结束回合（SUCCESS 闪光）═════════════════════════════════')
feed(B, { type: 'turn/end', seq: 92, data: { turn: 1, reason: { kind: 'completed' } } })
probe('B 刚完成（A 仍在跑）')

// ── 输出表格 ───────────────────────────────────────────────────────────────
console.log('\n\n═══ 六量逐项实测（每一行 = 那一刻图标载荷里**实际**的值）═══\n')
const cols = ['label', 'tMs', 'iconState', 'focusSession', 'tokens', 'costKey', 'toolCalls', 'turns', 'elapsedMs', 'ctxUsed', 'ctxLimit', 'plan']
const widths = {}
for (const c of cols) widths[c] = Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
console.log(cols.map((c) => c.padEnd(widths[c])).join('  '))
console.log(cols.map((c) => '-'.repeat(widths[c])).join('  '))
for (const r of rows) console.log(cols.map((c) => String(r[c] ?? '').padEnd(widths[c])).join('  '))

console.log('\n\n═══ 候选排序（谁赢由 STATE_RANK 差 → updatedAt 决定）═══\n')
for (const r of rows) console.log(`${String(r.tMs).padStart(6)}ms  ${r.label}\n        焦点=${r.focusSession}  候选序: ${r.candidates}`)

console.log('\n\n═══ 图标 state 的真实发出序列（带时间戳）═══\n')
for (const e of emittedStates) console.log(`${String(e.tMs).padStart(6)}ms  state=${e.state.padEnd(10)} session=${e.session ?? '(host)'}`)

console.log('\n\n═══ 汇总数字 ═══')
const aRec = reducer.sessions.get('root-a')
const bRec = reducer.sessions.get('root-b')
console.log('A tokens.total =', aRec.tokens?.total, ' B tokens.total =', bRec.tokens?.total)
console.log('A metrics      =', JSON.stringify(aRec.metrics), ' B metrics =', JSON.stringify(bRec.metrics))
console.log('A context      =', JSON.stringify(aRec.context))
console.log('B context      =', JSON.stringify(bRec.context))
console.log('图标看到的 tokens =', reducer.currentStateMessage().tokens?.total)
console.log('图标看到的 metrics =', JSON.stringify(reducer.currentStateMessage().metrics))
