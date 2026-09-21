/**
 * 【第一步：先量，再改】场景 2：两个会话的**工具轮流开合**。
 *
 * 为什么单独量这个：场景 1（两个都在跑工具）state 值恒为 WORKING，看不出"值"层面的跳。
 * 这里让 A、B 交替开合工具 ⇒ 任一时刻"有没有开着的工具"在 WORKING / THINKING 之间反复变，
 * 这才是"同等级会不会来回跳"的真正判据。
 *
 * 运行：node test/measure-flicker.mjs
 */

import { WorkIconReducer, STATE_RANK } from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

let t = 1_700_000_000_000
const now = () => t
const session = (id) => ({ header: { id, cwd: 'C:\\x' } })
const A = session('root-a')
const B = session('root-b')

const toolCall = (callId, name, seq) => ({
  type: 'tool/call', seq, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify({ command: 'npm test' }) },
})
const toolResult = (callId, seq) => ({
  type: 'tool/result', seq, data: { callId, message: { content: [{ isError: false }] } },
})

const reducer = new WorkIconReducer({ now })
reducer.setCapabilities(['todos', 'cost', 'progress', 'context', 'subagents', 'sessions', 'text'])

const seq = []
const emitted = []
function feed(s, event, label) {
  t += 1000
  const messages = reducer.handle(s, event)
  const snap = reducer.snapshot()
  const msg = reducer.currentStateMessage()
  seq.push({ label, state: snap.state, focus: snap.sessionId, iconState: msg.state })
  for (const m of messages) if (m.kind === 'state') emitted.push({ t: t - 1_700_000_000_000, state: m.state, session: m.session, label })
  return messages
}

feed(A, { type: 'turn/start', seq: 1, data: { turn: 1 } }, 'A turn/start')
feed(B, { type: 'turn/start', seq: 1, data: { turn: 1 } }, 'B turn/start')

for (let r = 0; r < 3; r += 1) {
  feed(A, toolCall(`a${r}`, 'pwsh', 10 + r * 4), `A tool/call #${r}`)
  feed(B, toolCall(`b${r}`, 'Write', 10 + r * 4), `B tool/call #${r}`)
  feed(A, toolResult(`a${r}`, 11 + r * 4), `A tool/result #${r}`)
  feed(B, toolResult(`b${r}`, 11 + r * 4), `B tool/result #${r}`)
}

console.log('═══ 每一步的图标状态（focus = 当时被选中代表谁的会话）═══\n')
console.log('label'.padEnd(22), 'focus'.padEnd(10), 'rank(焦点)', '图标 state')
for (const r of seq) {
  console.log(
    r.label.padEnd(22),
    String(r.focus).padEnd(10),
    String(STATE_RANK[r.state] ?? 0).padEnd(10),
    r.iconState,
  )
}

console.log('\n\n═══ 实际发出的 state 序列（带时间戳）═══\n')
for (const e of emitted) console.log(`${String(e.t).padStart(6)}ms  state=${e.state.padEnd(9)} session=${e.session ?? '(host)'}   ← ${e.label}`)

const states = emitted.map((e) => e.state)
let flips = 0
for (let i = 1; i < states.length; i += 1) if (states[i] !== states[i - 1]) flips += 1
console.log(`\n图标 state 值的变化次数 = ${flips}   （序列：${states.join(' → ')}）`)

const sessionsSeen = [...new Set(emitted.map((e) => e.session))]
console.log(`图标 session 字段出现过的取值 = ${JSON.stringify(sessionsSeen)}（${sessionsSeen.length} 个 ⇒ ${sessionsSeen.length > 1 ? '在跳' : '稳定'}）`)
