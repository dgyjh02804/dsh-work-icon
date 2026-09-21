/**
 * 🔬 最小复现（跑真实 src/reducer.js，不是 mock）：一轮开始会不会把**会话级计划**清掉？
 *
 * 现象（用户原话）：「然后我一给你发消息环就没了，现在它就消失了」
 *   - 发消息前：悬停层 `计划 4/8 · 50%` ✓ 环可见 ✓
 *   - 发消息后：`计划 —（本宿主不适用）` ✗ 环消失 ✗
 *
 * 打印的是**实际值**（reducer.currentStateMessage().progress），一个字都不推断。
 *
 * 跑法：node test/repro-turnstart-plan.mjs
 */
import { WorkIconReducer } from '../src/reducer.js'

const MAIN = 'aaaaaaaa-0000-0000-0000-000000000001'
const SUB = 'bbbbbbbb-0000-0000-0000-000000000002'

const mainSession = { header: { id: MAIN, cwd: 'C:\\repo' } }
const subSession = {
  header: { id: SUB, cwd: 'C:\\repo', origin: 'subagent', parentSession: MAIN, delegationDepth: 1 },
}

// 与用户截图 1 同形：8 个叶子、4 个已完成（= 4/8 · 50%）
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

function make() {
  let seq = 0
  const reducer = new WorkIconReducer({ includeSubagents: true })
  reducer.setCapabilities(['todos', 'cost', 'text', 'progress', 'subagents', 'sessions', 'context'])
  return {
    reducer,
    emit: (session, event) => reducer.handle(session, { seq: ++seq, ...event }),
    snap: () => {
      const m = reducer.currentStateMessage()
      return {
        session: m.session,
        state: m.state,
        // 上屏载荷（窗口画环就吃这个字段）
        progress: m.progress,
        raw: reducer.progressSnapshot(),
      }
    },
  }
}

const show = (label, snap) => {
  const p = snap?.progress
  console.log(
    `  ${label.padEnd(34)} session=${String(snap?.session).slice(0, 8)} state=${snap?.state} ` +
    `| progress=${JSON.stringify(p)} | 原始 record.progress=${JSON.stringify(snap?.raw)}`,
  )
}

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== A. 树形计划（todo/tree，coding-tree 预设）· 焦点=主代理 ===')
{
  const { emit, snap } = make()
  show('1) turn/start（第 1 轮）', snap())
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  const before = snap()
  show('2) todo/tree 之后（= 发消息前）', before)
  check('发消息前环应画：applicable===true', before.progress?.applicable === true, JSON.stringify(before.progress))
  check('发消息前是 4/8 · 50%', before.progress?.done === 4 && before.progress?.total === 8, `${before.progress?.done}/${before.progress?.total}`)

  console.log('  --- 用户"发了一条消息" ⇒ 主会话开新一轮 ---')
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  const after = snap()
  show('3) turn/start（第 2 轮）之后', after)
  check('发消息后环仍在：applicable===true', after.progress?.applicable === true, `实际 applicable=${after.progress?.applicable} reason=${after.progress?.reason}`)
  check('发消息后仍是 4/8', after.progress?.done === 4 && after.progress?.total === 8, JSON.stringify(after.progress))
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== B. 扁平计划（todo/write，standard 预设）· 焦点=主代理 ===')
{
  const { emit, snap } = make()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/write', data: { todos: flatTodos } })
  const before = snap()
  show('1) todo/write 之后（= 发消息前）', before)
  check('发消息前环应画：applicable===true', before.progress?.applicable === true, JSON.stringify(before.progress))

  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  const after = snap()
  show('2) turn/start（新一轮）之后', after)
  check('发消息后环仍在：applicable===true', after.progress?.applicable === true, `实际 applicable=${after.progress?.applicable} reason=${after.progress?.reason}`)
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== C. 焦点=子代理时，主代理开新一轮（两条路一起照看）===')
{
  const { emit, snap } = make()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  const focusSub = snap()
  show('1) 子代理开轮后（焦点=子代理）', focusSub)
  check('焦点在子代理时计划仍取根会话', focusSub.progress?.applicable === true, JSON.stringify(focusSub.progress))

  console.log('  --- 用户又发一条消息 ⇒ **主代理**开新一轮（焦点仍在子代理）---')
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  const after = snap()
  show('2) 主代理新一轮之后', after)
  check('主代理新一轮不该清掉根计划', after.progress?.applicable === true, `实际 applicable=${after.progress?.applicable} reason=${after.progress?.reason}`)
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== D. 焦点=子代理，且是**子代理自己**开新一轮 ===')
{
  const { emit, snap } = make()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  emit(subSession, { type: 'turn/start', data: { turn: 1 } })
  emit(subSession, { type: 'turn/start', data: { turn: 2 } })
  const after = snap()
  show('1) 子代理连开两轮之后', after)
  check('子代理开轮不该影响根计划', after.progress?.applicable === true, JSON.stringify(after.progress))
}

// ─────────────────────────────────────────────────────────────────────────
// 用户要求钉死"清空发生在哪一刻"：A = turn/start 清？ B = turn/end 清？
// 这四种 turn/end 的 reason（reasonKindOf 的全部取值）都要真跑一遍。
console.log('\n=== E. 假设 B：是不是 `turn/end` 清的？（四种 reason 全跑）===')
for (const kind of ['completed', 'aborted', 'blocked', 'error']) {
  const { emit, snap } = make()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })
  const before = snap()
  emit(mainSession, { type: 'turn/end', data: { turn: 1, reason: { kind } } })
  const after = snap()
  console.log(`  turn/end reason=${kind.padEnd(10)} state=${String(before.state)}→${String(after.state)}`)
  show(`   B) turn/end(${kind}) 之后`, after)
  check(
    `turn/end(${kind}) **不**清计划`,
    after.progress?.applicable === true && after.progress?.total === 8,
    `实际 ${JSON.stringify(after.progress)}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 一个完整的真实回合循环：用户发消息 ⇒ 模型写计划 ⇒ 回合结束 ⇒ 用户又发消息
console.log('\n=== F. 完整真实循环（用户亲口确认的规律：写计划就有环，一开新轮就没）===')
{
  const { emit, snap } = make()
  const steps = [
    ['用户发第 1 条消息 → turn/start', () => emit(mainSession, { type: 'turn/start', data: { turn: 1 } })],
    ['模型写下计划 → todo/tree', () => emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } })],
    ['跑了个工具 → tool/call', () => emit(mainSession, { type: 'tool/call', data: { turn: 1, step: 1, toolName: 'pwsh', callId: 'c1', arguments: '{}' } })],
    ['本轮结束 → turn/end(completed)', () => emit(mainSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })],
    ['用户又发一条消息 → turn/start', () => emit(mainSession, { type: 'turn/start', data: { turn: 2 } })],
    ['模型还没重写计划（它只在计划变了才写）', () => {}],
  ]
  for (const [label, run] of steps) {
    run()
    const s = snap()
    console.log(`  ${label}`)
    show('   → 上屏 progress', s)
  }
  const final = snap()
  check('用户再次发消息后，环必须还在', final.progress?.applicable === true, JSON.stringify(final.progress))
}

// ─────────────────────────────────────────────────────────────────────────
// 副作用实测（不是推测）：progress 跨回合存活后，`previous` 也会跨回合，
// 于是"新一轮里换了一份分母不同的计划"会产出 planChange。打印实际值，交给 UI/人判断。
console.log('\n=== G. 副作用实测：跨回合换计划时的 planChange（`previous` 现在也跨回合了）===')
{
  const { emit, snap } = make()
  emit(mainSession, { type: 'turn/start', data: { turn: 1 } })
  emit(mainSession, { type: 'todo/tree', data: { todos: treeTodos } }) // 8 个叶子
  show('1) 第 1 轮写下 8 叶计划', snap())
  emit(mainSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  emit(mainSession, { type: 'turn/start', data: { turn: 2 } })
  // 第 2 轮里模型换成了一份完全不同的计划（3 个叶子）
  emit(mainSession, { type: 'todo/tree', data: { todos: [
    { content: 'x1', status: 'completed' }, { content: 'x2', status: 'pending' }, { content: 'x3', status: 'pending' },
  ] } })
  const s = snap()
  show('2) 第 2 轮换成 3 叶计划后', s)
  console.log(`     ⇒ planChange = ${JSON.stringify(s.progress?.planChange)}`)
  console.log('     （这是"分母跳变如实上报"的既有语义，与 progress.js:150-154 的注释一致；')
  console.log('       改前因为 progress 被清空，这里必然没有 planChange。窗口会据此写「计划已更新 8→3」。）')
}

console.log(
  `\n=== 结论：${failures} 项断言失败 ===\n` +
  '  A（turn/start 清计划）: 看 A/B/C 段；B（turn/end 清计划）: 看 E 段。\n' +
  '  反证逻辑：把 src/reducer.js 还原成"修前"再跑本脚本，即可对比哪一段由红转绿。\n',
)
process.exitCode = failures > 0 ? 1 : 0
