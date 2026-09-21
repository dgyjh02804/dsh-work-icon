/**
 * 子代理账本：用户要的"总共 12 个子代理，7 个已完成，当前正在跑 XXX"。
 *
 * 关键纪律：
 *   - 终局来自 `subagent/end{stopReason}`（权威）；收不到时退化为子会话自己的 `turn/end` reason。
 *   - **已结算账本**：子会话被 dispose 后计数**不许变小**（否则用户会看到数字往回跳）。
 *   - `listChildren/listDescendants` 的 `activity` 只是存储活跃度，**不当完成用**。
 *   - 单节点百分比**拿不到**（实测子代理不写 todo）→ 协议里不出现任何 percent 字段。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { SubagentLedger, outcomeOf, subagentsDigest } from '../src/subagents.js'
import { WorkIconReducer } from '../src/reducer.js'

const sub = (id, parent) => ({ header: { id, cwd: 'C:\\demo', origin: 'subagent', parentSession: parent, delegationDepth: 1 } })
const main = (id) => ({ header: { id, cwd: 'C:\\demo' } })

test('outcomeOf：终局归类（max-tokens/aborted 归"没做完就结束"，不是失败）', () => {
  assert.equal(outcomeOf('completed'), 'done')
  assert.equal(outcomeOf('error'), 'failed')
  assert.equal(outcomeOf('refusal'), 'failed')
  assert.equal(outcomeOf('max-tokens'), 'stopped')
  assert.equal(outcomeOf('aborted'), 'stopped')
  assert.equal(outcomeOf('什么鬼'), 'stopped')
  assert.equal(outcomeOf(undefined), 'stopped')
})

test('账本：start/end + descriptor(label) → 计数与名字', () => {
  const ledger = new SubagentLedger()
  ledger.noteSession('c1', { parentId: 'root', depth: 1 })
  ledger.noteDescriptor('c1', { mode: 'one-shot', provider: 'local', label: '查花费链路' })
  ledger.noteStart('c1')
  ledger.noteSession('c2', { parentId: 'root', depth: 1 })
  ledger.noteDescriptor('c2', { mode: 'one-shot', provider: 'local', label: '查推理文本' })
  ledger.noteStart('c2')
  ledger.noteEnd('c2', 'completed')

  const snap = ledger.snapshot('root')
  assert.equal(snap.total, 2)
  assert.equal(snap.running, 1)
  assert.equal(snap.done, 1)
  assert.deepEqual(snap.runningLabels, ['查花费链路'])
  const c2 = snap.items.find((item) => item.id === 'c2')
  assert.equal(c2.label, '查推理文本')
  assert.equal(c2.status, 'done')
  assert.equal(c2.stopReason, 'completed')
})

test('🐛 已结算账本：子会话被 dispose 后"已完成"计数**不许变小**', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['subagents'])
  const root = main('main-1')
  reducer.handle(root, { type: 'turn/start', seq: 1, data: { turn: 1 } })

  const children = ['a', 'b', 'c', 'd']
  for (const [index, id] of children.entries()) {
    const session = sub(id, 'main-1')
    reducer.handle(session, { type: 'subagent/descriptor', seq: 1, data: { mode: 'one-shot', label: `任务${id}`, provider: 'local' } })
    reducer.handle(session, { type: 'turn/start', seq: 2, data: { turn: 1 } })
    if (index < 3) reducer.handle(session, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } })
    reducer.subagentLedger.noteEnd(id, 'completed')
  }
  const before = reducer.subagentsSnapshot()
  assert.equal(before.total, 4)
  assert.equal(before.done, 4)

  // 三个子会话被回收（真实场景：跑完就 dispose）
  for (const id of children) reducer.disposeSession(sub(id, 'main-1'))

  const after = reducer.subagentsSnapshot()
  assert.equal(after.total, 4, '总数不许变小')
  assert.equal(after.done, 4, '已完成数不许变小')
  assert.equal(after.running, 0)
})

test('从未拿到终局就消失 → 如实标 stopped(aborted)，**不假装完成**', () => {
  const ledger = new SubagentLedger()
  ledger.noteSession('c9', { parentId: 'root', depth: 1 })
  ledger.noteStart('c9')
  ledger.remove('c9')
  const snap = ledger.snapshot('root')
  assert.equal(snap.done, 0, '没完成就不能算完成')
  assert.equal(snap.stopped, 1)
  assert.equal(snap.items[0].stopReason, 'aborted')
})

test('退路：没有 subagent/end 时用子会话自己的 turn/end reason settle', () => {
  const ledger = new SubagentLedger()
  ledger.noteSession('child', { parentId: 'root', depth: 1 })
  ledger.noteStart('child')
  ledger.noteTurnEnd('child', 'max-tokens')
  assert.equal(ledger.snapshot('root').stopped, 1)
  // 真终局优先：先 settle 后到的事件不许覆盖
  ledger.noteEnd('child', 'completed')
  assert.equal(ledger.snapshot('root').stopped, 1, '已结算的不被覆盖')
  assert.equal(ledger.snapshot('root').done, 0)
})

test('可续会话（continuable）的一轮结束 ≠ 子代理结束', () => {
  const ledger = new SubagentLedger()
  ledger.noteSession('cont', { parentId: 'root', depth: 1 })
  ledger.noteDescriptor('cont', { mode: 'continuable', label: '持续对话', provider: 'local' })
  ledger.noteStart('cont')
  ledger.noteTurnEnd('cont', 'completed')
  const snap = ledger.snapshot('root')
  assert.equal(snap.done, 0, '可续会话还能再干活，不该计入完成')
  assert.equal(snap.unknown, 1)
  // 真终局仍然作数
  ledger.noteEnd('cont', 'completed')
  assert.equal(ledger.snapshot('root').done, 1)
})

test('树：父子谱系、深度、前序排列（父在子前）', () => {
  const ledger = new SubagentLedger()
  ledger.noteSession('p', { parentId: 'root', depth: 1 })
  ledger.noteDescriptor('p', { mode: 'one-shot', label: '父任务', provider: 'local' })
  ledger.noteStart('p')
  ledger.noteSession('g1', { parentId: 'p', depth: 2 })
  ledger.noteDescriptor('g1', { mode: 'one-shot', label: '孙任务1', provider: 'local' })
  ledger.noteStart('g1')
  ledger.noteSession('g2', { parentId: 'p', depth: 2 })
  ledger.noteDescriptor('g2', { mode: 'one-shot', label: '孙任务2', provider: 'local' })
  ledger.noteStart('g2')
  ledger.noteEnd('g2', 'completed')

  const snap = ledger.snapshot('root')
  assert.equal(snap.total, 3)
  assert.deepEqual(snap.items.map((item) => item.id), ['p', 'g1', 'g2'], '前序：父在子前')
  assert.deepEqual(snap.items.map((item) => item.depth), [1, 2, 2])
  assert.equal(snap.items[1].parent, 'p')
})

test('🐛 协议里**没有**任何百分比字段（单节点进度拿不到，不许造）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['subagents'])
  const root = main('main-1')
  reducer.handle(root, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const child = sub('c1', 'main-1')
  reducer.handle(child, { type: 'subagent/descriptor', seq: 1, data: { mode: 'one-shot', label: 'X', provider: 'local' } })
  reducer.handle(child, { type: 'turn/start', seq: 2, data: { turn: 1 } })
  const [message] = reducer.handle(root, { type: 'session/title', seq: 3, data: { title: 'T' } })
  assert.ok(message.subagents)
  for (const item of message.subagents.items) {
    for (const forbidden of ['percent', 'progress', 'ratio', 'done', 'total']) {
      assert.equal(forbidden in item, false, `子代理节点不该有 ${forbidden}（拿不到）`)
    }
  }
  for (const forbidden of ['percent', 'ratio']) {
    assert.equal(forbidden in message.subagents, false)
  }
})

test('计数是"可见事实"：只给 total/running/done/failed/stopped/unknown + hidden', () => {
  const ledger = new SubagentLedger()
  for (const [index, id] of ['a', 'b', 'c'].entries()) {
    ledger.noteSession(id, { parentId: 'root', depth: 1 })
    ledger.noteStart(id)
    if (index === 0) ledger.noteEnd(id, 'completed')
    if (index === 1) ledger.noteEnd(id, 'error')
  }
  const snap = ledger.snapshot('root')
  assert.deepEqual(
    { total: snap.total, running: snap.running, done: snap.done, failed: snap.failed, stopped: snap.stopped, unknown: snap.unknown },
    { total: 3, running: 1, done: 1, failed: 1, stopped: 0, unknown: 0 },
  )
})

test('上限与 hidden（节点多时不让载荷无界）', () => {
  const ledger = new SubagentLedger()
  for (let i = 0; i < 40; i += 1) {
    ledger.noteSession(`n${i}`, { parentId: 'root', depth: 1 })
    ledger.noteStart(`n${i}`)
  }
  const snap = ledger.snapshot('root', { maxNodes: 12 })
  assert.equal(snap.total, 40)
  assert.equal(snap.items.length, 12)
  assert.equal(snap.hidden, 28)
})

test('子代理计数指纹：不计时间戳（否则每秒抖动都会重推 state）', () => {
  const ledger = new SubagentLedger()
  ledger.noteSession('c1', { parentId: 'root', depth: 1 })
  ledger.noteStart('c1')
  const a = subagentsDigest(ledger.snapshot('root'))
  ledger.noteLive('c1', { turnActive: true, toolCalls: 5, at: Date.now() + 5000 })
  const b = subagentsDigest(ledger.snapshot('root'))
  assert.equal(a, b, '只有工具数/时间变化不该改变指纹')
  ledger.noteEnd('c1', 'completed')
  assert.notEqual(subagentsDigest(ledger.snapshot('root')), a, '终局必须改变指纹')
})

// ── 名字（label）：生产里 descriptor 事件到不了，必须靠官方枚举补 ──────────────

test('🐛 生产的实际形态：descriptor 事件没到时，项里**没有** label（面板只能显示"(未命名)"）', () => {
  // 用户机器上 helper.log 的真实 dump：
  //   {"keys":["id","depth","status","parent","toolCalls"],"id":"25a2e90a-…"}
  // —— 既没有 label 也没有 mode，说明 descriptor 事件压根没到宿主。
  const reducer = new WorkIconReducer({ includeSubagents: false })
  reducer.handle(main('root'), { type: 'request/header', seq: 1, data: {} })
  reducer.handle(sub('kid', 'root'), { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(sub('kid', 'root'), { type: 'tool/call', seq: 2, data: { turn: 1, step: 1, toolName: 'read_file', callId: 'c', arguments: '{}' } })
  const item = reducer.subagentsSnapshot().items[0]
  assert.equal(item.label, undefined, '没有名字来源时不许编名字')
  assert.equal(item.mode, undefined)
  assert.deepEqual(Object.keys(item).sort(), ['depth', 'id', 'parent', 'status', 'toolCalls'], '与生产 dump 的键集合一致')
})

test('🐛 名册（listDescendants）补齐 label/mode —— 这就是让面板不再显示"(未命名)"的那一步', () => {
  const reducer = new WorkIconReducer({ includeSubagents: false })
  reducer.handle(main('root'), { type: 'request/header', seq: 1, data: {} })
  reducer.handle(sub('kid', 'root'), { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.equal(reducer.subagentsSnapshot().items[0].label, undefined, '补之前没有')

  // 官方枚举条目（`list-children.d.ts:45-52` 的形状，label 来自 descriptor 折出来的投影值）
  const changed = reducer.applySubagentRoster([
    { kind: 'child', id: 'kid', activity: 'running', hasChildren: false, mode: 'continuable', label: 'Build host-side state bridge plugin', parentId: 'root', depth: 1 },
  ])
  assert.equal(changed, true, '补齐了新信息应报告"有变化"（调用方据此重推 state）')
  const item = reducer.subagentsSnapshot().items[0]
  assert.equal(item.label, 'Build host-side state bridge plugin')
  assert.equal(item.mode, 'continuable')
  // 幂等：再喂一遍不该再报"有变化"（否则会每次刷新都重推一条 state）
  assert.equal(reducer.applySubagentRoster([
    { kind: 'child', id: 'kid', activity: 'running', hasChildren: false, mode: 'continuable', label: 'Build host-side state bridge plugin', parentId: 'root', depth: 1 },
  ]), false)
})

test('名字的纪律：diagnostic 条目与空 label 都不许编名字（空态要明确）', () => {
  const reducer = new WorkIconReducer({ includeSubagents: false })
  reducer.handle(main('root'), { type: 'request/header', seq: 1, data: {} })
  reducer.handle(sub('kid', 'root'), { type: 'turn/start', seq: 1, data: { turn: 1 } })
  // diagnostic（corrupt / unsupported / unavailable）：官方明确不给名字
  reducer.applySubagentRoster([
    { kind: 'diagnostic', id: 'kid', reason: 'corrupt' },
  ])
  assert.equal(reducer.subagentsSnapshot().items[0].label, undefined)
  // one-shot 的 label 是可选的（descriptor.d.ts:61）⇒ 缺失时也不能写成空串
  reducer.applySubagentRoster([
    { kind: 'child', id: 'kid', activity: 'inactive', hasChildren: false, mode: 'one-shot', parentId: 'root', depth: 1 },
  ])
  const item = reducer.subagentsSnapshot().items[0]
  assert.equal(item.label, undefined, '缺 label 不许写成 ""（空串会被当成"有名字但为空"）')
  assert.equal(item.mode, 'one-shot', 'mode 该补上')
})

test('主会话不进子代理账本（否则"子代理总数"会把你自己算进去）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['subagents'])
  const root = main('main-1')
  reducer.handle(root, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.equal(reducer.subagentsSnapshot().total, 0)
})
