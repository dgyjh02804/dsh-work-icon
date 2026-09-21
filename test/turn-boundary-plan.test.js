/**
 * 🐛 回归：**会话级计划必须跨回合存活** —— 用户"发一条消息 ⇒ 环就没了"。
 *
 * 用户原话：「然后我一给你发消息环就没了，现在它就消失了」
 * 两张实测截图：
 *   [发消息前] 悬停层 `计划 4/8 · 50%` ✓ 环可见 ✓ 面板 `4 / 8 跑着 …` ✓
 *   [发消息后] 悬停层 `计划 —（本宿主不适用）` ✗ 环消失 ✗
 *
 * 根因（`src/reducer.js` 的 `#turnStart`，旧代码原文）：`record.progress = undefined`
 * —— 一轮开始把**会话级**的计划快照一起清掉了。计划由 `todo/*` 的**全量快照**算出
 * （`src/progress.js:130-156`），属于**这场对话**而不是"这一轮"；而模型只在计划真的变了时
 * 才会再发一次 `todo/tree` ⇒ 清掉之后整个回合环都不在。
 * 上屏链路：`#turnStart` 清空 ⇒ `#stateMessage` 落到
 * `?? { applicable:false, reason:'no-todos' }`（`src/reducer.js:1745`）⇒ 窗口按纪律不画环。
 *
 * 复现（改前实测，`node test/repro-turnstart-plan.mjs`）：
 *   turn/start 前 `{"applicable":true,"mode":"tree","unit":"leaf","done":4,"total":8,"inProgress":"b1"}`
 *   turn/start 后 `{"applicable":false,"reason":"no-todos"}`（`record.progress` 实际为 `undefined`）
 *
 * 本文件把这条固化成**机器可验证**的断言；同时守住既有规则不被改坏：
 *   · 真的没有计划 ⇒ 依然 `applicable:false`（不画 0%）；
 *   · 计划被 `todo/*` 真清空 ⇒ 依然 `applicable:false`（清空是"计划变了"，不是"回合变了"）；
 *   · 多对话 / 焦点在子代理 ⇒ 计划仍取对话根（上一轮 `#rootRecordOf` 的活儿不许回滚）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer } from '../src/reducer.js'

const MAIN = 'aaaaaaaa-0000-0000-0000-000000000001'
const SUB = 'bbbbbbbb-0000-0000-0000-000000000002'

const mainSession = { header: { id: MAIN, cwd: 'C:\\repo' } }
const subSession = {
  header: { id: SUB, cwd: 'C:\\repo', origin: 'subagent', parentSession: MAIN, delegationDepth: 1 },
}

/** 与用户截图 1 同形：8 个叶子、4 个已完成（4/8 · 50%）。 */
const treeTodos = [
  { content: '阶段一：取证', status: 'completed', children: [
    { content: 'a1', status: 'completed' }, { content: 'a2', status: 'completed' },
    { content: 'a3', status: 'completed' }, { content: 'a4', status: 'completed' },
  ] },
  { content: '阶段二：修复', status: 'in_progress', children: [
    { content: 'b1', status: 'in_progress' }, { content: 'b2', status: 'pending' },
  ] },
  { content: '阶段三：验证', status: 'pending', children: [
    { content: 'c1', status: 'pending' }, { content: 'c2', status: 'pending' },
  ] },
]
const flatTodos = [
  { content: 'a', status: 'completed' }, { content: 'b', status: 'completed' },
  { content: 'c', status: 'in_progress' }, { content: 'd', status: 'pending' },
]

function seed() {
  let seq = 0
  const reducer = new WorkIconReducer({ includeSubagents: true })
  reducer.setCapabilities(['todos', 'cost', 'text', 'progress', 'subagents', 'sessions', 'context'])
  return {
    reducer,
    emit: (session, event) => reducer.handle(session, { seq: ++seq, ...event }),
    /** 上屏载荷 = 窗口画环真正读的那个字段（不是内部快照）。 */
    wire: () => reducer.currentStateMessage().progress,
    /** 宿主内部快照（两条必须同源）。 */
    raw: () => reducer.progressSnapshot(),
    todos: () => reducer.currentStateMessage().todos,
  }
}

const shape = (p) => JSON.stringify(p)

test('🐛 树形计划（coding-tree 的 todo/tree）：用户发一条消息后，环不许消失', () => {
  const { emit, wire, raw, todos } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })

  // —— 发消息前（截图 1 的形态）——
  const before = wire()
  assert.equal(before.applicable, true, `发消息前就该有计划：${shape(before)}`)
  assert.deepEqual([before.done, before.total], [4, 8], '4/8 · 50%')
  const todosBefore = todos().items.length

  // —— 用户发了一条消息 ⇒ 主会话（= 对话根）开新一轮 ——
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })

  // —— 发消息后：这一条是本 bug 的核心断言 ——
  const after = wire()
  assert.equal(
    after.applicable,
    true,
    `发一条消息（turn/start）把会话级计划清空了 —— 上屏载荷变成 ${shape(after)}；` +
      '窗口据此不画环、写「计划 —（本宿主不适用）」，这就是用户看到的"环没了"',
  )
  assert.deepEqual([after.done, after.total], [4, 8], '计划必须原样跨过回合边界（4/8）')
  assert.equal(after.inProgress, 'b1')
  // 宿主内部快照与上屏载荷必须同源（不许一个有一个没有）
  assert.deepEqual(raw(), after, 'progressSnapshot() 与上屏 progress 必须同一个对象内容')
  // 兄弟字段 todos 本来就没被清 ⇒ progress 也不该被清（不对称本身就是佐证）
  assert.equal(todos().items.length, todosBefore, 'todos 全文也照旧跨回合')
})

test('🐛 扁平计划（standard 的 todo/write）：同样必须跨回合存活', () => {
  const { emit, wire } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/write', data: { todos: flatTodos } })
  assert.equal(wire().applicable, true, '发消息前有计划')
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  const after = wire()
  assert.equal(after.applicable, true, `todo/write 那条入口也必须跨回合：${shape(after)}`)
  assert.deepEqual([after.done, after.total], [2, 4])
  assert.equal(after.mode, 'flat')
})

test('🐛 焦点在子代理上时，主代理开新一轮同样不许清掉根计划', () => {
  const { emit, wire } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  assert.equal(wire().applicable, true, '焦点在子代理时计划仍取根会话（上一轮的活儿，不许回滚）')

  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  const after = wire()
  assert.equal(after.applicable, true, `主代理新一轮不许清掉根计划：${shape(after)}`)
  assert.deepEqual([after.done, after.total], [4, 8])
})

test('🐛 子代理自己连开多轮，也不该影响根计划', () => {
  const { emit, wire } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  emit(subSession, { type: 'turn/start', data: { turn: 2 } })
  emit(subSession, { type: 'turn/start', data: { turn: 3 } })
  const after = wire()
  assert.equal(after.applicable, true, `子代理开轮不该动根计划：${shape(after)}`)
  assert.deepEqual([after.done, after.total], [4, 8])
})

test('规则不破①：真的没有计划 ⇒ 依然 applicable:false（不画环、不画 0%）', () => {
  const { emit, wire } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  const empty = wire()
  assert.equal(empty.applicable, false, '没有 todo ⇒ 不适用')
  assert.equal(empty.reason, 'no-todos')
  assert.equal('done' in empty, false, '不适用时绝不下发 done/total（免得被当 0 渲染成 0%）')
  assert.equal('total' in empty, false)
  // 空计划跑过好几轮也还是"不适用"，不会凭空长出一个计划
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  assert.equal(wire().applicable, false)
})

test('规则不破②：计划被 todo/* 真清空后，仍然没有环（清空是"计划变了"，不是"回合变了"）', () => {
  const { emit, wire } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  assert.equal(wire().applicable, true)
  // 模型把计划清空：这是**计划自己**的事，必须照常生效
  emit(mainSession, { type: 'todo/tree', data: { todos: [] } })
  const cleared = wire()
  assert.equal(cleared.applicable, false, `计划被清空 ⇒ 不适用（不是 0%）：${shape(cleared)}`)
  assert.equal(cleared.reason, 'no-todos')
  assert.equal('done' in cleared, false)
  // 跨回合也必须保持"清空"（不许把上一份计划又"复活"出来）
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  const after = wire()
  assert.equal(after.applicable, false, `清空后跨回合仍是清空：${shape(after)}`)
  assert.equal('total' in after, false)
})

test('规则不破③：多对话时计划仍按根会话取（不许被子代理的空计划顶掉）', () => {
  const { reducer, emit, wire } = seed()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  // 会话面板里，子代理自己那一行仍报它自己的计划（它没有 ⇒ 该行没有 progress）
  const subRow = reducer.sessionsSnapshot().items.find((row) => row.id === SUB)
  assert.ok(subRow, '子代理会话应在会话表里')
  assert.equal(subRow.progress, undefined, '子代理自己没有 todo ⇒ 那一行不带 progress')
  assert.equal(wire().applicable, true, '但主行（上屏那条）必须是根会话的计划')
})

/**
 * 假设 B 的反证：**不是 `turn/end` 清的**。
 *
 * 用户要求把"清空发生在哪一刻"钉死，所以 `turn/end` 的**四种 reason 全跑**
 * （`reasonKindOf` 的全部取值：completed / aborted / blocked / error）。
 * 实测（修前源码，`node test/repro-turnstart-plan.mjs` E 段）：四种 reason 之后
 * `progress` 全是 `{"applicable":true,"mode":"tree","unit":"leaf","done":4,"total":8,"inProgress":"b1"}`
 * —— **turn/end 从来不清计划**。所以清空只可能来自 `#turnStart`。
 * 这条留在套件里，防止以后有人把清空挪到 `turn/end` 又把它请回来。
 */
test('反证 A/B 之争：`turn/end` 的四种 reason 都不清计划（清空只在 #turnStart）', () => {
  for (const kind of ['completed', 'aborted', 'blocked', 'error']) {
    const { emit, wire } = seed()
    emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
    emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
    assert.equal(wire().applicable, true, `[${kind}] 建计划后应有环`)
    emit(mainSession, { type: 'turn/end', data: { turn: 1, reason: { kind } } })
    const after = wire()
    assert.equal(
      after.applicable,
      true,
      `turn/end(reason=${kind}) 清掉了会话级计划：${shape(after)}（实测它从不清 —— 清空只在 #turnStart）`,
    )
    assert.deepEqual([after.done, after.total], [4, 8], `[${kind}] 计划必须原样`)
  }
})

test('完整真实循环：写计划 ⇒ 回合结束 ⇒ 用户又发消息 ⇒ 环仍在（用户亲口确认的规律）', () => {
  const { emit, wire } = seed()
  const seen = []
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  seen.push(['写计划后', wire()])
  emit(mainSession, { type: 'tool/call', data: { turn: 1, step: 1, toolName: 'pwsh', callId: 'c1', arguments: '{}' } })
  seen.push(['跑工具时', wire()])
  emit(mainSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  seen.push(['回合结束时', wire()])
  // 用户又发一条消息 —— 这一刻就是截图 2
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  seen.push(['用户又发消息后（截图 2 那一刻）', wire()])

  for (const [label, p] of seen) {
    assert.equal(p.applicable, true, `${label} 环不该消失：${shape(p)}`)
    assert.deepEqual([p.done, p.total], [4, 8], `${label} 计划应原样 4/8`)
  }
  // "一写计划就有环、一开新轮就没"这条规律必须不再成立
  assert.equal(seen[3][1].applicable, true, '用户不该需要"每轮都写一次计划"才能看到环')
})
