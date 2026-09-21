/**
 * 多会话：**图标不再互相抢夺** + **可加的量才总计**。
 *
 * 用户原话（本次任务的判据）：
 *   「如果我开多个会话他会相互抢夺页面，而且 token 和价格统计好像也会抢夺，
 *     而我希望是总计」
 *   「保留紧急优先，同等级的会话（都在跑 / 都在思考）要合并成一个总状态」
 *   「可加的量才总计，不可加的量不总计」
 *
 * 改动前的**实测**现状（`node test/measure-multisession.mjs` / `node test/measure-flicker.mjs`）：
 *   · 焦点（`snapshot().sessionId`）在两个根会话之间**每个事件换一次**
 *     （12500ms=root-a、15500ms=root-b、18500ms=root-a…）；
 *   · 图标 state 值也跟着在 WORKING ⇄ THINKING 之间跳 **6 次**；
 *   · token / 花费 / 工具数 全部跟着焦点走（100000↔2000、1.23↔4.56、7↔4）。
 * 本文件就是把这些数字钉成断言。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MERGE_MIN_SESSIONS,
  STATE_RANK,
  StateTier,
  WorkIconReducer,
  tierOfState,
} from '../src/reducer.js'
import { Capability, WorkState } from '../src/protocol.js'
import { CostLedger } from '../src/cost.js'

const ALL_CAPS = [
  Capability.TODOS,
  Capability.COST,
  Capability.PROGRESS,
  Capability.CONTEXT,
  Capability.SUBAGENTS,
  Capability.SESSIONS,
]

/** 可控时钟：耗时要能被断言，必须自己拿着时间。 */
function clock(start = 1_700_000_000_000) {
  let now = start
  return { now: () => now, advance: (ms) => { now += ms; return now } }
}

/** 两个**不同的对话**（不同 id ⇒ 不同对话根 ⇒ 属于"多个会话"）。 */
const session = (id, cwd = `C:\\work\\${id}`) => ({ header: { id, cwd } })

const toolCall = (callId, name, seq, args = { command: 'npm test' }) => ({
  type: 'tool/call', seq, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
})
const toolResult = (callId, seq) => ({
  type: 'tool/result', seq, data: { callId, message: { content: [{ isError: false }] } },
})
const usageMessage = (turn, step, usage, seq) => ({
  type: 'assistant/message', seq, data: { turn, step, message: { role: 'assistant', content: [] }, usage },
})

const stateMessages = (messages) => messages.filter((message) => message.kind === 'state')

function makeReducer() {
  const c = clock()
  const reducer = new WorkIconReducer({ now: c.now })
  reducer.setCapabilities(ALL_CAPS)
  return { reducer, c }
}

// ═══════════════════════════════════════════════════════════════════════════
// 规则本身（= 报告里那条"什么算同等级、合并后显示什么"的可执行版本）
// ═══════════════════════════════════════════════════════════════════════════

test('等级表：URGENT(WAITING/ERROR) > BUSY(WORKING/THINKING) > DONE(SUCCESS) > IDLE', () => {
  // 等级是"同等级合并"的粒度，次序必须与 STATE_RANK 严格一致
  assert.ok(STATE_RANK[WorkState.WAITING] > STATE_RANK[WorkState.ERROR])
  assert.ok(STATE_RANK[WorkState.ERROR] > STATE_RANK[WorkState.WORKING])
  assert.ok(STATE_RANK[WorkState.WORKING] > STATE_RANK[WorkState.THINKING])
  assert.ok(STATE_RANK[WorkState.THINKING] > STATE_RANK[WorkState.SUCCESS])
  assert.ok(STATE_RANK[WorkState.SUCCESS] > STATE_RANK[WorkState.IDLE])

  assert.equal(tierOfState(WorkState.WAITING), StateTier.URGENT)
  assert.equal(tierOfState(WorkState.ERROR), StateTier.URGENT)
  assert.equal(tierOfState(WorkState.WORKING), StateTier.BUSY)
  assert.equal(tierOfState(WorkState.THINKING), StateTier.BUSY)
  assert.equal(tierOfState(WorkState.SUCCESS), StateTier.DONE)
  assert.equal(tierOfState(WorkState.IDLE), StateTier.IDLE)
  assert.equal(MERGE_MIN_SESSIONS, 2)
})

// ═══════════════════════════════════════════════════════════════════════════
// ① 两个会话都在跑 ⇒ state 序列稳定（不跳）
// ═══════════════════════════════════════════════════════════════════════════

test('① 两个会话轮流开合工具：图标 state 与代表会话都不许跳（改动前 6 次跳变）', () => {
  const { reducer } = makeReducer()
  const a = session('root-a')
  const b = session('root-b')

  reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(a, toolCall('a0', 'pwsh', 2))
  reducer.handle(b, toolCall('b0', 'Write', 2))
  // 到这一步：两个会话都手上开着工具（都在跑）

  const emitted = []
  const collect = (sessionObj, event) => {
    const messages = reducer.handle(sessionObj, event)
    for (const message of stateMessages(messages)) {
      emitted.push({ state: message.state, session: message.session })
    }
  }

  const rounds = 3
  for (let round = 0; round < rounds; round += 1) {
    // 两边轮流：先各自关掉手上的工具（此刻两边都没在跑工具），再各自开一个新的
    collect(a, toolResult(`a${round}`, 10 + round * 4))
    collect(b, toolResult(`b${round}`, 10 + round * 4))
    collect(a, toolCall(`a${round + 1}`, 'pwsh', 11 + round * 4))
    collect(b, toolCall(`b${round + 1}`, 'Write', 11 + round * 4))
  }

  assert.ok(emitted.length > 0, '这段窗口里必须真的产出过 state 消息（否则断言是空转）')
  assert.equal(reducer.snapshot().merged, true, '两个不同对话在同一等级 ⇒ 应当处于合并态')

  // ①-a 显示状态不跳：全程 WORKING（等级内的天花板，不再回落到 THINKING）
  assert.deepEqual(
    [...new Set(emitted.map((entry) => entry.state))],
    [WorkState.WORKING],
    `图标 state 在两边轮流干活时跳了：${[...new Set(emitted.map((entry) => entry.state))].join(' → ')}`,
  )
  // ①-b 代表会话不换人：不再由 `updatedAt`（"刚动过的那个"）决定
  assert.deepEqual(
    [...new Set(emitted.map((entry) => entry.session))],
    ['root-a'],
    `代表会话在两边轮流干活时换人了：${[...new Set(emitted.map((entry) => entry.session))].join(' → ')}`,
  )
  // ①-c "不跳"必须是**整段稳定**，而不是"最后恰好停在同一个值"
  assert.deepEqual(emitted.map((entry) => entry.state), new Array(emitted.length).fill(WorkState.WORKING))
})

test('①-反证 单会话行为一字不改：WORKING ⇄ THINKING 仍是真实信息（只有 ≥2 个对话才合并）', () => {
  const { reducer } = makeReducer()
  const solo = session('solo')
  reducer.handle(solo, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.deepEqual(
    stateMessages(reducer.handle(solo, toolCall('s1', 'pwsh', 2))).map((m) => m.state),
    [WorkState.WORKING],
  )
  // 工具关掉 ⇒ 立刻回到 THINKING（单个会话时这就是真实信息，不许合并掉）
  assert.deepEqual(
    stateMessages(reducer.handle(solo, toolResult('s1', 3))).map((m) => m.state),
    [WorkState.THINKING],
  )
  assert.equal(reducer.snapshot().merged, false)
})

// ═══════════════════════════════════════════════════════════════════════════
// ② 紧急优先：WAITING 不被任何"在跑"的会话抢走
// ═══════════════════════════════════════════════════════════════════════════

test('② 一个会话在等输入、另一个在跑 ⇒ 仍然是 WAITING（紧急优先不许被合并掉）', () => {
  const { reducer } = makeReducer()
  const a = session('quiet-a')
  const b = session('asking-b')

  reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(a, toolCall('a1', 'pwsh', 2))
  reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.deepEqual(
    stateMessages(reducer.handle(b, { type: 'approval/asked', seq: 2, data: { id: 'ap', toolName: 'Bash' } }))
      .map((m) => m.state),
    [WorkState.WAITING],
  )

  // A 继续猛干（多次工具调用 + 大量 chunk）都不许把等待的灯抢走
  for (let i = 0; i < 5; i += 1) {
    reducer.handle(a, toolCall(`a-r${i}`, 'pwsh', 10 + i * 2))
    reducer.handle(a, toolResult(`a-r${i}`, 11 + i * 2))
    reducer.handle(a, { type: 'assistant/chunk', seq: 40 + i, data: { chunk: { type: 'text-delta', index: 0, text: 'x' } } })
  }
  assert.equal(reducer.snapshot().state, WorkState.WAITING, 'WAITING 是紧急等级，不许被 BUSY 抢走')
  assert.equal(reducer.snapshot().sessionId, 'asking-b', '等人的那个会话必须是上屏的那个')

  // 等待被处理后，才轮到"还在干活"的那些
  const after = stateMessages(reducer.handle(b, { type: 'approval/decided', seq: 3, data: { id: 'ap', outcome: 'approved' } }))
  assert.ok(after.every((message) => message.state !== WorkState.WAITING))
})

test('②-反证 "完成"不许和"在跑"混成一个（SUCCESS 是 DONE 等级，不是 BUSY）', () => {
  const { reducer, c } = makeReducer()
  const done = session('done-x')
  const busy = session('busy-y')
  reducer.handle(busy, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(busy, toolCall('y1', 'pwsh', 2))
  reducer.handle(done, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const finished = stateMessages(reducer.handle(done, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } }))
  // 完成的那个会话**自己**进了 SUCCESS（它的灯是绿的），但它不是最高等级 ⇒ 不上屏
  assert.equal(reducer.sessions.get('done-x').state, WorkState.SUCCESS, '完成的会话自己进 SUCCESS')
  assert.deepEqual(finished.map((m) => m.state), [WorkState.WORKING], '另一会话还在跑 ⇒ 上屏的仍是 WORKING')
  // 但另一个还在跑 ⇒ 上屏的仍是 WORKING（完成不许盖掉在跑）
  assert.equal(reducer.snapshot().state, WorkState.WORKING)
  c.advance(1)
  assert.equal(reducer.snapshot().merged, false, 'DONE 等级不参与合并（否则绿灯会被粘住）')
})

// ═══════════════════════════════════════════════════════════════════════════
// ③ 可加的四项 = 跨全部会话的总计（具体数字）
// ═══════════════════════════════════════════════════════════════════════════

test('③ token / 工具数 / 轮数 = 两个会话之和（1100+2050、3+2、2+1）', () => {
  const { reducer } = makeReducer()
  const a = session('sum-a')
  const b = session('sum-b')

  // ── A：2 轮、3 次工具、usage 1100 ────────────────────────────────────
  reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(a, toolCall('a1', 'pwsh', 2))
  reducer.handle(a, toolCall('a2', 'Read', 3))
  reducer.handle(a, toolCall('a3', 'Write', 4))
  reducer.handle(a, usageMessage(1, 1, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 5000 }, 5))
  reducer.handle(a, { type: 'turn/end', seq: 6, data: { turn: 1, reason: { kind: 'completed' } } })
  reducer.handle(a, { type: 'turn/start', seq: 7, data: { turn: 2 } })

  // ── B：1 轮、2 次工具、usage 2050 ────────────────────────────────────
  reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(b, toolCall('b1', 'Bash', 2))
  reducer.handle(b, toolCall('b2', 'Bash', 3))
  reducer.handle(b, usageMessage(1, 1, { inputTokens: 2000, outputTokens: 50 }, 4))

  const message = reducer.currentStateMessage()

  // 逐会话的原始值（先钉住"每会话自己的"确实是这两个数）
  assert.equal(reducer.sessions.get('sum-a').tokens.total, 1100, "A 自己的 token = 1000+100")
  assert.equal(reducer.sessions.get('sum-b').tokens.total, 2050, "B 自己的 token = 2000+50")
  assert.equal(reducer.sessions.get('sum-a').metrics.toolCalls, 3)
  assert.equal(reducer.sessions.get('sum-b').metrics.toolCalls, 2)

  // 合计（对外载荷里的值）
  assert.equal(message.tokens.total, 3150, 'token 合计 = 1100 + 2050')
  assert.equal(message.tokens.input, 3000, '输入合计 = 1000 + 2000')
  assert.equal(message.tokens.output, 150, '输出合计 = 100 + 50')
  assert.equal(message.tokens.total, message.tokens.input + message.tokens.output, 'total 恒等于 input+output')
  assert.equal(message.metrics.toolCalls, 5, '工具数合计 = 3 + 2')
  assert.equal(message.metrics.turns, 3, '轮数合计 = 2 + 1')

  // 反向：合计既不是 A 的也不是 B 的（防"改回按焦点取"）
  assert.notEqual(message.tokens.total, 1100)
  assert.notEqual(message.tokens.total, 2050)
  assert.notEqual(message.metrics.toolCalls, 3)
  assert.notEqual(message.metrics.toolCalls, 2)

  // 另一个会话的计数变化必须让图标重画（否则合计会停在旧值）
  const pushed = stateMessages(reducer.handle(b, toolCall('b3', 'Bash', 5)))
  assert.equal(pushed.length, 1, '另一个会话又调了一次工具 ⇒ 必须推一条新的 state')
  assert.equal(pushed[0].metrics.toolCalls, 6, '合计跟着涨到 6')
})

test('③ 花费 = 跨全部会话的账本合计（真账本、真合计 1.23 + 4.56 = 5.79）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-work-icon-multicost-'))
  try {
    const journal = join(dir, 'usage-records.journal.jsonl')
    writeFileSync(journal, [
      { sessionId: 'cost-a', ts: 1, cost: 1.23, currency: 'CNY', pricingStatus: 'priced' },
      { sessionId: 'cost-b', ts: 2, cost: 4.56, currency: 'CNY', pricingStatus: 'priced' },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n')

    const { reducer } = makeReducer()
    const a = session('cost-a')
    const b = session('cost-b')
    reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })

    // 宿主口径（与 src/index.js 的 refreshCost 同一条路）
    const ledger = new CostLedger({ dir, logger: { warn() {} } })
    ledger.refresh()
    const ids = reducer.costSessionIds()
    const total = ledger.total(ids)
    assert.equal(total.status, 'ok')
    // 浮点：1.23 + 4.56 = 5.789999999999999，按数值比较（下面同时钉住"不是单会话的数"）
    assert.ok(Math.abs(total.cost.CNY - 5.79) < 1e-9, `账本合计 = 1.23 + 4.56，实际 ${total.cost.CNY}`)
    assert.equal(reducer.setCost({ status: 'ok', cost: total.cost, priced: total.priced, unpriced: total.unpriced }), true)

    const message = reducer.currentStateMessage()
    assert.ok(Math.abs(message.cost.cost.CNY - 5.79) < 1e-9, '图标看到的花费必须是全量合计')
    assert.ok(Math.abs(message.cost.cost.CNY - 1.23) > 1e-9, '不是某一个会话的花费')
    assert.ok(Math.abs(message.cost.cost.CNY - 4.56) > 1e-9)

    // 花费口径的 id 集合必须**跨两个对话**（旧实现只取焦点会话那一棵子树）
    assert.deepEqual([...ids].sort(), ['cost-a', 'cost-b'])

    // 焦点换人也不会让花费消失（旧实现把花费挂在焦点会话记录上 ⇒ 新焦点身上没有花费）
    reducer.handle(b, toolCall('b1', 'Bash', 2))
    assert.ok(Math.abs(reducer.currentStateMessage().cost.cost.CNY - 5.79) < 1e-9)
    reducer.handle(a, toolCall('a1', 'pwsh', 3))
    assert.ok(Math.abs(reducer.currentStateMessage().cost.cost.CNY - 5.79) < 1e-9)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// ④ 不可加的两项：耗时 / 上下文占用 —— 绝不许相加（反向断言）
// ═══════════════════════════════════════════════════════════════════════════

test('④ 耗时与上下文占用**不合计**：取代表会话的单值，绝不是两数相加', () => {
  const { reducer, c } = makeReducer()
  const a = session('clock-a')
  const b = session('clock-b')

  // A 从 t0 开始跑；B 晚 5000ms 才开始 ⇒ 两者的耗时天然不同
  reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(a, toolCall('a1', 'pwsh', 2))
  reducer.handle(a, { type: 'request/context', seq: 3, data: { provider: 'p', model: 'm', contextWindow: 200000 } })
  reducer.handle(a, usageMessage(1, 1, { inputTokens: 100000, cacheReadTokens: 50000, cacheWriteTokens: 0 }, 4))

  c.advance(5000)
  reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(b, toolCall('b1', 'Bash', 2))
  reducer.handle(b, { type: 'request/context', seq: 3, data: { provider: 'p', model: 'm', contextWindow: 1000000 } })
  reducer.handle(b, usageMessage(1, 1, { inputTokens: 2000 }, 4))

  // 让两边都真的跑过一段时间（否则耗时是 0，验不出"有没有相加"）
  c.advance(3000)

  const message = reducer.currentStateMessage()
  assert.equal(reducer.snapshot().merged, true, '两个不同对话都在跑 ⇒ 合并态（合计部分生效）')

  // 各自真实的耗时
  const elapsedA = c.now() - reducer.sessions.get('clock-a').startedAt
  const elapsedB = c.now() - reducer.sessions.get('clock-b').startedAt
  assert.equal(elapsedA, 8000, 'A 早 5000ms 起跑、之后又过了 3000ms')
  assert.equal(elapsedB, 3000)
  assert.notEqual(elapsedA + elapsedB, elapsedA, '两个数确实不同，否则下面验不出东西')

  // ④-a 耗时 = 代表会话的单值（不是和）
  assert.equal(message.elapsedMs, elapsedA, '耗时取代表会话（clock-a）的单值')
  assert.notEqual(message.elapsedMs, elapsedA + elapsedB, '耗时**不可相加**：两数之和不是任何真实的东西')
  assert.equal(message.metrics.elapsedMs, elapsedA, 'metrics.elapsedMs 同一口径（也不许相加）')
  // 同一个 metrics 对象里"可加/不可加"并存 —— 这才是"不一刀切"
  assert.equal(message.metrics.turns, 2, '同一个对象里轮数是合计')
  assert.equal(message.metrics.elapsedMs, elapsedA, '而耗时仍是单值')

  // ④-b 上下文占用 = 代表会话的那一份（每个会话各占一份，加总毫无意义）
  assert.deepEqual(message.context, { applicable: true, used: 150000, limit: 200000, ratio: 0.75 })
  assert.notEqual(message.context.used, 150000 + 2000, '上下文分子不许相加')
  assert.notEqual(message.context.limit, 200000 + 1000000, '上下文分母不许相加')
  assert.equal(reducer.sessions.get('clock-b').context.used, 2000, 'B 自己那一份仍然照实记录（面板各显各的）')
})

test('④-不变量：可加 / 不可加 的分界必须是"能不能相加"，不是"在不在同一个字段里"', () => {
  const { reducer, c } = makeReducer()
  const a = session('split-a')
  const b = session('split-b')
  reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(a, toolCall('a1', 'pwsh', 2))
  reducer.handle(a, { type: 'request/context', seq: 3, data: { contextWindow: 200000 } })
  reducer.handle(a, usageMessage(1, 1, { inputTokens: 1000 }, 4))
  reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(b, toolCall('b1', 'Bash', 2))
  reducer.handle(b, { type: 'request/context', seq: 3, data: { contextWindow: 1000000 } })
  reducer.handle(b, usageMessage(1, 1, { inputTokens: 2000 }, 4))
  c.advance(2000)

  const message = reducer.currentStateMessage()
  // 可加 ⇒ 合计
  assert.equal(message.metrics.toolCalls, 2)
  assert.equal(message.metrics.turns, 2)
  assert.equal(message.tokens.total, 3000)
  // 不可加 ⇒ 单值（且必须与合计口径的字段**分开出境**）
  assert.equal(message.context.used, 1000, '上下文是代表会话的那一份')
  assert.equal(message.metrics.elapsedMs, message.elapsedMs, '耗时两处同源、都是单值')
  assert.equal('used' in message.metrics, false, '上下文占用不许混进 metrics')
  assert.equal('context' in message.metrics, false)
})

// ═══════════════════════════════════════════════════════════════════════════
// 合并的适用范围：只在**不同对话**之间（同一对话内的子代理行为一字不改）
// ═══════════════════════════════════════════════════════════════════════════

test('合并只在"不同对话"之间生效：同一对话内的子代理仍按原有取舍抢焦点', () => {
  const { reducer } = makeReducer()
  const mainSession = session('conv-root')
  const child = {
    header: { id: 'conv-child', cwd: 'C:\\work\\conv-root', origin: 'subagent', parentSession: 'conv-root', delegationDepth: 1 },
  }
  reducer.handle(mainSession, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(mainSession, toolCall('m1', 'pwsh', 2))
  reducer.handle(child, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(child, toolCall('c1', 'Read', 2))

  // 同一个对话根 ⇒ 不算"多个会话抢页面" ⇒ 不合并，保持原有"最近活跃者上屏"
  assert.equal(reducer.snapshot().merged, false)
  assert.equal(reducer.snapshot().sessionId, 'conv-child', '子代理仍会抢焦点（刻意的原有行为）')

  // 但合计口径仍然是**全量**的（子代理的活也算进总量）
  assert.equal(reducer.currentStateMessage().metrics.toolCalls, 2)
})

test('窗口侧的"会话 · N"仍然每会话各占一行（合计只影响图标总量，不影响面板分列）', () => {
  const { reducer } = makeReducer()
  reducer.handle(session('row-a'), { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(session('row-a'), toolCall('r1', 'pwsh', 2))
  reducer.handle(session('row-b'), { type: 'turn/start', seq: 1, data: { turn: 1 } })

  const rows = reducer.mainSessionsSnapshot()
  assert.equal(rows.total, 2, '面板仍是两个会话')
  assert.deepEqual(rows.items.map((row) => row.id).sort(), ['row-a', 'row-b'])
  // 合计口径不影响分列：每行仍反映自己的状态
  assert.equal(rows.items.find((row) => row.id === 'row-a').state, WorkState.WORKING)
  assert.equal(rows.items.find((row) => row.id === 'row-b').state, WorkState.THINKING)
})
