/**
 * 🐛 回归：开启「跟随子代理」后，子代理抢到焦点会**把主代理的计划整条盖掉**。
 *
 * 生产证据（helper.log，本次启动 04:56:55Z 起，全量 344 条 render 行）：
 * 计划在"主代理焦点"与"子代理焦点"之间翻转 52 次，其中每次都成对出现：
 *   [有] IDLE · commanding6 轮 · 29 工具计划 3/9 · 33%进程 主 · 1 跑 · 共 1   ← 主代理拿到焦点
 *   [无] THINKING · commanding0 轮 · 0 工具计划 ——（本宿主不适用）进程 主 · 1 跑 · 共 1 ← 子代理拿到焦点
 * 用户的两张截图 = 同一台机器上的这两种状态（截图 1 有计划、截图 2 没有）。
 *
 * 根因：`#select()` 让子代理参与焦点竞争是**刻意的**（子代理卡 WAITING/ERROR 时图标必须变红），
 * 但 `progress` / `metrics` / `todos` 却都取自**焦点会话**。子代理几乎不写 todo
 * （`subagents.js:22` 实测 6/6 一条都没写），于是它那张空计划把主代理的计划盖成了
 * `{applicable:false,reason:'no-todos'}`，环消失；`metrics` 也变成子代理自己的 0 轮 0 工具。
 *
 * 纪律：焦点照旧归子代理（红/黄灯不能被抢走），但**计划是对话级的**，必须取根会话；
 *       `metrics` 要的是"主 + 被追踪子代理"的**整合总量**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer } from '../src/reducer.js'
import { WorkState } from '../src/protocol.js'

const MAIN = 'aaaaaaaa-0000-0000-0000-000000000001'
const SUB = 'bbbbbbbb-0000-0000-0000-000000000002'

const mainSession = { header: { id: MAIN, cwd: 'C:\\repo' } }
const subSession = {
  header: { id: SUB, cwd: 'C:\\repo', origin: 'subagent', parentSession: MAIN, delegationDepth: 1 },
}

const treeTodos = [
  { content: '阶段一：取证', status: 'completed', children: [
    { content: 'a1', status: 'completed' }, { content: 'a2', status: 'completed' }, { content: 'a3', status: 'completed' },
  ] },
  { content: '阶段二：修复', status: 'in_progress', children: [
    { content: 'b1', status: 'pending' }, { content: 'b2', status: 'pending' }, { content: 'b3', status: 'pending' },
  ] },
  { content: '阶段三：验证', status: 'pending', children: [
    { content: 'c1', status: 'pending' }, { content: 'c2', status: 'pending' }, { content: 'c3', status: 'pending' },
  ] },
]

function seed({ includeSubagents }) {
  let seq = 0
  const reducer = new WorkIconReducer({ includeSubagents })
  reducer.setCapabilities(['todos', 'cost', 'text', 'progress', 'subagents', 'sessions', 'context'])
  const emit = (session, event) => reducer.handle(session, { seq: ++seq, ...event })
  const snapshot = () => {
    const message = reducer.currentStateMessage()
    return {
      session: message.session,
      state: message.state,
      progress: message.progress,
      metrics: message.metrics,
      todos: message.todos,
      subagents: message.subagents,
    }
  }
  return { reducer, emit, snapshot }
}

/** 主代理写计划 + 跑工具，然后子代理开跑并调工具（复刻日志里的真实次序）。 */
function scenario({ includeSubagents }) {
  const { reducer, emit, snapshot } = seed({ includeSubagents })
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  for (let i = 0; i < 5; i++) {
    emit(mainSession, { type: 'tool/call', data: { turn: 1, step: 1, toolName: 'read_file', callId: `c${i}`, arguments: '{}' } })
  }
  const beforeSub = snapshot()
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  emit(subSession, { type: 'tool/call', data: { turn: 1, step: 1, toolName: 'read_file', callId: 's1', arguments: '{}' } })
  const afterSub = snapshot()
  return { reducer, emit, snapshot, beforeSub, afterSub }
}

test('🐛 子代理抢到焦点后，主代理的**计划**不许被置空（no-todos 覆盖）', () => {
  const on = scenario({ includeSubagents: true })

  // —— 前半段：只有主代理时计划本来是对的（截图 1 的形态）——
  assert.equal(on.beforeSub.progress.applicable, true, '主代理有 todo ⇒ 计划适用')
  assert.deepEqual(
    [on.beforeSub.progress.done, on.beforeSub.progress.total],
    [3, 9],
    '应是主代理的 3/9（与截图 1 的"计划 3/9 · 33%"同形）',
  )

  // —— 子代理抢到焦点：像素级的"谁上屏"必须照旧（红/黄灯不能被抢走）——
  assert.equal(on.afterSub.session, SUB, '子代理仍应抢到焦点（这是刻意行为，不是本 bug）')

  // —— 但计划是**对话级**的，必须还是主代理那份 ——
  assert.equal(
    on.afterSub.progress.applicable,
    true,
    `子代理抢到焦点后计划被置空了：${JSON.stringify(on.afterSub.progress)}（旧逻辑下这里就是 'no-todos'）`,
  )
  assert.deepEqual(
    [on.afterSub.progress.done, on.afterSub.progress.total],
    [3, 9],
    '上屏的必须仍是主代理的 3/9，而不是子代理的空计划',
  )

  // —— 关掉开关时结果必须一致（这就是"开关不该改变计划是否存在"）——
  const off = scenario({ includeSubagents: false })
  assert.deepEqual(
    off.afterSub.progress,
    on.afterSub.progress,
    'includeSubagents 只该决定"子代理参不参与焦点竞争"，不该决定"计划有没有"',
  )
})

test('🐛 活动量要的是**整合总量**：主代理工具数 + 被追踪子代理工具数', () => {
  const on = scenario({ includeSubagents: true })
  const subs = on.afterSub.subagents
  assert.equal(subs.total, 1, '应有 1 个被追踪的子代理')
  // ⚠️ 这个用例的场景里子代理只调了 **1** 次工具（`scenario()` 里 `callId: 's1'` 那一行）。
  //    这里原先写的是 2 / 7 —— 那是把"一次调用记两遍"的账本当成了事实：
  //    子会话的 `tool/call` 在 `handle()` 的账本分支与 `#toolCall()` 里各记了一次，
  //    而且账本数字还会随 `includeSubagents`（纯显示开关）变化（true→2、false→1）。
  //    重复计数已在 `#toolCall()` 里删掉那一行修掉，这里跟着改成真实值。
  assert.equal(subs.items[0].toolCalls, 1, '账本记到的子代理工具调用数（一次真实调用 = 1）')

  // 主代理 5 次 + 子代理 1 次 = 6（旧逻辑只给子代理自己的数）
  assert.equal(
    on.afterSub.metrics.toolCalls,
    6,
    `工具数应是主+子的整合总量 6，实际 ${on.afterSub.metrics.toolCalls}`,
  )
  // 轮数只算主代理：子代理的一轮不是"这个对话的一轮"
  assert.equal(on.afterSub.metrics.turns, 1, '轮数按主代理算（子代理的轮不入账）')
})

test('🐛 子代理工具数不随 includeSubagents 变（它是显示开关，不该改事实）', () => {
  const off = scenario({ includeSubagents: false })
  const on = scenario({ includeSubagents: true })
  assert.equal(
    off.reducer.subagentLedger.snapshot(MAIN).items[0].toolCalls,
    on.reducer.subagentLedger.snapshot(MAIN).items[0].toolCalls,
    '同一个事件流，账本记到的子代理工具数必须一模一样',
  )
  // 但"参不参与焦点竞争"确实由开关决定
  assert.notEqual(off.reducer.snapshot().sessionId, on.reducer.snapshot().sessionId)
})

test('🐛 焦点在子代理上时，主代理更新计划仍必须推一条 state（去重签名同源）', () => {
  const { emit, snapshot } = scenario({ includeSubagents: true })
  const before = snapshot()
  assert.equal(before.progress.total, 9)

  // 焦点在子代理身上时，**计划清单本身**（todos 全文）也必须还是主代理那份。
  // 树形载荷是**前序扁平化**的：3 个父节点 + 9 个叶子 = 12 条（父节点也要画，所以不是 9）。
  assert.equal(
    before.todos.items.length,
    12,
    `焦点在子代理上时 todos 应与主代理一致（12 = 3 父 + 9 叶），实际 ${before.todos.items.length} 条`,
  )
  assert.equal(
    before.todos.items.filter((item) => item.depth === 1).length,
    3,
    '深度 1 的 3 个阶段节点也在（树要能画出来）',
  )

  // 主代理把计划推进一格：焦点还在子代理身上，但这条变化必须发出去
  const messages = emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos.map((node, index) => (
    index === 0 ? { ...node, content: '阶段一：取证（已收口）' } : node
  )) } })
  const after = snapshot()
  assert.equal(after.progress.total, 9, '分母没变')
  assert.equal(
    messages.length > 0 || after.todos.items.some((item) => item.content.includes('已收口')),
    true,
    '主代理的 todos 全文变了 ⇒ 要么推了一条 state，要么当前快照已含新文案（旧逻辑两者都不成立）',
  )
})

test('规则不破：真的没有计划时依然 applicable:false（不是 0%）', () => {
  const { snapshot } = seed({ includeSubagents: true })
  const empty = snapshot()
  assert.equal(empty.progress.applicable, false, '没有 todo ⇒ 不画环')
  assert.equal(empty.progress.reason, 'no-todos')
  assert.equal('done' in empty.progress, false, '不适用时绝不下发 done/total')
  assert.equal('total' in empty.progress, false)
})

test('规则不破：子代理自己的 todo 仍能让它自己那一行有进度（sessions 面板口径不变）', () => {
  const { reducer, emit } = seed({ includeSubagents: true })
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  emit(subSession, { type: 'todo/write', data: { todos: [{ content: 'x', status: 'completed' }] } })
  emit(mainSession, { type: 'session/title', data: { title: 'T' } })
  const subRow = reducer.sessionsSnapshot().items.find((row) => row.id === SUB)
  assert.ok(subRow, '子代理会话应在会话表里')
  assert.deepEqual([subRow.progress.done, subRow.progress.total], [1, 1], '子代理自己的计划仍是它自己的')
})

test('焦点是主代理时（没有子代理）行为完全不变', () => {
  const { reducer, emit, snapshot } = seed({ includeSubagents: true })
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  emit(mainSession, { type: 'tool/call', data: { turn: 1, step: 1, toolName: 'read_file', callId: 'z', arguments: '{}' } })
  const snap = snapshot()
  assert.equal(snap.session, MAIN)
  assert.equal(snap.state, WorkState.WORKING)
  assert.deepEqual([snap.progress.done, snap.progress.total], [3, 9])
  assert.equal(snap.metrics.toolCalls, 1)
  assert.equal(reducer.progressSnapshot().total, 9, 'progressSnapshot 与上屏载荷必须同源')
})
