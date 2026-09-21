import test from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer, STATE_RANK } from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

function session(id, extra = {}) {
  return { header: { id, cwd: 'C:\\Users\\david\\Desktop\\构建\\demo', ...extra } }
}

/** 按权威类型构造：'tool/call' 的 arguments 是未解析的 JSON 字符串。 */
function toolCall(name, callId, args = {}) {
  return { type: 'tool/call', turn: 1, step: 1, data: { callId, name, arguments: JSON.stringify(args) } }
}

function statesOf(messages) {
  return messages.filter((message) => message.kind === 'state').map((message) => message.state)
}

test('优先级表：WAITING > ERROR > WORKING > THINKING > IDLE，DISCONNECTED 最低', () => {
  assert.ok(STATE_RANK.WAITING > STATE_RANK.ERROR)
  assert.ok(STATE_RANK.ERROR > STATE_RANK.WORKING)
  assert.ok(STATE_RANK.WORKING > STATE_RANK.THINKING)
  assert.ok(STATE_RANK.THINKING > STATE_RANK.IDLE)
  assert.ok(STATE_RANK.IDLE > STATE_RANK.DISCONNECTED)
})

test('多会话优先级：一个 WORKING 一个 WAITING 时对外显示 WAITING', () => {
  const reducer = new WorkIconReducer()
  const a = session('a')
  const b = session('b')

  reducer.handle(a, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.deepEqual(
    statesOf(reducer.handle(a, { ...toolCall('Bash', 'c1', { command: 'ls -la' }), seq: 2 })),
    [WorkState.WORKING],
  )

  reducer.handle(b, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.deepEqual(
    statesOf(reducer.handle(b, { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'Bash' } })),
    [WorkState.WAITING],
  )
  assert.equal(reducer.snapshot().state, WorkState.WAITING)
  assert.equal(reducer.snapshot().sessionId, 'b')

  // 反向竞争：WAITING 已在屏上时，另一个会话进入 WORKING 不许抢镜
  const competing = reducer.handle(a, { ...toolCall('Write', 'c2'), seq: 3 })
  assert.deepEqual(competing, [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  // 等待被处理掉之后，显示回到"还在干活"的那个会话
  assert.deepEqual(
    statesOf(reducer.handle(b, { type: 'approval/decided', seq: 3, data: { id: 'a1', outcome: 'approved' } })),
    [WorkState.WORKING],
  )
  assert.equal(reducer.snapshot().sessionId, 'a')

  // DISCONNECTED 是 host 级状态，永远不跟活着的会话竞争
  assert.deepEqual(reducer.disposeSession(b), [])
  assert.equal(reducer.snapshot().state, WorkState.WORKING)

  // 最后一个会话也没了 → 才轮到 DISCONNECTED
  assert.deepEqual(statesOf(reducer.disposeSession(a)), [WorkState.DISCONNECTED])
})

test('粘性：WAITING 之后大量 assistant/chunk 不会掉回 THINKING', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1 })
  assert.deepEqual(
    statesOf(reducer.handle(s, { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'Bash' } })),
    [WorkState.WAITING],
  )

  const produced = []
  for (let i = 0; i < 50; i += 1) {
    produced.push(...reducer.handle(s, { type: 'assistant/chunk', seq: 10 + i, data: { text: 'x' } }))
  }
  for (let i = 0; i < 20; i += 1) {
    produced.push(...reducer.handle(s, { type: 'step/start', seq: 100 + i, data: {} }))
  }
  assert.deepEqual(produced, [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  // 另一个新会话在同一时刻喷 chunk，也不能把 WAITING 挤下去
  const other = session('s2')
  const foreign = []
  for (let i = 0; i < 20; i += 1) foreign.push(...reducer.handle(other, { type: 'assistant/chunk', seq: i + 1 }))
  assert.deepEqual(foreign, [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  // 用户处理后（user/message）粘性才解除
  assert.deepEqual(statesOf(reducer.handle(s, { type: 'user/message', seq: 999, data: {} })), [WorkState.THINKING])
})

test('粘性：ERROR 不被同轮的 THINKING 覆盖，也不被绿色 OK 盖掉', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1 })
  const errored = reducer.handle(s, { type: 'tool/result', seq: 2, data: { callId: 'c1', error: { code: 'E_BOOM' } } })
  assert.deepEqual(statesOf(errored), [WorkState.ERROR])
  assert.equal(errored[0].errorCode, 'E_BOOM')

  for (let i = 0; i < 30; i += 1) {
    assert.deepEqual(reducer.handle(s, { type: 'assistant/chunk', seq: 10 + i }), [])
  }
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 本轮 completed：底部有未处理的错误，不能用 SUCCESS 盖掉
  assert.deepEqual(reducer.handle(s, { type: 'turn/end', seq: 50, data: { reason: { kind: 'completed' } } }), [])
  assert.equal(reducer.snapshot().state, WorkState.ERROR)

  // 新一轮开始才解除
  assert.deepEqual(statesOf(reducer.handle(s, { type: 'turn/start', seq: 51 })), [WorkState.THINKING])
})

test('去重：连续 100 个同类事件只产出 1 条 state 消息', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1 })

  const produced = []
  for (let i = 0; i < 100; i += 1) {
    produced.push(...reducer.handle(s, { ...toolCall('Bash', `c${i}`, { command: 'ls -la' }), seq: 2 + i }))
  }
  assert.equal(produced.length, 1, `期望只有 1 条 state，实际 ${produced.length}`)
  assert.equal(produced[0].kind, 'state')
  assert.equal(produced[0].state, WorkState.WORKING)

  // 状态已经在 WAITING 上时，重复的 approval/asked 同样只发第一条
  const repeated = []
  for (let i = 0; i < 100; i += 1) {
    repeated.push(...reducer.handle(s, { type: 'approval/asked', seq: 300 + i, data: { id: 'a1', toolName: 'Bash' } }))
  }
  assert.equal(repeated.length, 1, `期望只有 1 条 state，实际 ${repeated.length}`)
  assert.equal(repeated[0].state, WorkState.WAITING)

  // 工具还开着的时候连喷 chunk，一条都不发
  const chunks = []
  for (let i = 0; i < 100; i += 1) chunks.push(...reducer.handle(s, { type: 'assistant/chunk', seq: 500 + i }))
  assert.deepEqual(chunks, [])
})

test('去重不会吃掉真正的变化：状态/工具/任务任一变化都要重发', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  const first = reducer.handle(s, { ...toolCall('Bash', 'c1', { command: 'ls' }), seq: 1 })
  assert.deepEqual(statesOf(first), [WorkState.WORKING])
  // 换工具 → activity 与 toolName 变了 → 重发
  const second = reducer.handle(s, { ...toolCall('Write', 'c2'), seq: 2 })
  assert.deepEqual(statesOf(second), [WorkState.WORKING])
  assert.equal(second[0].activity, 'editing')
  // todo 变化 → task 变了 → 重发（状态不变也应发）
  const third = reducer.handle(s, { type: 'todo/write', seq: 3, data: { todos: [{ content: '写测试', status: 'in_progress' }] } })
  assert.equal(third.length, 1)
  assert.equal(third[0].task, '写测试')
})

test('SUCCESS 是瞬态：2.5s 后由 tick 回落到 IDLE', () => {
  let clock = 1_000_000
  const reducer = new WorkIconReducer({ now: () => clock })
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1 })
  assert.deepEqual(
    statesOf(reducer.handle(s, { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } })),
    [WorkState.SUCCESS],
  )
  clock += 1000
  assert.deepEqual(reducer.tick(), [], '2.5s 未到之前不该回落')
  clock += 2000
  assert.deepEqual(statesOf(reducer.tick()), [WorkState.IDLE])
  assert.equal(reducer.snapshot().state, WorkState.IDLE)
  // 回落之后不再重复发
  assert.deepEqual(reducer.tick(), [])
})

test('turn/end 的三种 reason：completed→SUCCESS，aborted→IDLE，blocked→WAITING', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1 })
  assert.deepEqual(statesOf(reducer.handle(s, { type: 'turn/end', seq: 2, data: { reason: { kind: 'aborted' } } })), [WorkState.IDLE])
  reducer.handle(s, { type: 'turn/start', seq: 3 })
  assert.deepEqual(statesOf(reducer.handle(s, { type: 'turn/end', seq: 4, data: { reason: { kind: 'blocked' } } })), [WorkState.WAITING])
  // blocked 之后同样粘住，chunk 不能把它打回 THINKING
  assert.deepEqual(reducer.handle(s, { type: 'assistant/chunk', seq: 5 }), [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)
})

test('disconnect() 显式把宿主侧置为 DISCONNECTED', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1 })
  assert.deepEqual(statesOf(reducer.disconnect()), [WorkState.DISCONNECTED])
  assert.equal(reducer.pulsePayload().state, WorkState.DISCONNECTED)
})

test('心跳载荷带 state/activity，且不产出 state 消息', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { ...toolCall('Bash', 'c1', { command: 'pnpm test' }), seq: 1 })
  const payload = reducer.pulsePayload()
  assert.equal(payload.state, WorkState.WORKING)
  assert.equal(payload.activity, 'testing')
  assert.equal(payload.session, 's1')
  assert.ok(payload.elapsedMs === undefined || payload.elapsedMs >= 0)
})

test('agent/status：running 兜底补上 turn/start 之前的空窗，idle 修正悬挂状态', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')

  // 还没见到 turn/start，官方信号先说在跑 → 立刻进入 THINKING
  assert.deepEqual(statesOf(reducer.handleAgentStatus(s, 'running')), [WorkState.THINKING])
  assert.equal(reducer.snapshot().agentStatus, 'running')
  // 重复的 running 不刷屏
  assert.deepEqual(reducer.handleAgentStatus(s, 'running'), [])

  // idle 把推断态修回 IDLE
  assert.deepEqual(statesOf(reducer.handleAgentStatus(s, 'idle')), [WorkState.IDLE])
  // 一个从没启动过的 agent 报 idle：不建记录、不发消息
  assert.deepEqual(reducer.handleAgentStatus(session('never-seen'), 'idle'), [])
  assert.equal(reducer.snapshot().sessionCount, 1)
})

test('agent/status 不破坏粘性与优先级：WAITING 期间 running 不能把它拉回 THINKING', () => {
  const reducer = new WorkIconReducer()
  const a = session('a')
  const b = session('b')

  reducer.handle(a, { ...toolCall('Bash', 'c1', { command: 'ls' }), seq: 1 })
  reducer.handle(b, { type: 'approval/asked', seq: 1, data: { id: 'a1', toolName: 'Bash' } })
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  // b 的 agent 报 running：粘性 WAITING 必须纹丝不动
  assert.deepEqual(reducer.handleAgentStatus(b, 'running'), [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  // b 的 agent 报 idle：粘性同样不能被 idle 解除
  assert.deepEqual(reducer.handleAgentStatus(b, 'idle'), [])
  assert.equal(reducer.snapshot().state, WorkState.WAITING)

  // 处理掉等待后，agent/status 才能重新影响 b
  reducer.handle(b, { type: 'approval/decided', seq: 2, data: { id: 'a1', outcome: 'approved' } })
  assert.equal(reducer.snapshot().sessionId, 'a')
})

test('agent/status 不会盖掉正在进行的回合与还没到期的 SUCCESS', () => {
  let clock = 1_000_000
  const reducer = new WorkIconReducer({ now: () => clock })
  const s = session('s1')

  // 回合进行中（turnActive）：idle 信号不许抢走 WORKING
  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { ...toolCall('Bash', 'c1', { command: 'pnpm test' }), seq: 2 })
  assert.deepEqual(reducer.handleAgentStatus(s, 'idle'), [])
  assert.equal(reducer.snapshot().state, WorkState.WORKING)

  // SUCCESS 的 2.5s 闪光期内：idle / running 都不能把它换掉
  reducer.handle(s, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(reducer.snapshot().state, WorkState.SUCCESS)
  assert.deepEqual(reducer.handleAgentStatus(s, 'idle'), [])
  assert.deepEqual(reducer.handleAgentStatus(s, 'running'), [])
  assert.equal(reducer.snapshot().state, WorkState.SUCCESS)

  // 闪光期过了由 tick 回落，之后 running 才重新点亮
  clock += 3000
  assert.deepEqual(statesOf(reducer.tick()), [WorkState.IDLE])
  assert.deepEqual(statesOf(reducer.handleAgentStatus(s, 'running')), [WorkState.THINKING])
})

test('agent/status 尊重 includeSubagents：关掉时不参与取舍', () => {
  const child = { header: { id: 'c1', origin: 'subagent' } }
  const excluded = new WorkIconReducer({ includeSubagents: false })
  assert.deepEqual(excluded.handleAgentStatus(child, 'running'), [])
  assert.equal(excluded.snapshot().sessionCount, 0)

  const included = new WorkIconReducer({ includeSubagents: true })
  assert.deepEqual(statesOf(included.handleAgentStatus(child, 'running')), [WorkState.THINKING])
})
