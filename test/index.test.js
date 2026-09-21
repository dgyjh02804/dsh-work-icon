import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../src/index.js'
import { PACKAGE_ROOT } from '../src/config.js'

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

/** 假 helper 写下的日志行（文件可能还没创建）。 */
function logLines(logFile) {
  try {
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

/** 宿主发给窗口的消息（假 helper 记下来的）。 */
function received(logFile) {
  return logLines(logFile).filter((entry) => entry.event === 'received').map((entry) => entry.message)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 最小的 Cordis ctx 替身：只需要 on / effect / get / logger。 */
function fakeCtx({ agents, logger: customLogger } = {}) {
  const listeners = new Map()
  return {
    disposers: [],
    logger: customLogger ?? { debug() {}, info() {}, warn() {}, error() {} },
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
      return () => listeners.get(type)?.delete(handler)
    },
    get(name) {
      return name === 'agents' ? agents : undefined
    },
    effect(callback) {
      const dispose = callback()
      this.disposers.push(dispose)
      return dispose
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
    emit(type, ...args) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(...args)
    },
    disposeAll() {
      for (const dispose of this.disposers.splice(0)) dispose()
    },
  }
}

function withTempHome(fn) {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-home-'))
    const previous = process.env.DSH_WORK_ICON_HOME
    process.env.DSH_WORK_ICON_HOME = home
    try {
      await fn(home)
    } finally {
      if (previous === undefined) delete process.env.DSH_WORK_ICON_HOME
      else process.env.DSH_WORK_ICON_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  }
}

test('Cordis 契约：导出 name / inject / apply，最简 ctx 也不会炸', withTempHome(async () => {
  assert.equal(name, 'dsh-work-icon')
  assert.deepEqual(inject, ['sessions'])
  assert.equal(typeof apply, 'function')
  // 一个没有 logger / on / effect 的空 ctx：只能安静关闭，不能抛
  assert.doesNotThrow(() => apply({}, {}))
  assert.doesNotThrow(() => apply(undefined, undefined))
  // 缺 effect 的 ctx + enabled=true：构造途中失败也必须被 apply 兜住
  assert.doesNotThrow(() => apply({}, { enabled: true }))
  await sleep(50)
}))

test('enabled=false（默认）：不订阅会话总线、不拉窗口进程、不写配置', withTempHome(async (home) => {
  const ctx = fakeCtx()
  apply(ctx, {})
  assert.equal(ctx.listenerCount('session/event'), 0)
  assert.equal(ctx.listenerCount('session/disposed'), 0)
  assert.deepEqual(ctx.disposers, [], '关闭状态下不该注册任何 disposer')
  assert.equal(existsSync(join(home, 'config.json')), false)
}))

test('插件配置可以覆盖配置文件（enabled=true 才会真的动起来）', withTempHome(async () => {
  const ctx = fakeCtx()
  apply(ctx, { enabled: true, helper: { command: 'definitely-not-a-real-python', args: ['x.py'], restartOnCrash: false } })
  // 启动方式非法，但插件本身不能崩：只降级、监听器照常装上
  assert.equal(ctx.listenerCount('session/event'), 1)
  assert.equal(ctx.listenerCount('session/disposed'), 1)
  assert.doesNotThrow(() => ctx.emit('session/event', { header: { id: 's1' } }, { type: 'turn/start', seq: 1 }))
  ctx.disposeAll()
  assert.equal(ctx.listenerCount('session/event'), 0)
  await sleep(50)
}))

test('端到端：会话事件 → 状态上行 → 心跳 → 设置回传落盘 → 卸载时子进程退出', withTempHome(async (home) => {
  const logFile = join(home, 'helper.log')
  const ctx = fakeCtx()
  let pid

  apply(ctx, {
    enabled: true,
    pulseIntervalMs: 50,
    helper: {
      command: process.execPath,
      args: [LOG_HELPER],
      cwd: PACKAGE_ROOT,
      env: { DSH_WORK_ICON_FAKE_HELPER: '1', DSH_WORK_ICON_FAKE_LOG: logFile },
      shutdownGraceMs: 1000,
    },
  })

  assert.equal(ctx.listenerCount('session/event'), 1)
  assert.equal(ctx.listenerCount('session/disposed'), 1)
  assert.equal(ctx.listenerCount('agent/status'), 1)

  // 窗口进程起来了
  assert.equal(await waitFor(() => logLines(logFile).some((entry) => entry.event === 'started')), true, '窗口进程应被拉起')
  pid = logLines(logFile).find((entry) => entry.event === 'started').pid
  assert.ok(Number.isFinite(pid))

  // ready 之后：初始 IDLE 状态 + 窗口配置都补发过去了
  assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'state' && m.state === 'IDLE')), true)
  const initialConfig = received(logFile).find((m) => m.kind === 'config')
  assert.equal(initialConfig.scale, 140)
  assert.equal(initialConfig.opacity, 100)
  assert.equal(initialConfig.alwaysOnTop, true)
  assert.equal(initialConfig.clickThrough, true)
  assert.equal(initialConfig.position, null)

  // 会话事件 → 状态上行（Bash 跑测试 → WORKING/testing；arguments 是未解析 JSON 串）
  const session = { header: { id: 's1', cwd: 'C:\\Users\\david\\Desktop\\构建\\demo' } }
  ctx.emit('session/event', session, {
    type: 'tool/call',
    turn: 1,
    step: 1,
    seq: 1,
    data: { name: 'Bash', callId: 'c1', arguments: '{"command":"pnpm test","timeout":120000}' },
  })
  assert.equal(
    await waitFor(() => received(logFile).some((m) => m.kind === 'state' && m.state === 'WORKING' && m.activity === 'testing')),
    true,
  )
  assert.equal(received(logFile).some((m) => m.kind === 'state' && m.session === 's1' && m.toolName === 'Bash'), true)

  // agent/status 粗粒度信号：会话被回收前先把它拉回 THINKING（幂等，不破坏优先级）
  ctx.emit('agent/status', { agent: { id: 's1', session, status: 'running' }, status: 'running' })
  await sleep(60)

  // session/title 事件提供会话标题
  ctx.emit('session/event', session, { type: 'session/title', seq: 2, data: { title: '写宿主侧', source: 'provider' } })
  assert.equal(
    await waitFor(() => received(logFile).some((m) => m.kind === 'state' && m.title === '写宿主侧')),
    true,
  )

  // 心跳
  assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'pulse')), true)

  // 窗口回传 setting → 落盘 + 立刻回发新 config
  assert.equal(await waitFor(() => existsSync(join(home, 'config.json'))), true)
  const saved = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))
  assert.equal(saved.window.scale, 200)
  assert.equal(saved.enabled, true)
  assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'config' && m.scale === 200)), true)

  // 会话回收 → DISCONNECTED
  ctx.emit('session/disposed', session)
  assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'state' && m.state === 'DISCONNECTED')), true)

  // 卸载：监听器全部解除、子进程优雅退出、不留孤儿
  ctx.disposeAll()
  assert.equal(ctx.listenerCount('session/event'), 0)
  assert.equal(ctx.listenerCount('session/disposed'), 0)
  assert.equal(ctx.listenerCount('agent/status'), 0)
  assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'shutdown')), true, 'shutdown 应送达')
  assert.equal(await waitFor(() => !isProcessAlive(pid), 5000), true, '卸载后子进程必须退出')
  // 卸载之后再来的事件不会引发任何新消息
  const before = received(logFile).length
  ctx.emit('session/event', session, { type: 'turn/start', turn: 2, data: { turn: 2 } })
  ctx.emit('agent/status', { agent: { id: 's1', session, status: 'running' }, status: 'running' })
  await sleep(120)
  assert.equal(received(logFile).length, before)
}))

test('菜单实时切换 includeSubagents=true：持久化 + 立即生效 + 宿主/窗口进程都不重启', withTempHome(async (home) => {
  const logFile = join(home, 'helper.log')
  const hostLog = []
  const collect = (level) => (message) => hostLog.push(`${level}: ${String(message)}`)
  const ctx = fakeCtx({ logger: { debug: collect('debug'), info: collect('info'), warn: collect('warn'), error: collect('error') } })

  apply(ctx, {
    enabled: true,
    pulseIntervalMs: 200,
    helper: {
      command: process.execPath,
      args: [LOG_HELPER],
      cwd: PACKAGE_ROOT,
      env: {
        DSH_WORK_ICON_FAKE_HELPER: '1',
        DSH_WORK_ICON_FAKE_LOG: logFile,
        DSH_WORK_ICON_FAKE_SETTING_KEY: 'includeSubagents',
        DSH_WORK_ICON_FAKE_SETTING_VALUE: 'true',
      },
      shutdownGraceMs: 1000,
    },
  })

  assert.equal(await waitFor(() => logLines(logFile).some((entry) => entry.event === 'started')), true, '窗口进程应被拉起')
  const pid = logLines(logFile).find((entry) => entry.event === 'started').pid

  // ① 菜单回传 setting → 原子落盘（宿主没有重启：全程只有一个 helper 进程）
  assert.equal(await waitFor(() => {
    try {
      return JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).includeSubagents === true
    } catch {
      return false
    }
  }), true, 'includeSubagents 必须被持久化到 config.json')

  // ② 立即生效：打开后子代理会话的活动会推到窗口
  const parent = { header: { id: 'p1', cwd: 'C:\\repo\\main' } }
  const child = { header: { id: 'c1', origin: 'subagent', cwd: 'C:\\repo\\sub' } }
  ctx.emit('session/event', parent, { type: 'turn/start', turn: 1, seq: 1, data: { turn: 1 } })
  await sleep(150)
  ctx.emit('session/event', child, {
    type: 'tool/call',
    turn: 1,
    seq: 1,
    data: { name: 'bash', callId: 'child-1', arguments: '{"command":"ls"}' },
  })
  assert.equal(
    await waitFor(() => received(logFile).some((m) => m.kind === 'state' && m.session === 'c1' && m.state === 'WORKING')),
    true,
    '开关打开后子代理必须能上屏',
  )

  // ③ 没有重启：窗口侧只 started 过一次，pid 仍活着，宿主也明确记了"即时生效"
  assert.equal(logLines(logFile).filter((entry) => entry.event === 'started').length, 1, '不该重启窗口进程')
  assert.equal(isProcessAlive(pid), true)
  assert.ok(
    hostLog.some((line) => line.includes('includeSubagents -> true') && line.includes('无需重启')),
    `宿主日志应说明即时生效，实际：${JSON.stringify(hostLog)}`,
  )

  ctx.disposeAll()
  assert.equal(await waitFor(() => !isProcessAlive(pid), 5000), true)
}))

test('菜单保持 includeSubagents=false（默认）：子代理会话完全不上屏', withTempHome(async (home) => {
  const logFile = join(home, 'helper.log')
  const ctx = fakeCtx()
  apply(ctx, {
    enabled: true,
    pulseIntervalMs: 200,
    helper: {
      command: process.execPath,
      args: [LOG_HELPER],
      cwd: PACKAGE_ROOT,
      env: {
        DSH_WORK_ICON_FAKE_HELPER: '1',
        DSH_WORK_ICON_FAKE_LOG: logFile,
        DSH_WORK_ICON_FAKE_SETTING_KEY: 'includeSubagents',
        DSH_WORK_ICON_FAKE_SETTING_VALUE: 'false',
      },
      shutdownGraceMs: 1000,
    },
  })
  assert.equal(await waitFor(() => logLines(logFile).some((entry) => entry.event === 'started')), true)
  await sleep(200)

  const parent = { header: { id: 'p1', cwd: 'C:\\repo\\main' } }
  const child = { header: { id: 'c1', origin: 'subagent', cwd: 'C:\\repo\\sub' } }
  ctx.emit('session/event', parent, { type: 'turn/start', turn: 1, seq: 1, data: { turn: 1 } })
  await sleep(150)
  ctx.emit('session/event', child, {
    type: 'tool/call',
    turn: 1,
    seq: 1,
    data: { name: 'bash', callId: 'child-1', arguments: '{"command":"ls"}' },
  })
  await sleep(400)
  assert.equal(
    received(logFile).some((m) => m.kind === 'state' && m.session === 'c1'),
    false,
    '关着的时候子代理不该出现在任何 state 消息里',
  )
  // 主会话照常上屏
  assert.equal(received(logFile).some((m) => m.kind === 'state' && m.session === 'p1'), true)

  ctx.disposeAll()
  await sleep(300)
}))

test('菜单不能通过 setting 改写其它顶层键（enabled / helper.*）', withTempHome(async (home) => {
  const logFile = join(home, 'helper.log')
  const hostLog = []
  const collect = (level) => (message) => hostLog.push(`${level}: ${String(message)}`)
  const ctx = fakeCtx({ logger: { debug: collect('debug'), info: collect('info'), warn: collect('warn'), error: collect('error') } })
  apply(ctx, {
    enabled: true,
    pulseIntervalMs: 0,
    helper: {
      command: process.execPath,
      args: [LOG_HELPER],
      cwd: PACKAGE_ROOT,
      env: {
        DSH_WORK_ICON_FAKE_HELPER: '1',
        DSH_WORK_ICON_FAKE_LOG: logFile,
        DSH_WORK_ICON_FAKE_SETTING_KEY: 'helper.command',
        DSH_WORK_ICON_FAKE_SETTING_VALUE: '"evil.exe"',
      },
      shutdownGraceMs: 1000,
    },
  })
  assert.equal(await waitFor(() => logLines(logFile).some((entry) => entry.event === 'started')), true)
  // 被拒绝的设置在宿主日志里留痕
  assert.equal(
    await waitFor(() => hostLog.some((line) => line.includes('忽略未知设置项') && line.includes('helper.command'))),
    true,
    `宿主应记下拒绝，实际：${JSON.stringify(hostLog)}`,
  )
  // 且配置里绝不出现被拒绝的值
  const saved = existsSync(join(home, 'config.json')) ? JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) : undefined
  assert.equal(saved?.helper?.command, undefined, '窗口不能改写 helper.command')
  ctx.disposeAll()
  await sleep(200)
}))

test('可选 agents 服务：启动时对一次账，已经在跑的 agent 立刻亮起来', withTempHome(async () => {
  const running = { header: { id: 'run-1', cwd: '/repo/alpha' } }
  const idle = { header: { id: 'idle-1', cwd: '/repo/beta' } }
  const ctx = fakeCtx({
    agents: {
      list: () => [
        { id: 'run-1', session: running, status: 'running' },
        { id: 'idle-1', session: idle, status: 'idle' },
      ],
      get: (id) => (id === 'run-1' ? { id: 'run-1', session: running, status: 'running' } : undefined),
    },
  })
  apply(ctx, { enabled: true, helper: { command: 'definitely-not-a-real-python', args: ['x.py'], restartOnCrash: false } })
  assert.equal(ctx.listenerCount('agent/status'), 1)
  // 对账本身不该抛（没有窗口进程时消息只是进队列）
  assert.doesNotThrow(() => ctx.emit('agent/status', { agent: { session: running, status: 'idle' }, status: 'idle' }))
  ctx.disposeAll()
  await sleep(50)
}))

test('agents 服务读取失败也不能拖垮插件（降级为纯事件推断）', withTempHome(async () => {
  const ctx = fakeCtx()
  ctx.get = () => { throw new Error('service unavailable') }
  assert.doesNotThrow(() => apply(ctx, { enabled: true, helper: { command: 'nope', args: ['x'], restartOnCrash: false } }))
  assert.equal(ctx.listenerCount('session/event'), 1)
  ctx.disposeAll()
  await sleep(50)
}))
