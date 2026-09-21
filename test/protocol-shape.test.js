/**
 * 跨侧契约（协议形状）：宿主发的形状 vs 窗口读的形状。
 *
 * 为什么需要这一层：配置键那边我们绊住了，但**协议形状**是另一个错位点 ——
 * 窗口曾经以为 v2 数据走独立 kind（`kind:'progress'`），宿主却把新字段放在 `state` 载荷里。
 * 那种错位两边各自测试都绿，合起来面板是空的。
 *
 * 纪律：
 *   - 宿主侧的字段/能力**从行为里提取**（真跑一遍 reducer 看哪些字段出现），不是手抄常量；
 *   - 窗口侧的形状**从它的源码里机器提取**（`DECLARED_CAPABILITIES` / `handleMessage` 的 case /
 *     它对 `payload.X`、`msg.X` 的读取）；
 *   - 失败信息必须**直接给出解法**。
 *
 * 锚点路径可用环境变量指到副本（`DSH_WORK_ICON_WINDOW_MAIN` / `DSH_WORK_ICON_WINDOW_HTML`），
 * 便于做"临时改个名字 → 必须变红"的敏感性复核，不必改别人的文件。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKAGE_ROOT } from '../src/config.js'
import { Capability, MessageKind, PROTOCOL_VERSION } from '../src/protocol.js'
import { WorkIconReducer } from '../src/reducer.js'

const WINDOW_MAIN = process.env.DSH_WORK_ICON_WINDOW_MAIN || join(PACKAGE_ROOT, 'runtime', 'electron', 'main.js')
const WINDOW_HTML = process.env.DSH_WORK_ICON_WINDOW_HTML || join(PACKAGE_ROOT, 'runtime', 'electron', 'index.html')

/** SPEC v2 冻结的 kind：只增不改（新增必须两边同时落地）。 */
const FROZEN_KINDS = Object.freeze([
  'ready', 'state', 'pulse', 'config', 'setting', 'shutdown', 'closed', 'text',
])

/** 文档化的例外：字段名与能力名**故意不同**的对应关系（在下面逐个说明理由）。 */
const DOCUMENTED_PAIRS = Object.freeze({
  // metrics（轮/步/工具数=代理指标）与 progress（真进度）同属"面板数据"，由同一个能力门控。
  metrics: 'progress',
})

const main = (id, cwd = 'C:\\demo') => ({ header: { id, cwd } })
const sub = (id, parent) => ({ header: { id, cwd: 'C:\\demo', origin: 'subagent', parentSession: parent, delegationDepth: 1 } })
const feed = (reducer, session, event, seq = 1) => reducer.handle(session, { seq, ...event })

/**
 * 用**真实事件流**把某组能力下的 state 载荷喂满，返回该载荷的**全部键**。
 *
 * 这是"行为提取"：不解析源码、不手抄常量。字段名改了/门控改错了，结果立刻变。
 * 传空能力集 → 得到"冻结的基础字段"；传单个能力 → 得到该能力额外带出来的字段。
 */
function stateFieldsUnder(capabilities) {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(capabilities)
  const root = main('shape-root')
  const child = sub('shape-child', 'shape-root')
  const other = main('shape-other', 'C:\\work\\other')

  // 子代理（subagents/sessions 要有料）
  feed(reducer, child, { type: 'subagent/descriptor', data: { mode: 'one-shot', provider: 'local', label: '跑测试' } })
  feed(reducer, child, { type: 'turn/start', data: { turn: 1 } })
  // 主会话：计划 + 上下文占用的分母（request/context）+ 分子（usage 样本）
  feed(reducer, root, { type: 'turn/start', data: { turn: 1 } })
  feed(reducer, root, {
    type: 'request/context',
    data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 128000 },
  })
  feed(reducer, root, {
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'x' }] },
      usage: { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 500 },
    },
  })
  feed(reducer, root, {
    type: 'todo/tree',
    data: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] },
  })
  // 花费（由插件从账本写入）
  reducer.setCost({ status: 'ok', cost: { CNY: 1.5 }, priced: 3, unpriced: 0 })
  // 第二个对话 → sessions
  feed(reducer, other, { type: 'request/header', data: {} })
  // 触发一次携带全部字段的 state
  const messages = feed(reducer, root, { type: 'session/title', data: { title: '形状测试' } })
  const state = messages.find((message) => message.kind === 'state')
  assert.ok(state, '事件流没有产出 state 消息 —— 提取器失效，请更新')
  return Object.keys(state).sort()
}

/** 冻结的基础字段（不声明任何能力时也发的那些）。 */
function baseStateFields() {
  return stateFieldsUnder([])
}

/** v2 字段 = 某个能力开启后才多出来的字段（并集）。 */
function v2StateFields() {
  const base = new Set(baseStateFields())
  const found = new Set()
  for (const capability of Object.values(Capability)) {
    for (const field of stateFieldsUnder([capability])) {
      if (!base.has(field)) found.add(field)
    }
  }
  return [...found].sort()
}

/** 宿主 v2 字段 → 门控它的能力名（行为提取：逐能力单独开，看谁把字段带出来）。 */
function hostFieldGates() {
  const fields = v2StateFields()
  const gates = new Map()
  for (const capability of Object.values(Capability)) {
    for (const field of stateFieldsUnder([capability])) {
      if (!fields.includes(field)) continue
      if (!gates.has(field)) gates.set(field, capability)
    }
  }
  return { fields, gates }
}

/** 窗口侧声明的能力（机器提取，不手抄）。 */
function windowDeclaredCapabilities(source) {
  const match = /const DECLARED_CAPABILITIES = \[([^\]]*)\]/u.exec(source)
  if (match === null) return undefined
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/gu, ''))
    .filter((item) => item.length > 0)
}

/** 窗口侧 handleMessage 认的 kind（机器提取）。 */
function windowHandledKinds(source) {
  const start = source.indexOf('function handleMessage (')
  if (start < 0) return undefined
  const body = source.slice(start, source.indexOf('\n}', start))
  return [...body.matchAll(/case '([^']+)':/gu)].map((match) => match[1])
}

/**
 * 窗口侧**从 state 消息上读的字段**（机器提取，按来源分成两组）：
 *   - `host`：main.js 的 `setState(name, payload, why)` 里读的 `payload.X` ——
 *     这些字段直接来自**宿主**的 state 消息，宿主必须真的发；
 *   - `renderer`：index.html 里 `msg.kind === 'state'` 那一段读的 `msg.X` ——
 *     它们的生产者是**窗口自己的 main.js**（`sendToRenderer` 转发给渲染层的那份），
 *     所以要先看 main.js 有没有转发，再看宿主有没有这个字段。
 *
 * 为什么必须收窄到"state 分支"：渲染层还有一套**自己内部的 IPC**
 * （`metrics` / `panel` / `fps` / `hot` / `test-*` 等 kind），读的是 `msg.inside`、
 * `msg.open`、`msg.spec` 这类内部字段 —— 跟宿主 stdio 协议无关，算进来就是假红。
 *
 * 同时刻意**不**做"只保留已知字段"的过滤：那会让"窗口读了一个没人发的字段"
 * （= 面板静默空着）这个最该抓的错位变成空断言。
 */
function windowStateReads(mainSource, htmlSource) {
  const collect = (text) => [...text.matchAll(/\b(?:payload|msg)\.([A-Za-z_$][\w$]*)/gu)].map((m) => m[1])
  const start = mainSource.indexOf('function setState (')
  assert.ok(start >= 0, '找不到窗口侧 setState —— 它改名了？请更新提取锚点')
  const setStateBody = mainSource.slice(start, mainSource.indexOf('\n}', start))

  const renderer = []
  for (const match of htmlSource.matchAll(/BRIDGE\.onMessage\(/gu)) {
    const body = htmlSource.slice(match.index, htmlSource.indexOf('\n})', match.index) + 3)
    const stateStart = body.indexOf("msg.kind === 'state'")
    if (stateStart < 0) continue
    let branch = body.slice(stateStart)
    const nextBranch = branch.indexOf('else if')
    if (nextBranch > 0) branch = branch.slice(0, nextBranch)
    renderer.push(...collect(branch))
  }
  assert.ok(renderer.length > 0, '找不到渲染层的 state 分支 —— 请更新提取锚点')
  return {
    host: [...new Set(collect(setStateBody))].sort(),
    renderer: [...new Set(renderer)].sort(),
  }
}

/** main.js 自己转发给渲染层的那份 state 消息有哪些键（`sendToRenderer({...})`）。 */
function rendererForwardedFields(mainSource) {
  const start = mainSource.indexOf('function setState (')
  assert.ok(start >= 0, '找不到窗口侧 setState —— 请更新提取锚点')
  const body = mainSource.slice(start, mainSource.indexOf('\n}', start))
  const call = body.indexOf('sendToRenderer(')
  assert.ok(call >= 0, 'setState 里找不到 sendToRenderer —— 请更新提取锚点')
  const literal = body.slice(call, body.indexOf('\n  }', call) + 1)
  return [...new Set([...literal.matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*:/gmu)].map((m) => m[1]))].sort()
}

function readAnchors() {
  assert.ok(existsSync(WINDOW_MAIN), `窗口侧锚点缺失：${WINDOW_MAIN}`)
  assert.ok(existsSync(WINDOW_HTML), `窗口侧锚点缺失：${WINDOW_HTML}`)
  return { main: readFileSync(WINDOW_MAIN, 'utf8'), html: readFileSync(WINDOW_HTML, 'utf8') }
}

// ── ① 宿主导出的形状（自检 + 冻结） ───────────────────────────────────────────

test('协议冻结：宿主导出的 kind 集合就是那份冻结清单（只增不改，改要两边同时落地）', () => {
  assert.deepEqual(Object.values(MessageKind).sort(), [...FROZEN_KINDS].sort())
  assert.equal(PROTOCOL_VERSION, 2)
})

test('宿主 v2 字段 ↔ 能力名逐字一致（metrics 是文档化例外：与 progress 同门控）', () => {
  const { fields, gates } = hostFieldGates()
  assert.ok(fields.length >= 6, `行为提取只拿到 ${fields.length} 个 v2 字段（${fields.join(',')}），提取逻辑可能失效`)
  assert.ok(baseStateFields().length >= 8, '基础字段提取结果太少，提取器可能失效')
  const capabilityNames = new Set(Object.values(Capability))
  for (const field of fields) {
    const gate = gates.get(field)
    assert.ok(gate, `字段 ${field} 没有任何能力门控它 —— 老窗口会收到不该收的字段`)
    assert.ok(capabilityNames.has(gate), `字段 ${field} 的门控 ${gate} 不是协议里的能力名`)
    const expected = DOCUMENTED_PAIRS[field] ?? field
    assert.equal(
      gate,
      expected,
      `字段 \`${field}\` 由能力 \`${gate}\` 门控，但按约定"字段名 = 能力名"，它应该叫 \`${expected}\`。`
      + '要么把字段名改回与能力一致，要么在 DOCUMENTED_PAIRS 里显式登记这对关系并写明理由'
      + '（改名会同时影响窗口侧：它读的是这个字段名）',
    )
  }
  // 反向：每个能力至少门控一个字段（text 是 kind 不是字段，单独豁免）
  const gated = new Set(gates.values())
  for (const capability of Object.values(Capability)) {
    if (capability === Capability.TEXT) continue
    assert.ok(
      gated.has(capability),
      `能力 ${capability} 没有门控任何 state 字段 —— 要么它该门控某个字段，要么它不该出现在 Capability 里`,
    )
  }
})

// ── ② 窗口侧的形状（机器提取） ────────────────────────────────────────────────

test('窗口侧不会把小众形状当 kind：handleMessage 认的 kind 全部在冻结清单里', () => {
  const { main } = readAnchors()
  const kinds = windowHandledKinds(main)
  assert.ok(Array.isArray(kinds) && kinds.length > 0, '提取不到窗口侧 handleMessage 的 case —— 它改名了？请更新提取逻辑')
  // 防退化成空断言
  assert.ok(kinds.includes('state'), `提取结果里应该有 state，实际 ${kinds.join(',')}`)
  for (const kind of kinds) {
    assert.ok(
      FROZEN_KINDS.includes(kind),
      `窗口侧在 handleMessage 里认了 kind='${kind}'，但它不在冻结 kind 清单里。`
      + 'v2 的数据字段**没有独立 kind**，全部随 state 载荷进来 —— 请把它改成读 state 里的字段',
    )
  }
})

test('窗口侧声明的能力名 ⊆ 宿主能力词汇表（写错一个字母就会静默收不到字段）', () => {
  const { main } = readAnchors()
  const declared = windowDeclaredCapabilities(main)
  assert.ok(Array.isArray(declared), '提取不到 DECLARED_CAPABILITIES —— 窗口侧改名了？请更新提取逻辑')
  assert.ok(declared.length > 0, 'DECLARED_CAPABILITIES 是空的：窗口将收不到任何 v2 字段')
  const known = new Set(Object.values(Capability))
  for (const capability of declared) {
    assert.ok(
      known.has(capability),
      `窗口声明了能力 '${capability}'，宿主没有这个名字（宿主有的是：${[...known].join(', ')}）。`
      + '宿主按能力门控字段，名字对不上就**静默不发** —— 请两边统一成宿主 Capability 里的名字',
    )
  }
})

test('窗口侧从 state 上读的字段，宿主都真的发（含基础字段∪v2字段的完整比对）', () => {
  const { main: mainSource, html } = readAnchors()
  const reads = windowStateReads(mainSource, html)
  assert.ok(reads.host.length > 0 && reads.renderer.length > 0, '提取不到窗口侧的 state 读取 —— 提取逻辑失效，请更新')
  const { fields, gates } = hostFieldGates()
  const base = baseStateFields()
  const everything = new Set([...base, ...fields])
  const declared = new Set(windowDeclaredCapabilities(mainSource) ?? [])

  const check = (field, origin) => {
    assert.ok(
      everything.has(field),
      `${origin} 在读 state.${field}，但宿主**从不发**这个字段。`
      + `宿主发的基础字段：${base.join(', ')}；能力门控字段：${fields.join(', ')}。`
      + '请对齐字段名，或让宿主补上这个字段（否则窗口那边永远是 undefined）',
    )
    if (!fields.includes(field)) return
    const gate = gates.get(field)
    assert.ok(
      declared.has(gate),
      `${origin} 在读 ${field}，但它没在 DECLARED_CAPABILITIES 里声明门控能力 '${gate}'。`
      + '宿主按能力门控：不声明就收不到 —— 面板会静默空着。请在 DECLARED_CAPABILITIES 里补上它',
    )
  }

  // ① 主进程直接读宿主 state 的字段（payload.*）
  for (const field of reads.host) check(field, 'main.js setState')

  // ② 渲染层读的是**窗口自己转发的那份**（main.js → sendToRenderer）；
  //    它要么在主进程转发清单里，要么至少得是宿主真的发的字段 —— 两个都不满足就是坏读。
  const forwarded = new Set(rendererForwardedFields(mainSource))
  assert.ok(forwarded.size >= 5, `提取到的转发字段太少（${[...forwarded].join(',')}），提取锚点可能失效`)
  for (const field of reads.renderer) {
    if (forwarded.has(field)) continue
    assert.ok(
      everything.has(field),
      `index.html 在读 msg.${field}（state 分支），但 **main.js 的 sendToRenderer 根本没转发它**`
      + `（转发的只有：${[...forwarded].join(', ')}）—— 渲染层拿到的永远是 undefined。`
      + `宿主那边这个值在别处（例如 metrics.toolCalls）。两种修法：main.js 转发它，`
      + '或渲染层改读转发过来的那个字段名',
    )
    check(field, 'index.html state 分支')
  }
})

test('配置键那一层也一起复核：窗口 DEFAULTS 键集合与宿主共享键逐键相等（防这次误改把旧的碰坏）', () => {
  const { main } = readAnchors()
  const match = /const WINDOW_KEYS = Object\.keys\(DEFAULTS\)\.sort\(\)/u.test(main)
  assert.equal(match, true, '窗口侧应保留 WINDOW_KEYS = Object.keys(DEFAULTS).sort()（配置键绊线的锚点）')
})
