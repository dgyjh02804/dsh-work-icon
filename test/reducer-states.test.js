import test from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer, activityForTool, isUserQuestionTool, toolArgsOf } from '../src/reducer.js'
import { Activity, WorkState } from '../src/protocol.js'

function session(id, extra = {}) {
  return { header: { id, cwd: 'C:\\Users\\david\\Desktop\\构建\\demo', ...extra } }
}

/**
 * 按权威类型构造事件（`@deepseek-ai/dsh-session` 的 SessionEventMap）：
 *   'tool/call': { turn, step, callId, name, arguments: string }   ← arguments 是未解析的 JSON 串
 *   'tool/result': { turn, step, message: ToolResultMessage, error?: { name, code } }
 */
function toolCall(name, callId, args = {}, extra = {}) {
  return { type: 'tool/call', turn: 1, step: 1, data: { callId, name, arguments: JSON.stringify(args) }, ...extra }
}

function toolResult(callId, extra = {}) {
  return {
    type: 'tool/result',
    turn: 1,
    step: 1,
    data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId, content: [] }] }, ...extra },
  }
}

/** 只取 state 消息的状态序列（pulse/其它 kind 不算）。 */
function statesOf(messages) {
  return messages.filter((message) => message.kind === 'state').map((message) => message.state)
}

test('七个状态全部可达，且首次出现的顺序是 IDLE→THINKING→WORKING→WAITING→SUCCESS→ERROR→DISCONNECTED', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  const seen = []

  const feed = (event) => {
    for (const state of statesOf(reducer.handle(s, event))) seen.push(state)
  }

  // IDLE：会话刚挂上来的第一条事件
  feed({ type: 'request/header', seq: 1, data: {} })
  // THINKING
  feed({ type: 'turn/start', seq: 2, data: { turn: 1 } })
  // WORKING（read 类工具 → searching）
  feed({ ...toolCall('Read', 'c1', { path: 'a.js' }), seq: 3 })
  // WAITING（审批）
  feed({ type: 'approval/asked', seq: 4, data: { id: 'a1', toolName: 'Bash' } })
  feed({ type: 'approval/decided', seq: 5, data: { id: 'a1', outcome: 'approved' } })
  feed({ ...toolResult('c1'), seq: 6 })
  // SUCCESS（本轮正常收尾）
  feed({ type: 'turn/end', seq: 7, data: { turn: 1, reason: { kind: 'completed' } } })
  // ERROR（下一轮**真的出错**收尾）
  //
  // ⚠️ 语义变更（2026-09-12，修「图标卡红」事故时一并改的，不是偷偷改）：
  //    这里原先用的是 `max-tokens`。现在 `max-tokens` / `interrupted` **不再进红色 ERROR** ——
  //    它们表示"输出被截断/被打断"，不是"出故障"；真正该红的只有 `error`。
  //    实测触发场景就是"子代理完工报告太长撞上输出上限"，把它判成故障会把图标长期染红。
  //    `max-tokens` 的新行为由 reducer-sticky.test.js 专门覆盖（必须是中性 IDLE）。
  feed({ type: 'turn/start', seq: 8, data: { turn: 2 } })
  feed({ type: 'turn/end', seq: 9, data: { turn: 2, reason: { kind: 'error' } } })
  // DISCONNECTED（会话被回收，没有活着的会话了）
  for (const state of statesOf(reducer.disposeSession(s))) seen.push(state)

  const all = Object.values(WorkState)
  for (const state of all) {
    assert.ok(seen.includes(state), `状态 ${state} 从未被产出，实际序列：${seen.join(' → ')}`)
  }
  const firstIndex = (state) => seen.indexOf(state)
  const expected = [
    WorkState.IDLE,
    WorkState.THINKING,
    WorkState.WORKING,
    WorkState.WAITING,
    WorkState.SUCCESS,
    WorkState.ERROR,
    WorkState.DISCONNECTED,
  ]
  for (let i = 1; i < expected.length; i += 1) {
    assert.ok(
      firstIndex(expected[i - 1]) < firstIndex(expected[i]),
      `顺序错误：${expected[i - 1]}(${firstIndex(expected[i - 1])}) 应早于 ${expected[i]}(${firstIndex(expected[i])})；实际序列 ${seen.join(' → ')}`,
    )
  }
  assert.deepEqual(reducer.snapshot().state, WorkState.DISCONNECTED)
})

test('activity 推导：read/glob/grep→searching，write/edit→editing，bash 跑测试/构建→testing，其余 bash→commanding', () => {
  assert.equal(activityForTool('Read'), Activity.SEARCHING)
  assert.equal(activityForTool('Glob'), Activity.SEARCHING)
  assert.equal(activityForTool('grep_search'), Activity.SEARCHING)
  assert.equal(activityForTool('web_fetch'), Activity.SEARCHING)

  assert.equal(activityForTool('Write'), Activity.EDITING)
  assert.equal(activityForTool('MultiEdit'), Activity.EDITING)
  assert.equal(activityForTool('apply_patch'), Activity.EDITING)

  for (const command of ['pnpm test', 'npm run build', 'node --test test/', 'cargo test', 'pytest -q', './gradlew build', 'tsc --noEmit']) {
    assert.equal(activityForTool('Bash', { command }), Activity.TESTING, `应判为 testing：${command}`)
  }
  for (const command of ['ls -la', 'git status', 'echo hi', 'python train.py']) {
    assert.equal(activityForTool('Bash', { command }), Activity.COMMANDING, `应判为 commanding：${command}`)
  }
  assert.equal(activityForTool('PowerShell', 'Get-ChildItem'), Activity.COMMANDING)
  // 名字本身带 test/build 也能认出来
  assert.equal(activityForTool('run_tests'), Activity.TESTING)
  // SPEC 的四值枚举没有"其它"，认不出来的归 commanding
  assert.equal(activityForTool('mystery_tool'), Activity.COMMANDING)
})

test('tool/call 会把 activity 带上 state 消息（命令文本来自 arguments 的 JSON 解析）', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  const [message] = reducer.handle(s, { ...toolCall('Bash', 'c1', { command: 'pnpm test' }), seq: 1 })
  assert.equal(message.state, WorkState.WORKING)
  assert.equal(message.activity, Activity.TESTING)
  assert.equal(message.toolName, 'Bash')
  assert.equal(message.session, 's1')
  assert.equal(message.project, 'demo')
})

test('toolArgsOf：arguments 是未解析的 JSON 字符串，解析为主、原文兜底', () => {
  assert.deepEqual(toolArgsOf({ data: { arguments: '{"command":"pnpm test","timeout":5}' } }), { command: 'pnpm test', timeout: 5 })
  // 解析失败（模型吐了半截 JSON）→ 退回原文，仍能被命令正则看到
  assert.equal(toolArgsOf({ data: { arguments: 'not json at all' } }), 'not json at all')
  // 标量 JSON 也退回原文（不是对象就没法按 key 取）
  assert.equal(toolArgsOf({ data: { arguments: '"just a string"' } }), '"just a string"')
  // 没有 arguments / 空串 → undefined
  assert.equal(toolArgsOf({ data: {} }), undefined)
  assert.equal(toolArgsOf({ data: { arguments: '   ' } }), undefined)
  assert.equal(toolArgsOf(event => event), undefined)
  // 不存在的旧字段不能再被当成参数来源
  assert.equal(toolArgsOf({ data: { args: { command: 'pnpm test' } } }), undefined)
  // 端到端：半截 JSON 里的命令文本也能认出 testing
  assert.equal(activityForTool('Bash', toolArgsOf({ data: { arguments: '{"command":"npm run build' } })), Activity.TESTING)
})

test('isError 走 ToolResultBlock：message.content[0].isError', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', turn: 1, step: 1, seq: 1, data: { turn: 1 } })
  const [message] = reducer.handle(s, {
    ...toolResult('c1', { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: true }] } }),
    seq: 2,
  })
  assert.equal(message.state, WorkState.ERROR)
  // data.error = { name, code } 是另一条真实来源
  const reducer2 = new WorkIconReducer()
  const s2 = session('s2')
  reducer2.handle(s2, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const [second] = reducer2.handle(s2, { ...toolResult('c1', { error: { name: 'ToolError', code: 'E_TOOL' } }), seq: 2 })
  assert.equal(second.state, WorkState.ERROR)
  assert.equal(second.errorCode, 'E_TOOL')
  // 老代码里那些不存在的字段不能再被当成错误信号
  const reducer3 = new WorkIconReducer()
  const s3 = session('s3')
  reducer3.handle(s3, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const legacy = reducer3.handle(s3, { type: 'tool/result', seq: 2, data: { callId: 'c1', isError: true } })
  assert.deepEqual(statesOf(legacy), [], 'data.isError 不是错误信号，状态不该变成 ERROR')
  assert.equal(reducer3.snapshot().state, WorkState.THINKING)
})

test('callId：tool/result 从 message.content[0].toolCallId 取，配对成功后回到 THINKING', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const [working] = reducer.handle(s, { ...toolCall('Bash', 'call-42', { command: 'ls' }), seq: 2 })
  assert.equal(working.state, WorkState.WORKING)
  assert.deepEqual(statesOf(reducer.handle(s, { ...toolResult('call-42'), seq: 3 })), [WorkState.THINKING])

  // 另一条真实来源：ToolMessageSource.callId
  const viaSource = new WorkIconReducer()
  const s2 = session('s2')
  viaSource.handle(s2, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  viaSource.handle(s2, { ...toolCall('Bash', 'call-77', { command: 'ls' }), seq: 2 })
  const messages = viaSource.handle(s2, {
    type: 'tool/result',
    turn: 1,
    step: 1,
    seq: 3,
    data: { message: { role: 'user', content: [], source: { kind: 'tool', callId: 'call-77' } } },
  })
  assert.deepEqual(statesOf(messages), [WorkState.THINKING])
})

test('session/title 提供会话标题（Session 本体没有 title/name 字段）', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'request/header', seq: 1, data: {} })
  const [titled] = reducer.handle(s, {
    type: 'session/title',
    seq: 2,
    data: { title: '给 work icon 写宿主侧', sourceSeqs: [1], source: 'provider' },
  })
  assert.equal(titled.title, '给 work icon 写宿主侧')
  assert.equal(titled.project, 'demo', 'project 仍然只来自 header.cwd')
  // 重复的同名标题不刷屏
  assert.deepEqual(reducer.handle(s, { type: 'session/title', seq: 3, data: { title: '给 work icon 写宿主侧' } }), [])
  // 换标题要重发
  assert.equal(statesOf(reducer.handle(s, { type: 'session/title', seq: 4, data: { title: '新标题' } })).length, 1)
  assert.equal(reducer.snapshot().title, '新标题')
})

test('projectNameOf 只认 header.cwd：session 上的 cwd/title/name/context 全都不存在', () => {
  const reducer = new WorkIconReducer()
  const bogus = {
    header: { id: 's1' },
    cwd: 'C:\\fake\\from-session-cwd',
    title: '不该被当目录',
    name: '也不该',
    context: { cwd: 'C:\\fake\\from-context' },
  }
  const [message] = reducer.handle(bogus, { type: 'request/header', seq: 1, data: {} })
  assert.equal(message.project, undefined)
  // 真正的来源是 header.cwd 的末段
  const withCwd = session('s2')
  const [second] = reducer.handle(withCwd, { type: 'request/header', seq: 1, data: {} })
  assert.equal(second.project, 'demo')
})

test('isUserQuestionTool：真正等人的工具才算，普通工具不能误判', () => {
  assert.equal(isUserQuestionTool('ask_user_question'), true)
  assert.equal(isUserQuestionTool('request_user_input'), true)
  assert.equal(isUserQuestionTool('exit_plan_mode'), true)
  assert.equal(isUserQuestionTool('code_review'), false)
  assert.equal(isUserQuestionTool('permission_scan'), false)
  assert.equal(isUserQuestionTool('Bash'), false)
  assert.equal(isUserQuestionTool('Read'), false)
  assert.equal(isUserQuestionTool(''), false)
})

test('assistant/message 的 usage 挂在事件上（data.usage），不是 message.usage', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  const assistantMessage = (input, output, extra = {}) => ({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [] },
      usage: { inputTokens: input, outputTokens: output, ...extra },
    },
  })
  reducer.handle(s, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  reducer.handle(s, { ...assistantMessage(100, 20, { cacheReadTokens: 30, reasoningTokens: 7 }), seq: 2 })
  // ⚠️ 第二个样本必须是**不同的 step**：同一个 (turn, step) 的样本是"同一次测量的重复报告"，
  // 按官方口径要**替换**而不是累加（见下一个用例）。这里验的是"不同步各自累加"。
  reducer.handle(s, {
    ...assistantMessage(50, 5),
    seq: 3,
    data: { ...assistantMessage(50, 5).data, step: 2 },
  })
  // 同一个 seq 重放不重复计数
  reducer.handle(s, {
    ...assistantMessage(999, 999),
    seq: 3,
    data: { ...assistantMessage(999, 999).data, step: 2 },
  })
  const [message] = reducer.handle(s, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } })
  // TokenUsage 没有 totalTokens；对外保证窗口侧约定的三键里 total = input + output
  assert.deepEqual(message.tokens, {
    input: 150,
    output: 25,
    total: 175,
    cacheRead: 30,
    cacheWrite: 0,
    reasoning: 7,
  })

  // 不存在的旧路径 message.usage 不该再被采纳
  const legacy = new WorkIconReducer()
  const s2 = session('s2')
  legacy.handle(s2, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  legacy.handle(s2, {
    type: 'assistant/message',
    seq: 2,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [], usage: { inputTokens: 7, outputTokens: 3 } } },
  })
  const [second] = legacy.handle(s2, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(second.tokens, undefined)
})

test('ask_user_question 会把会话推成 WAITING 而不是 WORKING', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  const [message] = reducer.handle(s, { ...toolCall('ask_user_question', 'q1'), seq: 1 })
  assert.equal(message.state, WorkState.WAITING)
  // 用户回答之后回到 THINKING
  const after = reducer.handle(s, { type: 'user/message', seq: 2, data: {} })
  assert.deepEqual(statesOf(after), [WorkState.THINKING])
})

test('todo/write → task / 计划进度进入 state 载荷', () => {
  const reducer = new WorkIconReducer()
  // ⚠️ 协议变更（2026-09-12，写"进度"功能时一并改的，明确声明）：
  //    v1/v2 早期的 `progress` 是 `{completed,total,current}`，**无法表达"不适用"**
  //    （没有 todo 时字段缺失，下游容易当 0 渲染）。
  //    现在 `progress` 改为计划进度载荷：`{applicable,mode,unit,done,total,inProgress?,planChange?}`，
  //    并由 `progress` 能力门控（老窗口收不到该字段，字节不变）。
  //    窗口侧核对过：它只把 payload.progress 原样转发（main.js:484），不解析内部结构，
  //    且面板尚未实现 —— 所以此刻改形状不破坏任何已装窗口。
  reducer.setCapabilities(['progress'])
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1, data: {} })
  const [message] = reducer.handle(s, {
    type: 'todo/write',
    seq: 2,
    data: {
      todos: [
        { content: '写协议', status: 'completed' },
        { content: '写归约', status: 'in_progress' },
        { content: '写测试', status: 'pending' },
      ],
    },
  })
  assert.equal(message.task, '写归约')
  assert.deepEqual(message.progress, {
    applicable: true,
    mode: 'flat',
    unit: 'item',
    done: 1,
    total: 3,
    inProgress: '写归约',
  })
})

test('协议门控：没声明 progress 能力的窗口收不到 progress/metrics（v1 字节不变）', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  reducer.handle(s, { type: 'turn/start', seq: 1, data: {} })
  const [message] = reducer.handle(s, {
    type: 'todo/write',
    seq: 2,
    data: { todos: [{ content: '写协议', status: 'pending' }] },
  })
  assert.equal('progress' in message, false, '未声明能力 → 不下发')
  assert.equal('metrics' in message, false, '代理指标同样受门控')
  assert.equal('subagents' in message, false)
  assert.equal('sessions' in message, false)
})

test('未知事件类型与畸形事件安静忽略；新会话首次出现会先亮一条 IDLE', () => {
  const reducer = new WorkIconReducer()
  const s = session('s1')
  // 设计如此：会话第一次出现在总线上，先推一条 IDLE 给窗口（否则它会停在上一个会话的画面上）
  assert.deepEqual(statesOf(reducer.handle(s, { type: 'request/header', seq: 0, data: {} })), [WorkState.IDLE])
  // 之后所有不认识/畸形的事件都必须安静忽略（不再产生任何消息）
  assert.deepEqual(reducer.handle(s, { type: 'not/a/real/event', seq: 1 }), [])
  assert.deepEqual(reducer.handle(s, { type: 'request/header', seq: 2, data: {} }), [])
  assert.deepEqual(reducer.handle(s, undefined), [])
  assert.deepEqual(reducer.handle(s, { seq: 3 }), [])
  assert.deepEqual(reducer.handle(s, { type: 42 }), [])
  assert.equal(reducer.snapshot().state, WorkState.IDLE)

  // data 全缺的 tool/call 也不能把归约器炸掉，按"未知工具"降级为 commanding
  const bare = reducer.handle(s, { type: 'tool/call' })
  assert.deepEqual(statesOf(bare), [WorkState.WORKING])
  assert.equal(bare[0].activity, Activity.COMMANDING)
})

test('子 Agent 取舍：归约器默认算入，配置层默认关（与 cordis.patch.yml 一致）', () => {
  const parent = session('p1')
  const child = { header: { id: 'c1', origin: 'subagent', cwd: '/repo' } }

  const included = new WorkIconReducer()
  included.handle(parent, { type: 'turn/start', seq: 1, data: {} })
  const messages = included.handle(child, { type: 'approval/asked', seq: 1, data: { id: 'a1' } })
  assert.deepEqual(statesOf(messages), [WorkState.WAITING])

  const excluded = new WorkIconReducer({ includeSubagents: false })
  excluded.handle(parent, { type: 'turn/start', seq: 1, data: {} })
  assert.deepEqual(excluded.handle(child, { type: 'approval/asked', seq: 1, data: { id: 'a1' } }), [])
  assert.equal(excluded.snapshot().state, WorkState.THINKING)
})

test('子代理开关（运行时切换，不重建归约器）：关→子代理不参与；开→立即参与', () => {
  const parent = session('p1')
  const child = { header: { id: 'c1', origin: 'subagent', cwd: 'C:\\repo\\sub' } }
  const reducer = new WorkIconReducer({ includeSubagents: false })

  // 主会话在 THINKING
  reducer.handle(parent, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.equal(reducer.snapshot().state, WorkState.THINKING)

  // 子代理进入 WORKING：开关关着 → 对外状态不变，也不产生消息
  const ignored = reducer.handle(child, { ...toolCall('Write', 'child-1', { file: 'a.js' }), seq: 1 })
  assert.deepEqual(ignored, [], '关着的时候子代理的活动不该冒出来')
  assert.equal(reducer.snapshot().state, WorkState.THINKING)
  assert.equal(reducer.snapshot().sessionCount, 1, '子代理会话根本不该进表')

  // 运行中把开关打开（等同菜单里勾上，宿主不重启）
  const afterOn = reducer.setIncludeSubagents(true)
  assert.equal(reducer.includeSubagents, true)
  // 打开后子代理的下一条事件就参与竞争
  const surfaced = reducer.handle(child, { ...toolCall('Bash', 'child-2', { command: 'pnpm test' }), seq: 2 })
  assert.deepEqual(statesOf(surfaced), [WorkState.WORKING])
  assert.equal(reducer.snapshot().state, WorkState.WORKING)
  assert.equal(reducer.snapshot().sessionId, 'c1')
  assert.equal(reducer.snapshot().activity, 'testing')

  // 再关掉：当场把子代理会话踢出，显示回到主会话
  const afterOff = reducer.setIncludeSubagents(false)
  assert.deepEqual(statesOf(afterOff), [WorkState.THINKING])
  assert.equal(reducer.snapshot().sessionId, 'p1')
  assert.equal(reducer.snapshot().sessionCount, 1)
  // 重复设置同一个值不产生消息
  assert.deepEqual(reducer.setIncludeSubagents(false), [])
})

test('子代理开关不影响优先级：打开后 WAITING 的子代理照样压过 WORKING 的主会话', () => {
  const parent = session('p1')
  const child = { header: { id: 'c1', origin: 'subagent' } }
  const reducer = new WorkIconReducer({ includeSubagents: false })

  reducer.handle(parent, { ...toolCall('Bash', 'p1-call', { command: 'ls' }), seq: 1 })
  assert.equal(reducer.snapshot().state, WorkState.WORKING)

  reducer.setIncludeSubagents(true)
  const waiting = reducer.handle(child, { type: 'approval/asked', seq: 1, data: { id: 'a1', toolName: 'bash' } })
  assert.deepEqual(statesOf(waiting), [WorkState.WAITING])
  assert.equal(reducer.snapshot().sessionId, 'c1', 'WAITING 的子代理必须抢到显示权')
})
