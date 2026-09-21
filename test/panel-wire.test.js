/**
 * 上线路集成：进度/子代理/多对话这三类数据**真的发到窗口进程**了吗？
 *
 * 走真实链路：插件 mount → 桥 spawn 真子进程（假 helper 冒充窗口）→ stdout 收 JSON。
 * 假 helper 用 `DSH_WORK_ICON_FAKE_CAPABILITIES` 声明能力（协议 v2 协商）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../src/index.js'
import { PACKAGE_ROOT, defaults, saveConfig } from '../src/config.js'

const LOG_HELPER = fileURLToPath(new URL('./fixtures/fake-helper-log.mjs', import.meta.url))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs = 8000, step = 10) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(step)
  }
  return predicate()
}

function logLines(logFile) {
  try {
    return readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

const received = (logFile) => logLines(logFile).filter((entry) => entry.event === 'received').map((entry) => entry.message)
const states = (logFile) => received(logFile).filter((m) => m.kind === 'state')

function fakeCtx() {
  const listeners = new Map()
  return {
    disposers: [],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
      return () => listeners.get(type)?.delete(handler)
    },
    get() { return undefined },
    effect(callback) {
      const dispose = callback()
      this.disposers.push(dispose)
      return dispose
    },
    emit(type, ...args) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(...args)
    },
    disposeAll() {
      for (const dispose of this.disposers.splice(0)) dispose()
    },
  }
}

const main = (id) => ({ header: { id, cwd: 'C:\\demo' } })
const sub = (id, parent) => ({ header: { id, cwd: 'C:\\demo', origin: 'subagent', parentSession: parent, delegationDepth: 1 } })

async function withPlugin(capabilities, fn, options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-wire-'))
  const previousHome = process.env.DSH_WORK_ICON_HOME
  process.env.DSH_WORK_ICON_HOME = home
  // 账本这类路径是**宿主进程**自己读的，所以必须在宿主 env 上设（放进 helper 的 env 是无效的）
  const hostEnvBackup = new Map()
  for (const [key, value] of Object.entries(options.hostEnv ?? {})) {
    hostEnvBackup.set(key, process.env[key])
    process.env[key] = value
  }
  const logFile = join(home, 'helper.log')
  const ctx = fakeCtx()
  try {
    // 允许用例在 apply 之前先把 config.json 写好（"用户设过的值"这种真实形态）
    options.beforeApply?.(home)
    apply(ctx, {
      enabled: true,
      pulseIntervalMs: 1000,
      ...(options.config ?? {}),
      helper: {
        command: process.execPath,
        args: [LOG_HELPER],
        cwd: PACKAGE_ROOT,
        env: {
          DSH_WORK_ICON_FAKE_HELPER: '1',
          DSH_WORK_ICON_FAKE_LOG: logFile,
          ...(options.env ?? {}),
          ...(capabilities ? { DSH_WORK_ICON_FAKE_CAPABILITIES: capabilities } : {}),
        },
        shutdownGraceMs: 1000,
      },
    })
    assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'state')), true, '窗口应收到初始状态')
    await fn({ ctx, logFile })
  } finally {
    ctx.disposeAll()
    await sleep(120)
    for (const [key, value] of hostEnvBackup) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (previousHome === undefined) delete process.env.DSH_WORK_ICON_HOME
    else process.env.DSH_WORK_ICON_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
}

test('线上集成：声明能力后，计划进度/子代理/多对话都真的发到窗口', async () => {
  await withPlugin('progress,subagents,sessions,todos', async ({ ctx, logFile }) => {
    const root = main('wire-root')
    const emit = (session, event) => ctx.emit('session/event', session, { seq: event.__seq ?? 1, ...event })

    emit(root, { type: 'turn/start', __seq: 1, data: { turn: 1 } })
    // 子代理（先动，避免抢焦点）
    const child = sub('wire-child', 'wire-root')
    emit(child, { type: 'subagent/descriptor', __seq: 1, data: { mode: 'one-shot', provider: 'local', label: '跑测试' } })
    emit(child, { type: 'turn/start', __seq: 2, data: { turn: 1 } })
    emit(root, { type: 'turn/start', __seq: 2, data: { turn: 1 } })
    emit(root, {
      type: 'todo/tree',
      __seq: 3,
      data: {
        todos: [
          { content: '阶段一', status: 'completed', children: [{ content: '查资料', status: 'completed' }] },
          { content: '阶段二', status: 'in_progress', children: [{ content: '写代码', status: 'in_progress' }] },
          { content: '阶段三', status: 'pending' },
        ],
      },
    })
    // 第二个对话（多对话面板）
    const other = main('wire-other', 'C:\\work\\other')
    emit(other, { type: 'request/header', __seq: 1, data: {} })

    assert.equal(
      await waitFor(() => states(logFile).some((m) => m.progress?.applicable === true)),
      true,
      '计划进度应上线',
    )
    const withProgress = states(logFile).find((m) => m.progress?.applicable === true)
    // 叶节点：查资料 / 写代码 / 阶段三 = 3，完成 1
    assert.deepEqual([withProgress.progress.done, withProgress.progress.total], [1, 3])
    assert.equal(withProgress.progress.unit, 'leaf')
    assert.equal(withProgress.progress.mode, 'tree')
    assert.equal(withProgress.progress.inProgress, '写代码')

    // 先出现 total=1（descriptor 到达时还没有 turn/start，状态如实是 unknown），
    // 再出现 running=1（turn/start 之后）。这里等后者，并核对名字与深度。
    assert.equal(await waitFor(() => states(logFile).some((m) => m.subagents?.total === 1)), true, '子代理应上线')
    const firstWithTotal = states(logFile).find((m) => m.subagents?.total === 1)
    assert.equal(firstWithTotal.subagents.running, 0, '还没 turn/start 时不许假装"正在跑"')
    assert.equal(await waitFor(() => states(logFile).some((m) => m.subagents?.running === 1)), true, '跑起来后应显示 running')
    const withSub = states(logFile).find((m) => m.subagents?.running === 1)
    assert.equal(withSub.subagents.items[0].label, '跑测试')
    assert.equal(withSub.subagents.items[0].depth, 1)
    assert.equal(withSub.subagents.items[0].status, 'running')

    assert.equal(await waitFor(() => states(logFile).some((m) => (m.sessions?.total ?? 0) >= 2)), true, '多对话应上线')
    const withSessions = states(logFile).find((m) => (m.sessions?.total ?? 0) >= 2)
    assert.equal(withSessions.sessions.items.some((row) => row.id === 'wire-other'), true)

    // 代理指标在独立字段里
    assert.equal(typeof withProgress.metrics.toolCalls, 'number')
    assert.equal('toolCalls' in withProgress.progress, false)
  })
})

test('线上集成：窗口即将接的四样（todos / cost / text / context）都真的到线上', async () => {
  // 花费账本指向**临时目录**（`DSH_BOTTOM_INFO_BAR_DATA_DIR` 是 dsh-bottom-info-bar 自己认的覆盖位），
  // 绝不去读用户真实的那本账。
  const ledgerDir = mkdtempSync(join(tmpdir(), 'dsh-work-icon-ledger-'))
  writeFileSync(join(ledgerDir, 'usage-records.journal.jsonl'), `${JSON.stringify({
    sessionId: 'wire-four',
    ts: Date.now(),
    cost: 1.5,
    currency: 'CNY',
    pricingStatus: 'priced',
    input: 1000,
    cacheRead: 200,
    cacheWrite: 30,
    output: 50,
  })}\n`)

  try {
    await withPlugin('todos,cost,text,context', async ({ ctx, logFile }) => {
      const root = main('wire-four')
      const emit = (session, event) => ctx.emit('session/event', session, { seq: event.__seq ?? 1, ...event })
      emit(root, { type: 'request/context', __seq: 1, data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 128000 } })
      emit(root, { type: 'turn/start', __seq: 2, data: { turn: 1 } })
      emit(root, {
        type: 'assistant/message',
        __seq: 3,
        data: {
          turn: 1,
          step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
          usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200 },
        },
      })
      emit(root, { type: 'todo/tree', __seq: 4, data: { todos: [{ content: '写代码', status: 'in_progress' }] } })
      emit(root, {
        type: 'assistant/chunk',
        __seq: 5,
        data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '正在想这件事' } },
      })
      emit(root, { type: 'tool/call', __seq: 6, data: { turn: 1, step: 1, toolName: 'read_file', callId: 'c1', arguments: '{}' } })

      // ① todos：计划条目本身（窗口要画清单，不只是进度条）
      //    载荷形状 = `{ items: [{ content, status, depth }], more }`（与其他 v2 载荷同一套信封），
      //    不是裸数组 —— 这条断言同时也是给窗口侧的**形状契约**。
      const todosOf = (message) => (Array.isArray(message?.todos?.items) ? message.todos.items : [])
      assert.equal(
        await waitFor(() => states(logFile).some((m) => todosOf(m).length > 0)),
        true,
        'todos 应上线（声明了 todos 能力）',
      )
      const withTodos = states(logFile).find((m) => todosOf(m).length > 0)
      assert.equal(withTodos.todos.items[0].content, '写代码')
      assert.equal(withTodos.todos.items[0].status, 'in_progress')
      assert.equal(typeof withTodos.todos.items[0].depth, 'number')
      assert.equal(typeof withTodos.todos.more, 'number')

      // ② context：真分母（contextWindow）+ 分子（pressureTokens = input + cacheRead + cacheWrite）
      assert.equal(
        await waitFor(() => states(logFile).some((m) => m.context?.applicable === true)),
        true,
        'context 应上线（声明了 context 能力）',
      )
      const withContext = states(logFile).find((m) => m.context?.applicable === true)
      assert.equal(withContext.context.limit, 128000)
      assert.equal(withContext.context.used, 1200)

      // ③ cost：只读账本、不估算；账本是临时的，所以这里验的是"整条链路通"
      assert.equal(
        await waitFor(() => states(logFile).some((m) => m.cost?.status === 'ok'), 6000),
        true,
        'cost 应上线（声明了 cost 能力 + 账本可读）',
      )
      const withCost = states(logFile).find((m) => m.cost?.status === 'ok')
      assert.equal(withCost.cost.cost.CNY, 1.5)
      assert.equal(withCost.cost.priced, 1)

      // ④ text：流式文本走 text kind（不是 state 字段）
      assert.equal(
        await waitFor(() => received(logFile).some((m) => m.kind === 'text' && (m.thoughtTail || m.activityText))),
        true,
        'text 应上线（声明了 text 能力）',
      )
      const textMessage = received(logFile).find((m) => m.kind === 'text' && (m.thoughtTail || m.activityText))
      assert.equal(typeof textMessage.revision, 'number')
      assert.equal(textMessage.thoughtTail.includes('正在想'), true)

      // ⑤ 顺带钉住上一轮的 tokens 修复在线上也是对的（同一份 usage 只算一次）
      const withTokens = states(logFile).find((m) => m.tokens?.input === 1000)
      assert.ok(withTokens, 'tokens 应上线')
      assert.equal(withTokens.tokens.total, 1050)
    }, { hostEnv: { DSH_BOTTOM_INFO_BAR_DATA_DIR: ledgerDir } })
  } finally {
    rmSync(ledgerDir, { recursive: true, force: true })
  }
})

test('🐛 用户设的 includeSubagents=true 必须活过重启（文件优先于插件行的默认值）', async () => {
  // 真实形态：用户在 config.json 顶层设了 true；宿主全新启动时，插件行配置里是
  // `includeSubagents: false`（cordis.patch.yml 挂载时逐字就是这句）。
  // 修复前这条会红：宿主推 false ⇒ 窗口勾选框每次重启被清空。
  await withPlugin('subagents', async ({ logFile }) => {
    assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'config')), true, '应收到 config 消息')
    const config = received(logFile).filter((m) => m.kind === 'config')[0]
    assert.equal(
      config.includeSubagents,
      true,
      `用户文件里是 true、插件行写的是默认值 false ⇒ 必须以**文件**为准，实际推出 ${String(config.includeSubagents)}`,
    )
  }, {
    beforeApply: (home) => {
      // 用真实的读/写路径落盘（而不是手写 JSON），保证形态与生产一致
      saveConfig({ ...defaults(), includeSubagents: true }, { path: join(home, 'config.json') })
    },
    // 与 cordis.patch.yml 里那一段逐字一致
    config: { includeSubagents: false },
  })
})

test('线上集成：老窗口（不声明能力）收到的 state 里**没有**这些新字段', async () => {
  await withPlugin(undefined, async ({ ctx, logFile }) => {
    const root = main('legacy-root')
    const emit = (session, event) => ctx.emit('session/event', session, { seq: event.__seq ?? 1, ...event })
    emit(root, { type: 'turn/start', __seq: 1, data: { turn: 1 } })
    emit(root, { type: 'todo/tree', __seq: 2, data: { todos: [{ content: 'x', status: 'pending' }] } })
    emit(root, { type: 'turn/end', __seq: 3, data: { turn: 1, reason: { kind: 'completed' } } })

    assert.equal(await waitFor(() => states(logFile).some((m) => m.state === 'SUCCESS')), true, '状态照常工作')
    const all = states(logFile)
    for (const message of all) {
      for (const field of ['progress', 'metrics', 'subagents', 'sessions', 'todos']) {
        assert.equal(field in message, false, `老窗口不该收到 ${field}`)
      }
    }
    // 但冻结的老字段仍在
    assert.ok(all.every((m) => typeof m.state === 'string'))
  })
})
