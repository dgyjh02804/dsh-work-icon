/**
 * 回归测试：图标「卡红」事故（2026-09-12 线上复现）。
 *
 * 事故链路（用户实测确认）：
 *   ① 某个**子代理**的一轮以非 completed 结束（很可能就是 max-tokens，报告太长撞输出上限）
 *      → 归约器把该会话记为粘性 ERROR（优先级 50）；
 *   ② 该子代理随后结束/静默，再也不会产生"新的一步"来清粘性；
 *   ③ 它的 ERROR 永久压制整个聚合状态，`if (record.sticky) return []` 又让谁都翻不过去；
 *   ④ 用户看到的是：图标红了之后无论主会话怎么干活，图标一动不动。
 *   用户关掉「跟随子代理」后红色立刻消失 → 确认卡住的是**子代理会话**。
 *
 * 现在有四道出口，任何一道成立都不会再卡死：
 *   A. 轮级 ERROR 有 TTL（默认 20s）→ tick 到期衰减；
 *   B. 工具级 ERROR 红灯更短（默认 5s）+ 下一个 step 立刻收；
 *   C. 粘性不再阻止新活动上屏（工具名/活动行照常更新）；
 *   D. 静默过久（默认 90s）的会话不再以最高优先级占据聚合状态。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ERROR_TTL_MS,
  DEFAULT_STALE_STICKY_MS,
  DEFAULT_TOOL_ERROR_TTL_MS,
  WorkIconReducer,
} from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

/** 可控时钟：TTL 测试不能靠真实 sleep。 */
function fakeClock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms) => { current += ms },
  }
}

function session(id, extra = {}) {
  return { header: { id, cwd: 'C:\\demo', ...extra } }
}

const subagentSession = (id, parentId) => session(id, { origin: 'subagent', parentSession: parentId })

function statesOf(messages) {
  return messages.filter((m) => m.kind === 'state').map((m) => m.state)
}

// ── ① 子代理 max-tokens 结束 → 静默 → 聚合状态必须在 T 秒内恢复 ──────────────

test('🐛 回归①：子代理 turn 以 max-tokens 结束 → 会话静默 → 聚合状态必须恢复（不得永久红）', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ includeSubagents: true, now: clock.now })
  const main = session('main-1')
  const sub = subagentSession('sub-1', 'main-1')

  // 主会话在干活
  reducer.handle(main, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(main, {
    type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' },
  })
  assert.equal(reducer.snapshot().state, WorkState.WORKING)

  // 子代理那一轮撞上输出上限（用户实测里最可能的形态）
  reducer.handle(sub, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const afterMaxTokens = reducer.handle(sub, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'max-tokens' } } })

  // 关键断言：max-tokens **不再是红色故障**
  assert.equal(
    statesOf(afterMaxTokens).includes(WorkState.ERROR), false,
    'max-tokens = 输出被截断，不是故障，不该让图标变红',
  )
  assert.equal(reducer.snapshot().state, WorkState.WORKING, '主会话的工作状态不该被子代理的截断影响')

  // 之后子代理彻底静默；无论怎么推进时间，聚合状态都不该变红
  for (const step of [1000, 30_000, 120_000]) {
    clock.advance(step)
    const messages = reducer.tick()
    assert.equal(
      statesOf(messages).includes(WorkState.ERROR), false,
      `静默 ${step}ms 后不该出现 ERROR（实际 ${JSON.stringify(statesOf(messages))}）`,
    )
  }
})

test('🐛 回归①b：子代理 turn 以真正的 error 结束 → 静默 → 必须在 ERROR_TTL 内衰减回主会话状态', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ includeSubagents: true, now: clock.now })
  const main = session('main-1')
  const sub = subagentSession('sub-1', 'main-1')

  reducer.handle(main, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(main, {
    type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' },
  })

  reducer.handle(sub, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const errorMessages = reducer.handle(sub, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
  // 真 error：该红，并且立刻压制聚合状态（这是 ERROR 的语义）
  assert.equal(statesOf(errorMessages).includes(WorkState.ERROR), true)
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 还没到期：仍然红
  clock.advance(DEFAULT_ERROR_TTL_MS - 1)
  assert.deepEqual(statesOf(reducer.tick()), [], '未到期不该抖动')
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 到期：必须衰减，而且聚合状态要回到还在干活的主会话
  clock.advance(1)
  const decayed = reducer.tick()
  assert.equal(statesOf(decayed).includes(WorkState.ERROR), false, 'ERROR 到期必须衰减')
  assert.equal(reducer.snapshot().state, WorkState.WORKING, '衰减后应由仍在工作的主会话接管')
})

// ── ② 陈旧 ERROR 不得永久压制其它会话 ─────────────────────────────────────

test('🐛 回归②：陈旧的 ERROR 会话（已静默 > staleStickyMs）不得永久压制其它会话的 WORKING', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ includeSubagents: true, now: clock.now })
  const stale = session('stale-1')
  const fresh = session('fresh-1')

  // stale 会话先红了（用一个不会自己过期的粘性来模拟"老代码的永久粘性"）
  reducer.handle(stale, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(stale, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 它沉默很久很久；期间 fresh 会话一直在干活
  clock.advance(DEFAULT_STALE_STICKY_MS + 1000)
  reducer.handle(fresh, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const messages = reducer.handle(fresh, {
    type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' },
  })
  // tick 一跑，陈旧的那个就该让位
  const ticked = reducer.tick()
  assert.equal(
    statesOf([...messages, ...ticked]).includes(WorkState.ERROR), false,
    '陈旧会话不该继续以最高优先级占据聚合状态',
  )
  assert.equal(reducer.snapshot().state, WorkState.WORKING)
  assert.equal(reducer.snapshot().sessionId, 'fresh-1')
})

test('🐛 回归②b：粘住的 WAITING（轮已结束）也必须让位，不能永久压住别人的 WORKING', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ includeSubagents: true, now: clock.now })
  const stale = session('stale-wait')
  const fresh = session('fresh-2')

  // 这个会话在等用户回答一个问题，但那一轮已经结束了（blocked 收尾）→ 问题已作废
  reducer.handle(stale, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(stale, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'blocked' } } })
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  clock.advance(1000)
  reducer.handle(fresh, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(fresh, {
    type: 'tool/call', seq: 2, data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' },
  })
  reducer.tick()
  assert.equal(reducer.snapshot().state, WorkState.WORKING, '轮已结束的 WAITING 不该压住活着的会话')
  assert.equal(reducer.snapshot().sessionId, 'fresh-2')
})

// ── ③ 粘性不阻止"记录新活动" ──────────────────────────────────────────────

test('🐛 回归③：ERROR 粘住期间，新的工具调用仍必须更新 toolName/活动行（不能一动不动）', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ now: clock.now })
  const s = session('s1')

  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { type: 'tool/call', seq: 2, data: { name: 'Read', callId: 'c1', arguments: '{"file_path":"a.js"}' } })
  reducer.handle(s, { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }] } } })
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 红灯还在（没到期），但这个会话继续调工具：可见字段必须跟着动
  clock.advance(500)
  const during = reducer.handle(s, {
    type: 'tool/call',
    seq: 4,
    data: { name: 'pwsh', callId: 'c2', arguments: '{"command":"npm run build"}' },
  })
  assert.equal(reducer.snapshot().state, WorkState.ERROR, '粘性期间不得被绿色覆盖')
  assert.equal(reducer.snapshot().toolName, 'pwsh', '粘性不该阻止记录新活动')
  // 至少有一条 state 消息把新的 toolName 带出去（或文本通道会带）
  const withTool = during.filter((m) => m.kind === 'state' && m.toolName === 'pwsh')
  assert.ok(withTool.length > 0, `新的工具名必须上屏，实际收到 ${JSON.stringify(during.map((m) => [m.kind, m.toolName]))}`)
})

test('🐛 回归③b：工具级红灯很短（≤ toolErrorTtlMs）且下一个 step 就收', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ now: clock.now })
  const s = session('s1')

  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { type: 'tool/call', seq: 2, data: { name: 'Read', callId: 'c1', arguments: '{"file_path":"a.js"}' } })
  reducer.handle(s, { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }] } } })
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 未到期不抖
  clock.advance(DEFAULT_TOOL_ERROR_TTL_MS - 1)
  assert.deepEqual(statesOf(reducer.tick()), [])

  // 到期回落（回落到出错前的 WORKING，而不是 IDLE —— 回合还在继续）
  clock.advance(1)
  assert.equal(statesOf(reducer.tick()).includes(WorkState.ERROR), false)
  assert.equal(reducer.snapshot().state, WorkState.WORKING)

  // 另一条出口：新的 step 立刻收掉工具级红灯
  const r2 = new WorkIconReducer({ now: clock.now })
  r2.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  r2.handle(s, { type: 'tool/call', seq: 2, data: { name: 'Read', callId: 'c1', arguments: '{"file_path":"a.js"}' } })
  r2.handle(s, { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }] } } })
  assert.equal(r2.snapshot().state, WorkState.ERROR)
  r2.handle(s, { type: 'step/start', seq: 4, data: { turn: 1, step: 2 } })
  assert.notEqual(r2.snapshot().state, WorkState.ERROR, 'agent 继续干活 = 工具级红灯应当立即收起')
})

// ── ④ 确认（点击/菜单）清除错误 ───────────────────────────────────────────

test('🐛 回归④：acknowledgeError()（点击图标 / 菜单「清除错误状态」）必须立刻清掉红色', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ now: clock.now })
  const s = session('s1')

  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  clock.advance(100)
  const messages = reducer.acknowledgeError()
  assert.equal(statesOf(messages).includes(WorkState.IDLE), true, '确认后应回落')
  assert.equal(reducer.snapshot().state, WorkState.IDLE)
  // 幂等：没有错误时什么都不发
  assert.deepEqual(reducer.acknowledgeError(), [])
})

test('🐛 回归④b：确认只清 ERROR，不动 WAITING（那是有待回答的问题，不是错误）', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ now: clock.now })
  const s = session('s1')

  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, {
    type: 'tool/call', seq: 2, data: { name: 'ask_user_question', callId: 'c1', arguments: '{}' },
  })
  assert.equal(reducer.snapshot().state, WorkState.WAITING)
  assert.deepEqual(reducer.acknowledgeError(), [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)
})

// ── 出口齐全性：任何粘性都必须有 TTL 或陈旧淘汰 ─────────────────────────────

test('不变式：粘性状态一定带出口（ERROR 有 TTL；WAITING 有陈旧/轮结束淘汰）', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ now: clock.now })
  const s = session('s1')

  // ERROR（tool 级）
  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { type: 'tool/call', seq: 2, data: { name: 'Read', callId: 'c1', arguments: '{}' } })
  reducer.handle(s, { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }] } } })
  assert.equal(reducer.stickyInfoOf(s)?.ttlMs, DEFAULT_TOOL_ERROR_TTL_MS)

  // ERROR（轮级）
  reducer.handle(s, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'error' } } })
  assert.equal(reducer.stickyInfoOf(s)?.ttlMs, DEFAULT_ERROR_TTL_MS)

  // WAITING（审批）：没有 TTL，但必须靠陈旧淘汰兜底
  const waiting = session('s2')
  reducer.handle(waiting, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(waiting, { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'Bash' } })
  assert.equal(reducer.stickyInfoOf(waiting)?.state, WorkState.WAITING)
  assert.equal(reducer.stickyInfoOf(waiting)?.ttlMs, 0)
  clock.advance(DEFAULT_STALE_STICKY_MS + 1)
  // 注意：agent/status 不算"会话动过"（它是每 500ms 的对账信号），
  // 所以这里只更新粗粒度状态，lastEventAt 保持陈旧，tick 才会淘汰它。
  reducer.handleAgentStatus(waiting, 'idle')
  reducer.tick()
  assert.notEqual(reducer.stickyInfoOf(waiting)?.state, WorkState.WAITING, '静默过久的 WAITING 必须被淘汰')
})

test('不变式：agent/status 对账不得刷新"会话还活着"的时间戳（否则陈旧淘汰会被悄悄废掉）', () => {
  const clock = fakeClock()
  const reducer = new WorkIconReducer({ now: clock.now })
  const s = session('s-heartbeat')

  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 模拟插件每 500ms 的对账循环跑很久：会话本身一条事件都没有
  for (let i = 0; i < 200; i += 1) {
    clock.advance(500)
    reducer.handleAgentStatus(s, 'idle')
    if (reducer.snapshot().state !== WorkState.ERROR) break
  }
  assert.equal(reducer.stickyInfoOf(s)?.silentMs >= DEFAULT_STALE_STICKY_MS, true, '对账不该把静默时间清零')
  reducer.tick()
  assert.notEqual(reducer.snapshot().state, WorkState.ERROR, 'TTL 到期必须衰减（对账刷不出"永久红"）')
})
