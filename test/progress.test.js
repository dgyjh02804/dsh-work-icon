/**
 * 两套预设各自的进度真相来源（用户点名要求：各跑一次）。
 *
 *   `standard`    预设 → 扁平工具 → `todo/write { todos: [{content,status}] }`
 *   `coding-tree` 预设 → 树形工具 → `todo/tree  { todos: [{content,status,children?}] }`
 *
 * 实测缺口：`coding-tree` **绝不写 `todo/write`**（dsh-tool-todo-tree 明确拒绝共存），
 * 所以只支持扁平那条的话，用户在真实预设下进度会永远为空。
 *
 * 同时覆盖退化情况：无 todo（→ **不适用**，不是 0%）、分母跳变（**不单调化** + planChange）、
 * 任务被清空（→ 回到不适用）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer } from '../src/reducer.js'
import { countFlatItems, countTreeLeaves, isRealProgress, progressPayload } from '../src/progress.js'
import { WorkState } from '../src/protocol.js'

const session = (id) => ({ header: { id, cwd: 'C:\\demo' } })

/** 只取进度：宿主侧用 progressSnapshot()，线上路径用 state 消息。 */
function progressOf(reducer) {
  return reducer.progressSnapshot()
}

function feed(reducer, s, event, seq) {
  return reducer.handle(s, { seq, ...event })
}

// ── 预设 A：coding-tree（todo/tree） ────────────────────────────────────────

const CODING_TREE_PLAN = [
  {
    content: '阶段一：调研',
    status: 'completed',
    children: [
      { content: '查花费链路', status: 'completed' },
      { content: '查推理文本', status: 'completed' },
    ],
  },
  {
    content: '阶段二：实现',
    status: 'in_progress',
    children: [
      { content: 'todo/tree 支持', status: 'completed' },
      { content: '子代理账本', status: 'in_progress' },
      { content: '协议字段', status: 'pending' },
    ],
  },
  { content: '阶段三：验收', status: 'pending' },
]

test('预设 coding-tree：todo/tree 按**叶节点**计数，父节点不重复计数', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('tree-1')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  feed(reducer, s, { type: 'todo/tree', data: { todos: CODING_TREE_PLAN } }, 2)

  const progress = progressOf(reducer)
  // 叶子 = 查花费链路、查推理文本、todo/tree 支持、子代理账本、协议字段、阶段三 = 6
  assert.equal(progress.total, 6, '分母按叶节点')
  assert.equal(progress.done, 3, '完成 3 个叶子')
  assert.equal(progress.applicable, true)
  assert.equal(progress.mode, 'tree')
  assert.equal(progress.unit, 'leaf')
  assert.equal(progress.inProgress, '子代理账本')
  // 父节点"阶段一/阶段二"不是叶子，不计入分母（它们完成是推导出来的）
  assert.equal(progress.total, countTreeLeaves(CODING_TREE_PLAN).total)
  assert.equal(isRealProgress(progress), true)
})

test('预设 coding-tree：树形计划也写进 todos 载荷（带 depth，供窗口画缩进）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['todos'])
  const s = session('tree-2')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  const [message] = feed(reducer, s, { type: 'todo/tree', data: { todos: CODING_TREE_PLAN } }, 2)
  assert.ok(Array.isArray(message.todos.items))
  assert.equal(message.todos.items[0].depth, 1, '顶层 depth=1')
  assert.equal(message.todos.items[1].depth, 2, '子节点 depth=2（前序扁平化）')
  assert.ok(message.todos.items.length <= 12)
})

// ── 预设 B：standard（todo/write） ────────────────────────────────────────

const FLAT_PLAN = [
  { content: '写协议', status: 'completed' },
  { content: '写归约', status: 'completed' },
  { content: '写测试', status: 'in_progress' },
  { content: '写文档', status: 'pending' },
]

test('预设 standard：todo/write 按条目计数', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('flat-1')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  feed(reducer, s, { type: 'todo/write', data: { todos: FLAT_PLAN } }, 2)

  const progress = progressOf(reducer)
  assert.equal(progress.total, 4)
  assert.equal(progress.done, 2)
  assert.equal(progress.mode, 'flat')
  assert.equal(progress.unit, 'item')
  assert.equal(progress.inProgress, '写测试')
  assert.deepEqual(countFlatItems(FLAT_PLAN), { done: 2, total: 4, inProgress: '写测试' })
})

test('两套预设最终产出**同形**的进度载荷（窗口不需要分支渲染）', () => {
  const tree = new WorkIconReducer()
  tree.setCapabilities(['progress'])
  const flat = new WorkIconReducer()
  flat.setCapabilities(['progress'])
  const st = session('t')
  const sf = session('f')
  feed(tree, st, { type: 'turn/start', data: {} }, 1)
  feed(flat, sf, { type: 'turn/start', data: {} }, 1)
  feed(tree, st, { type: 'todo/tree', data: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] } }, 2)
  feed(flat, sf, { type: 'todo/write', data: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] } }, 2)
  const a = progressOf(tree)
  const b = progressOf(flat)
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), '键集合一致（只有 mode/unit 的取值不同）')
  assert.equal(a.done, b.done)
  assert.equal(a.total, b.total)
})

// ── 退化情况 ─────────────────────────────────────────────────────────────

test('🐛 退化①：完全没有 todo → `applicable:false`，**不是 0%**', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('no-todo')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  feed(reducer, s, { type: 'tool/call', data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' } }, 2)

  const progress = progressOf(reducer)
  assert.equal(progress, undefined, '宿主内部就是不适用')
  assert.equal(isRealProgress(progress), false, '窗口据此不画条')
  // 线上载荷显式带 applicable:false，且**没有 done/total**（免得被当 0 渲染）
  const [message] = feed(reducer, s, { type: 'session/title', data: { title: 'X' } }, 3)
  assert.deepEqual(message.progress, { applicable: false, reason: 'no-todos' })
  assert.equal('done' in message.progress, false)
  assert.equal('total' in message.progress, false)
})

test('🐛 退化②：任务被清空 → 回到 applicable:false（不是 0%）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('cleared')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  feed(reducer, s, { type: 'todo/tree', data: { todos: [{ content: 'a', status: 'completed' }] } }, 2)
  assert.equal(progressOf(reducer).total, 1)
  feed(reducer, s, { type: 'todo/tree', data: { todos: [] } }, 3)
  const after = progressOf(reducer)
  assert.equal(after.applicable, false)
  assert.equal('done' in after, false, '清空后不许残留 done/total')
})

test('🐛 退化③：中途新增 todo → 百分比**下降**（不单调化）+ planChange 供 UI 写"计划已更新"', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('grow')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  feed(reducer, s, { type: 'todo/tree', data: { todos: [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'pending' },
    { content: 'd', status: 'pending' },
    { content: 'e', status: 'pending' },
    { content: 'f', status: 'pending' },
  ] } }, 2)
  const before = progressOf(reducer)
  assert.deepEqual([before.done, before.total], [2, 6])
  assert.equal(before.done / before.total, 2 / 6)

  // 模型发现还有活 → 新增 5 条
  const [message] = feed(reducer, s, { type: 'todo/tree', data: { todos: [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'pending' },
    { content: 'd', status: 'pending' },
    { content: 'e', status: 'pending' },
    { content: 'f', status: 'pending' },
    { content: 'g', status: 'pending' },
    { content: 'h', status: 'pending' },
    { content: 'i', status: 'pending' },
    { content: 'j', status: 'pending' },
    { content: 'k', status: 'pending' },
  ] } }, 3)
  const after = progressOf(reducer)
  assert.deepEqual([after.done, after.total], [2, 11])
  assert.ok(after.done / after.total < before.done / before.total, '百分比如实下降，不单调化')
  assert.deepEqual(after.planChange, { from: 6, to: 11, at: after.planChange.at })
  assert.ok(Number.isFinite(after.planChange.at))
  // 分母变化必须触发一条 state（UI 才有机会写"▲ 计划已更新 6→11"）
  assert.ok(message !== undefined && message.progress.planChange.from === 6)
})

test('progressPayload：无 todo / 空计划 / 垃圾输入一律 applicable:false', () => {
  assert.deepEqual(progressPayload({ mode: 'tree', todos: [] }), { applicable: false, reason: 'no-todos' })
  assert.deepEqual(progressPayload({ mode: 'flat', todos: undefined }), { applicable: false, reason: 'no-todos' })
  assert.deepEqual(progressPayload({ mode: 'tree', todos: [null, {}] }), { applicable: false, reason: 'no-todos' })
  // 计数是**结构化**的（与 dsh-tool-todo-tree 自己的 countStatus 同口径）：
  // 空白文案不改变计数 —— 真实输入下该工具已保证 content 非空，这里不额外过滤，
  // 否则分母会跟工具自己报的数字不一致。
  assert.equal(progressPayload({ mode: 'tree', todos: [{ content: '  ', status: 'pending' }] }).total, 1)
  assert.equal(progressPayload({ mode: 'flat', todos: [{ content: '', status: 'completed' }] }).done, 1)
})

test('计数口径：叶节点 vs 条目（同一份树两种算法结果不同，说明确实按叶子）', () => {
  const tree = countTreeLeaves(CODING_TREE_PLAN)
  const flatCount = CODING_TREE_PLAN.length
  assert.equal(flatCount, 3, '顶层只有 3 条')
  assert.equal(tree.total, 6, '叶子有 6 条')
  assert.notEqual(tree.total, flatCount)
})

test('未知事件不影响进度（树形/扁平两套日志混入也不互相清空）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('mixed')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  feed(reducer, s, { type: 'todo/tree', data: { todos: [{ content: 'a', status: 'pending' }] } }, 2)
  assert.equal(progressOf(reducer).total, 1)
  feed(reducer, s, { type: 'not/a/tool', data: {} }, 3)
  feed(reducer, s, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', index: 0, text: 'x' } } }, 4)
  assert.equal(progressOf(reducer).total, 1, '无关事件不该动进度')
  assert.equal(progressOf(reducer).mode, 'tree')
})

// ── 严格分离：代理指标不得进 progress ─────────────────────────────────────

test('🐛 严格分离：轮/步/工具数/耗时走 metrics，**不进 progress**（无分母不许当进度）', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(['progress'])
  const s = session('metrics')
  feed(reducer, s, { type: 'turn/start', data: { turn: 1 } }, 1)
  for (let i = 0; i < 5; i += 1) {
    feed(reducer, s, { type: 'tool/call', data: { name: 'pwsh', callId: `c${i}`, arguments: '{"command":"ls"}' } }, 2 + i)
  }
  const [message] = feed(reducer, s, { type: 'session/title', data: { title: 'T' } }, 50)

  // 进展为零（没有 todo）→ progress 不适用；活动量在 metrics 里
  assert.equal(message.progress.applicable, false)
  assert.equal(message.metrics.turns, 1)
  assert.equal(message.metrics.toolCalls, 5)
  assert.equal(typeof message.metrics.elapsedMs, 'number')
  // 关键：metrics 的字段**绝不能**出现在 progress 里
  for (const forbidden of ['turns', 'steps', 'toolCalls', 'elapsedMs']) {
    assert.equal(forbidden in message.progress, false, `progress 里不该有 ${forbidden}`)
  }
  // 反向：progress 的字段也不该混进 metrics
  for (const forbidden of ['applicable', 'done', 'total']) {
    assert.equal(forbidden in message.metrics, false)
  }
})

test('状态不受"没有进度"影响（没 todo 时状态机照常工作）', () => {
  const reducer = new WorkIconReducer()
  const s = session('noprogress')
  feed(reducer, s, { type: 'turn/start', data: {} }, 1)
  assert.equal(reducer.snapshot().state, WorkState.THINKING)
  feed(reducer, s, { type: 'tool/call', data: { name: 'pwsh', callId: 'c1', arguments: '{"command":"npm test"}' } }, 2)
  assert.equal(reducer.snapshot().state, WorkState.WORKING)
  assert.equal(reducer.progressSnapshot(), undefined)
})
