/**
 * 上下文占用（**资源指标**）—— 数据通道与退化纪律。
 *
 * 用户点名的三类字段必须分明：
 *   `progress` → 真进度（有计划分母 done/total）
 *   `metrics`  → 活动量（**无分母**：轮/步/工具数/耗时）
 *   `context`  → **资源指标**（有资源分母 pressureTokens/contextWindow）
 *
 * 数据通道（源码级核对，见 src/context.js 顶部注释）：
 *   分母 ← `request/context` 事件的 `data.contextWindow`
 *          （`dsh-session/lib/types/types.d.ts:202-209, 335`；data 就是 RequestContext 本身）
 *   分子 ← usage 样本，公式照抄 `dsh-token-meter` 的 `pressureFrom`
 *          （`dsh-token-meter/lib/types/usage-projection.js:56`）
 *
 * 本文件同时覆盖**退化情况**：拿不到分母 / 拿不到分子 / 非法值 → 一律**不下发字段**（不是 0%）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer } from '../src/reducer.js'
import {
  ContextReason,
  contextDigest,
  contextPayload,
  isRealContext,
  normalizeContext,
  pressureTokensOf,
  routeOf,
  usageSampleOf,
} from '../src/context.js'
import { Capability, WorkState } from '../src/protocol.js'

const session = (id) => ({ header: { id, cwd: 'C:\\demo' } })

function feed(reducer, s, event, seq) {
  return reducer.handle(s, { seq, ...event })
}

/** 一次真实形状的 usage 样本（权威 TokenUsage：没有 totalTokens 字段）。 */
const USAGE = (inputTokens, cacheReadTokens = 0, cacheWriteTokens = 0, outputTokens = 0) => ({
  inputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  outputTokens,
})

// ── 分子：口径必须与官方 contextPressure 投影逐行一致 ──────────────────────

test('分子口径：pressureTokens = inputTokens + cacheRead + cacheWrite（**不含 output**）', () => {
  // 官方：usage-projection.js:56 `pressureFrom`
  assert.equal(pressureTokensOf(USAGE(100, 20, 5, 999)), 125, 'output 不参与占用')
  assert.equal(pressureTokensOf(USAGE(7)), 7, 'cache 缺省当 0')
  assert.equal(pressureTokensOf({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), 0, '全 0 是合法的 0')
  // 三个字段全缺 → undefined（不是 0）——0 是一个具体断言，这里没有依据
  assert.equal(pressureTokensOf({ outputTokens: 12 }), undefined)
  assert.equal(pressureTokensOf(undefined), undefined)
  assert.equal(pressureTokensOf(null), undefined)
  assert.equal(pressureTokensOf('nope'), undefined)
})

test('分子来源：两条 usage 路径都认（chunk.type==="usage" 与 assistant/message）', () => {
  // 官方 usageOf：usage-projection.js:58-62
  assert.deepEqual(
    usageSampleOf({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: USAGE(5) } } }),
    USAGE(5),
  )
  assert.deepEqual(
    usageSampleOf({ type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(9) } }),
    USAGE(9),
  )
  // 非 usage 的 chunk（text-delta / reasoning-delta）不算样本
  assert.equal(usageSampleOf({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'hi' } } }), undefined)
  // assistant/message 没有 usage 时不算
  assert.equal(usageSampleOf({ type: 'assistant/message', data: { message: {} } }), undefined)
  assert.equal(usageSampleOf({ type: 'turn/start', data: { turn: 1 } }), undefined)
})

// ── 分母：来自 request/context，data 就是 RequestContext 本身 ──────────────

test('分母来源：request/context 的 data 就是 RequestContext（无嵌套）', () => {
  const route = routeOf({ type: 'request/context', data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 200000 } })
  assert.equal(route.limit, 200000)
  assert.equal(route.provider, 'deepseek-official')
  assert.equal(route.model, 'deepseek-v4-flash')
  // 该路由没公布容量 → limit 是 undefined（不是猜一个默认值！）
  assert.equal(routeOf({ type: 'request/context', data: { provider: 'p', model: 'm' } }).limit, undefined)
  // 脏分母一律当"没有分母"
  assert.equal(routeOf({ data: { contextWindow: 0 } }).limit, undefined)
  assert.equal(routeOf({ data: { contextWindow: -5 } }).limit, undefined)
  assert.equal(routeOf({ data: { contextWindow: Number.NaN } }).limit, undefined)
  assert.equal(routeOf({ data: { contextWindow: 1.5 } }).limit, undefined)
})

// ── 主路径：真实载荷 ──────────────────────────────────────────────────────

test('主路径：request/context + usage → 环可用的 used/limit/ratio（真实载荷）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['context'])
  const s = session('ctx-1')

  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  // 官方注释：request/context「logged only when the route or capacity changes」
  const [routeMessage] = feed(reducer, s, {
    type: 'request/context',
    data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 200000 },
  }, 2)
  assert.equal(routeMessage.context.applicable, false, '只有分母、还没分子 → 仍不下发 used')
  assert.equal(routeMessage.context.reason, ContextReason.NO_USAGE)
  assert.equal('used' in routeMessage.context, false)
  assert.equal('limit' in routeMessage.context, false)
  assert.equal('ratio' in routeMessage.context, false)

  // 一次请求上报 usage：input 100k + cacheRead 20k + cacheWrite 0 = 120k / 200k = 60%
  const [message] = feed(reducer, s, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { role: 'assistant' }, usage: USAGE(100000, 20000, 0, 700) },
  }, 3)

  assert.deepEqual(reducer.contextSnapshot(), { applicable: true, used: 120000, limit: 200000, ratio: 0.6 })
  assert.deepEqual(message.context, { applicable: true, used: 120000, limit: 200000, ratio: 0.6 })
  assert.equal(isRealContext(message.context), true, '窗口据此画环')
})

test('占用变了但工作状态没变（一直在 THINKING）→ 仍然推一条 state，环才会动', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['context'])
  const s = session('ctx-pulse')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, s, { type: 'request/context', data: { contextWindow: 200000 } }, 2)
  const [first] = feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(1000) } }, 3)
  assert.equal(first.context.used, 1000)

  // 第二步：状态仍是 THINKING（#thinkingPulse 会返回 []），但占用涨了 → 必须推
  const [second] = feed(reducer, s, { type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'usage', usage: USAGE(40000) } } }, 4)
  assert.equal(second, undefined, 'chunk 是热路径，不直接产出消息')
  const [third] = feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 2, message: {}, usage: USAGE(50000) } }, 5)
  assert.equal(third.state, WorkState.THINKING)
  assert.equal(third.context.used, 50000, '同一步里 message 的样本覆盖 chunk 的早样本')
  assert.equal(third.context.ratio, 0.25)
})

test('分母变了（路由切换 200k→1M）→ 必须重推，且 ratio 跟着变', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['context'])
  const s = session('ctx-switch')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, s, { type: 'request/context', data: { model: 'a', contextWindow: 200000 } }, 2)
  feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(100000) } }, 3)
  assert.equal(reducer.contextSnapshot().ratio, 0.5)

  const [message] = feed(reducer, s, { type: 'request/context', data: { model: 'b', contextWindow: 1000000 } }, 4)
  assert.equal(message.context.limit, 1000000)
  assert.equal(message.context.used, 100000, '分子沿用上一次样本（它是最后一个请求的事实）')
  assert.equal(message.context.ratio, 0.1)
})

// ── 退化情况 ─────────────────────────────────────────────────────────────

test('🐛 退化①：完全没有 contextWindow → `applicable:false`，**绝不出现 used/limit/ratio**（不是 0%）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['context'])
  const s = session('ctx-nolimit')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  // 有真实 usage，但这条路由没公布容量 → 没有分母
  const [message] = feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(100000) } }, 2)

  assert.deepEqual(message.context, { applicable: false, reason: ContextReason.NO_LIMIT })
  for (const forbidden of ['used', 'limit', 'ratio']) {
    assert.equal(forbidden in message.context, false, `没有分母时不许出现 ${forbidden}`)
  }
  assert.equal(isRealContext(message.context), false, '窗口据此不画环')
})

test('🐛 退化②：有分母但还没有任何 usage 样本 → `applicable:false`（不是 0/200k = 0%）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['context'])
  const s = session('ctx-nousage')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  const [message] = feed(reducer, s, { type: 'request/context', data: { contextWindow: 200000 } }, 2)
  assert.deepEqual(message.context, { applicable: false, reason: ContextReason.NO_USAGE })
  assert.equal('used' in message.context, false)
  assert.equal('ratio' in message.context, false)
})

test('🐛 退化③：非法值（NaN/负/零/小数）→ `applicable:false / invalid`，绝不静默当 0', () => {
  assert.deepEqual(normalizeContext({ used: 1, limit: Number.NaN }), { ok: false, reason: ContextReason.INVALID })
  assert.deepEqual(normalizeContext({ used: 1, limit: 0 }), { ok: false, reason: ContextReason.INVALID })
  assert.deepEqual(normalizeContext({ used: 1, limit: -1 }), { ok: false, reason: ContextReason.INVALID })
  assert.deepEqual(normalizeContext({ used: 1, limit: 1.5 }), { ok: false, reason: ContextReason.INVALID })
  assert.deepEqual(normalizeContext({ used: -1, limit: 100 }), { ok: false, reason: ContextReason.INVALID })
  assert.deepEqual(normalizeContext({ used: Number.NaN, limit: 100 }), { ok: false, reason: ContextReason.INVALID })
  assert.deepEqual(normalizeContext({ used: 1.5, limit: 100 }), { ok: false, reason: ContextReason.INVALID })
  // 缺失 ≠ 非法：各自有独立原因
  assert.deepEqual(normalizeContext({ used: 1 }), { ok: false, reason: ContextReason.NO_LIMIT })
  assert.deepEqual(normalizeContext({ limit: 100 }), { ok: false, reason: ContextReason.NO_USAGE })
  assert.deepEqual(normalizeContext({}), { ok: false, reason: ContextReason.NO_LIMIT })
  assert.deepEqual(normalizeContext({ used: null, limit: null }), { ok: false, reason: ContextReason.NO_LIMIT })

  // 线上一律不给数字
  assert.deepEqual(contextPayload({ used: Number.NaN, limit: 100 }), { applicable: false, reason: ContextReason.INVALID })
  assert.deepEqual(contextPayload({ used: 5, limit: 0 }), { applicable: false, reason: ContextReason.INVALID })
})

test('🐛 退化④：`used > limit`（待压缩）**如实 > 1**，不 clamp、不撒谎', () => {
  const payload = contextPayload({ used: 250000, limit: 200000 })
  assert.equal(payload.applicable, true)
  assert.equal(payload.ratio, 1.25, 'ratio 不做 clamp，如实给；画不画满交给窗口')
  assert.equal(isRealContext(payload), true)
})

test('宿主内部：没收到分母时 contextSnapshot() 就是 undefined（不伪造 {used:0}）', () => {
  const reducer = new WorkIconReducer()
  const s = session('ctx-empty')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  assert.equal(reducer.contextSnapshot(), undefined)
})

// ── 能力门控：老窗口字节必须与以前完全一致 ─────────────────────────────────

test('老窗口（未声明 context 能力）：state **不含** context 字段，且不因占用变化多发消息', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress']) // 故意不含 context
  const s = session('ctx-legacy')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, s, { type: 'request/context', data: { contextWindow: 200000 } }, 2)
  // 状态没变、签名里也不带占用 → 这一步**不产生**任何消息（正是 v1 的行为）
  assert.deepEqual(
    feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(100000) } }, 3),
    [],
  )
  // 用一个确定会改签名的无关事件把 state 逼出来，检查字段确实缺席
  const [message] = feed(reducer, s, { type: 'session/title', data: { title: 'T' } }, 4)
  assert.equal('context' in message, false, '没声明能力就不该出现 context')
  // 宿主内部仍然算（便宜，且开关一开立刻可用），但签名里不带 → 不产生额外推送
  assert.equal(reducer.contextSnapshot().used, 100000)
  // 再来一次 usage：状态没变、能力没声明 → 不该有消息
  const again = feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 2, message: {}, usage: USAGE(120000) } }, 5)
  assert.deepEqual(again, [], '老窗口不该因为"占用变了"而收到它读不懂的 state')
})

test('声明 context 能力后，同一个 reducer 立刻开始下发（能力协商在 onReady 之前不影响正确性）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities([Capability.CONTEXT])
  assert.equal(reducer.supports(Capability.CONTEXT), true)
  assert.equal(reducer.supports('不认识的键'), false, '不认识的条目被忽略')
})

// ── 严格分离：三类字段不得互相冒充 ────────────────────────────────────────

test('🐛 严格分离：context 的资源字段**绝不混进 progress**，progress 的计划字段也不进 context', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress', 'context'])
  const s = session('ctx-separate')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, s, { type: 'request/context', data: { contextWindow: 200000 } }, 2)
  feed(reducer, s, { type: 'todo/write', data: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] } }, 3)
  const [message] = feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(100000) } }, 4)

  // progress 里不许出现任何上下文占用字段
  for (const forbidden of ['used', 'limit', 'ratio', 'pressureTokens', 'contextWindow']) {
    assert.equal(forbidden in message.progress, false, `progress 里不该有 ${forbidden}`)
  }
  // context 里不许出现任何计划进度字段
  for (const forbidden of ['done', 'total', 'applicable_total', 'mode', 'unit', 'inProgress', 'planChange']) {
    assert.equal(forbidden in message.context, false, `context 里不该有 ${forbidden}`)
  }
  // metrics（活动量，无分母）也不许混进来
  for (const forbidden of ['turns', 'toolCalls', 'elapsedMs']) {
    assert.equal(forbidden in message.context, false, `context 里不该有 ${forbidden}`)
  }
  // 三者同时存在、各自独立
  assert.equal(message.progress.total, 2, '计划进度')
  assert.equal(message.context.limit, 200000, '上下文占用')
  assert.equal(typeof message.metrics.elapsedMs, 'number', '活动量')
})

// ── 纯函数与指纹 ──────────────────────────────────────────────────────────

test('contextDigest：只有"对外可见"的变化才改指纹（防抖动）', () => {
  assert.equal(contextDigest(undefined), '')
  assert.equal(contextDigest({ applicable: false, reason: 'no-limit' }), 'na:no-limit')
  assert.equal(contextDigest({ applicable: true, used: 1, limit: 2, ratio: 0.5 }), '1/2')
  // ratio 是派生的 → used/limit 相同则指纹相同
  assert.equal(
    contextDigest({ applicable: true, used: 1, limit: 2, ratio: 0.5 }),
    contextDigest({ applicable: true, used: 1, limit: 2, ratio: 0.5000001 }),
  )
  assert.notEqual(contextDigest({ applicable: true, used: 1, limit: 2 }), contextDigest({ applicable: true, used: 2, limit: 2 }))
})

test('isRealContext：只有真拿到分母+分子才允许画环', () => {
  assert.equal(isRealContext({ applicable: true, used: 0, limit: 200000 }), true, '0 是合法的真实占用')
  assert.equal(isRealContext({ applicable: false, reason: 'no-limit' }), false)
  assert.equal(isRealContext(undefined), false)
  assert.equal(isRealContext({ applicable: true, used: 1, limit: 0 }), false, '分母为 0 不许画')
})

test('不相关事件不动上下文占用（与 progress 互不干扰）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['context'])
  const s = session('ctx-mixed')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, s, { type: 'request/context', data: { contextWindow: 200000 } }, 2)
  feed(reducer, s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, usage: USAGE(1000) } }, 3)
  const before = reducer.contextSnapshot()
  feed(reducer, s, { type: 'tool/call', data: { name: 'read', callId: 'c1', arguments: '{}' } }, 4)
  feed(reducer, s, { type: 'todo/write', data: { todos: [{ content: 'x', status: 'pending' }] } }, 5)
  feed(reducer, s, { type: 'not/a/real/event', data: {} }, 6)
  assert.deepEqual(reducer.contextSnapshot(), before, '无关事件不该动占用')
})

test('usage 缺 inputTokens 但有 cache 时仍然算数（cache 命中场景）', () => {
  // 真实形状：长对话里 input 很小、cacheRead 很大
  assert.equal(pressureTokensOf({ inputTokens: 120, cacheReadTokens: 180000, cacheWriteTokens: 0 }), 180120)
})
