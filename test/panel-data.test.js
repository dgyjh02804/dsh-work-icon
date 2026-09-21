/**
 * 面板数据层：多对话列表（排序/上限/+N）与**三类严格分离**。
 *
 * 三类口径（用户明确要求，不许混）：
 *   真进度  = 计划完成度（`progress`）+ 子代理完成度（`subagents`）
 *   代理指标 = 轮/步/工具数/耗时（`metrics`）—— 没有分母，**不许画成进度条**
 *   资源指标 = 上下文占用 / 花费（`cost` 已单独一条链路）—— 不是工作进度
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer } from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

const main = (id, cwd = 'C:\\demo') => ({ header: { id, cwd } })
const sub = (id, parent) => ({ header: { id, cwd: 'C:\\demo', origin: 'subagent', parentSession: parent, delegationDepth: 1 } })
const feed = (reducer, s, event, seq) => reducer.handle(s, { seq, ...event })

test('多对话列表：按"活跃优先 + 最近事件"排序，主会话排在子代理前面', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions'])
  const a = main('conv-a', 'C:\\work\\alpha')
  const b = main('conv-b', 'C:\\work\\beta')
  const c = main('conv-c', 'C:\\work\\gamma')

  // a：正在干活；b：只是挂着；c：很久以前活跃
  feed(reducer, a, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, a, { type: 'tool/call', data: { name: 'pwsh', callId: 'x', arguments: '{"command":"npm test"}' } }, 2)
  feed(reducer, b, { type: 'request/header', data: {} }, 1)
  feed(reducer, c, { type: 'request/header', data: {} }, 1)

  // 给 c 一个活跃状态，再让它结束 → 变成"不活跃"
  feed(reducer, c, { type: 'turn/start', data: { turn: 1 } }, 2)
  feed(reducer, c, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }, 3)

  const snap = reducer.mainSessionsSnapshot()
  assert.equal(snap.total, 3)
  assert.equal(snap.items[0].id, 'conv-a', '活跃的排第一')
  assert.equal(snap.items[0].active, true)
  assert.equal(snap.items[0].project, 'alpha')
  // 不活跃的两位都排在后面
  assert.ok(snap.items.slice(1).every((row) => row.active === false))
})

test('多对话列表：上限 + hidden（窗口侧决定显示几行，宿主只保证有界）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions'])
  for (let i = 0; i < 12; i += 1) {
    feed(reducer, main(`conv-${i}`), { type: 'request/header', data: {} }, 1)
  }
  // 原始方法给**完整列表**（窗口想自己排/自己分页都行）
  const all = reducer.mainSessionsSnapshot()
  assert.equal(all.total, 12)
  assert.equal(all.items.length, 12)
  assert.equal(all.hidden, 0)
  // 显式 limit：总数仍是真实的（UI 才能写 +7）
  const bounded = reducer.mainSessionsSnapshot({ limit: 5 })
  assert.equal(bounded.total, 12)
  assert.equal(bounded.items.length, 5)
  assert.equal(bounded.hidden, 7)
  // 上线路的字段一定是有界的（这里是 8，TEXT_CAPS.sessions）
  const [message] = feed(reducer, main('conv-x'), { type: 'request/header', data: {} }, 1)
  assert.equal(message.sessions.total, 13)
  assert.ok(message.sessions.items.length <= 8, '线上载荷有界')
  assert.ok(message.sessions.hidden >= 5)
})

test('多对话列表：子代理不混进"对话"列表（它们走 subagents 那一行）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions', 'subagents'])
  const root = main('root-1')
  feed(reducer, root, { type: 'turn/start', data: { turn: 1 } }, 1)
  for (const id of ['s1', 's2']) {
    feed(reducer, sub(id, 'root-1'), { type: 'turn/start', data: { turn: 1 } }, 1)
  }
  const list = reducer.mainSessionsSnapshot()
  assert.equal(list.total, 1, '对话列表只列对话')
  assert.equal(list.items[0].id, 'root-1')
  // 子代理在 subagents 里
  assert.equal(reducer.subagentsSnapshot().total, 2)
})

test('每行会话都带上自己的真进度（多对话多条进度条的数据基础）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions'])
  const a = main('conv-a')
  const b = main('conv-b')
  feed(reducer, a, { type: 'turn/start', data: {} }, 1)
  feed(reducer, a, { type: 'todo/tree', data: { todos: [
    { content: 'x', status: 'completed' },
    { content: 'y', status: 'pending' },
  ] } }, 2)
  feed(reducer, b, { type: 'turn/start', data: {} }, 1)
  feed(reducer, b, { type: 'todo/write', data: { todos: [{ content: 'p', status: 'pending' }] } }, 2)

  const list = reducer.mainSessionsSnapshot()
  const rowA = list.items.find((row) => row.id === 'conv-a')
  const rowB = list.items.find((row) => row.id === 'conv-b')
  assert.deepEqual([rowA.progress.done, rowA.progress.total], [1, 2])
  assert.equal(rowA.progress.mode, 'tree')
  assert.deepEqual([rowB.progress.done, rowB.progress.total], [0, 1])
  assert.equal(rowB.progress.mode, 'flat')
})

test('会话行：没有 todo 的对话**不带** progress 字段（不是 0%，是不适用）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions'])
  const a = main('conv-a')
  feed(reducer, a, { type: 'turn/start', data: {} }, 1)
  const row = reducer.mainSessionsSnapshot().items[0]
  assert.equal('progress' in row, false)
  assert.equal(row.active, true)
  assert.equal(typeof row.lastEventAt, 'number')
})

test('三类严格分离：真进度 / 代理指标 / 资源指标各有独立字段名', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress', 'subagents', 'sessions', 'cost'])
  const root = main('root-1')
  // 子代理先动（避免它抢走聚合焦点：焦点是"最近活跃"的那条）
  feed(reducer, sub('s1', 'root-1'), { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, root, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, root, { type: 'todo/tree', data: { todos: [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'in_progress' },
    { content: 'c', status: 'pending' },
  ] } }, 2)
  reducer.setCost({ status: 'ok', cost: { CNY: 1.23 }, priced: 5, unpriced: 0 })

  const [message] = feed(reducer, root, { type: 'session/title', data: { title: 'T' } }, 9)
  assert.equal(message.session, 'root-1', '焦点应在主会话上')
  // 真进度
  assert.equal(message.progress.applicable, true)
  assert.deepEqual([message.progress.done, message.progress.total], [1, 3])
  assert.equal(message.subagents.total, 1)
  // 代理指标独立字段
  assert.equal(message.metrics.toolCalls, 0)
  assert.equal(message.metrics.turns, 1)
  // 资源指标独立字段
  assert.equal(message.cost.cost.CNY, 1.23)
  // 交叉污染检查
  for (const forbidden of ['cost', 'turns', 'toolCalls', 'elapsedMs', 'subagents']) {
    assert.equal(forbidden in message.progress, false, `progress 不该含 ${forbidden}`)
  }
  assert.equal('cost' in message.metrics, false)
  assert.equal('progress' in message.cost, false)
})

test('能力门控逐项独立：只声明 sessions 时只有 sessions 字段', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions'])
  const root = main('root-1')
  feed(reducer, root, { type: 'turn/start', data: { turn: 1 } }, 1)
  const [message] = feed(reducer, root, { type: 'todo/write', data: { todos: [{ content: 'a', status: 'pending' }] } }, 2)
  assert.ok(message.sessions, '声明了就发')
  assert.equal('progress' in message, false)
  assert.equal('metrics' in message, false)
  assert.equal('subagents' in message, false)
  assert.equal('todos' in message, false)
})

test('未知能力被忽略（前向兼容：窗口可以声明宿主还不认识的能力）', () => {
  const reducer = new WorkIconReducer()
  const accepted = reducer.setCapabilities(['progress', 'teleport', 42, null])
  assert.deepEqual([...accepted], ['progress'])
})

test('sessions 排序在子代理抢焦点时不乱：行的 active 反映自己的活跃度', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['sessions'])
  const a = main('conv-a')
  const b = main('conv-b')
  feed(reducer, a, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, a, { type: 'tool/call', data: { name: 'pwsh', callId: 'x', arguments: '{"command":"npm test"}' } }, 2)
  feed(reducer, b, { type: 'turn/start', data: { turn: 1 } }, 1)
  feed(reducer, b, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }, 2)
  const list = reducer.mainSessionsSnapshot()
  const rowA = list.items.find((row) => row.id === 'conv-a')
  const rowB = list.items.find((row) => row.id === 'conv-b')
  assert.equal(rowA.active, true)
  assert.equal(rowB.active, false)
  assert.equal(list.items[0].id, 'conv-a')
  assert.equal(reducer.snapshot().state, WorkState.WORKING, '焦点是还在干活的那个')
})
