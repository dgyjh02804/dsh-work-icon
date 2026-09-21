import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { HelperBridge } from '../src/bridge.js'
import { createMessage } from '../src/protocol.js'
import { PACKAGE_ROOT } from '../src/config.js'

const FAKE_HELPER = fileURLToPath(new URL('./fixtures/fake-helper.mjs', import.meta.url))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** 让流/定时器的回调先跑完。 */
const settle = () => sleep(20)

function collectingLogger() {
  const entries = []
  const record = (level) => (message) => entries.push({ level, message: String(message) })
  return {
    entries,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  }
}

/** 一个足够像 ChildProcess 的假子进程：可注入、可断言 kill、可断言写入内容。 */
function fakeChild(pid = 4242) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.written = []
  child.killCalls = 0
  child.killed = false
  child.stdin.on('data', (chunk) => child.written.push(String(chunk)))
  child.kill = () => {
    child.killCalls += 1
    child.killed = true
    queueMicrotask(() => child.emit('exit', null, 'SIGKILL'))
    return true
  }
  return child
}

async function waitFor(predicate, timeoutMs = 3000, step = 10) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(step)
  }
  return predicate()
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('ready 之前扣住消息、ready 之后补发；同类消息只保留最新一条', async () => {
  const child = fakeChild()
  const bridge = new HelperBridge({ spawn: () => child, pulseIntervalMs: 0, shutdownGraceMs: 0 }, collectingLogger())
  bridge.start()

  assert.equal(bridge.isReady(), false)
  assert.equal(bridge.send(createMessage('state', { state: 'IDLE' })), false)
  assert.equal(bridge.send(createMessage('state', { state: 'THINKING' })), false)
  assert.equal(bridge.send(createMessage('state', { state: 'WORKING' })), false)
  assert.equal(child.written.length, 0, 'ready 之前不该往子进程写任何东西')

  child.stdout.write('{"protocolVersion":1,"kind":"ready","pid":4242}\n')
  await settle()

  assert.equal(bridge.isReady(), true)
  assert.equal(child.written.length, 1, '三条同类消息应合并成一条')
  assert.match(child.written[0], /"kind":"state"/)
  assert.match(child.written[0], /"state":"WORKING"/)

  // ready 之后直发
  assert.equal(bridge.send(createMessage('pulse', { state: 'WORKING' })), true)
  await settle()
  assert.equal(child.written.length, 2)

  bridge.dispose('test')
  await settle()
  assert.equal(child.killCalls, 1)
  assert.equal(bridge.isRunning(), false)
  assert.equal(bridge.pendingTimers(), 0)
  assert.equal(bridge.send(createMessage('state', { state: 'IDLE' })), false)
})

test('脏行（not json / 未知 kind / 空行）被静默忽略，后续正常行照常处理', async () => {
  const child = fakeChild()
  const logger = collectingLogger()
  const received = []
  const bridge = new HelperBridge({
    spawn: () => child,
    pulseIntervalMs: 0,
    shutdownGraceMs: 0,
    onSetting: (message) => received.push(message.key),
  }, logger)
  bridge.start()

  child.stdout.write('not json\n')
  child.stdout.write('{"kind":"bogus"}\n')
  child.stdout.write('\n')
  child.stdout.write('   \n')
  child.stdout.write('{"protocolVersion":99,"kind":"state","state":"IDLE"}\n')
  await settle()

  assert.equal(bridge.isReady(), false, '脏数据不该让桥误判为就绪')
  assert.equal(bridge.stats.invalidLines, 3)
  assert.equal(bridge.stats.receivedMessages, 0)

  // 半行跨 chunk 写入：必须被拼回去
  child.stdout.write('{"protocolVersion":1,"kind":"set')
  await settle()
  assert.equal(bridge.isReady(), false)
  child.stdout.write('ting","key":"scale","value":200}\n')
  await settle()
  assert.deepEqual(received, ['scale'])

  // 后续正常行仍然是 ready
  child.stdout.write('{"protocolVersion":1,"kind":"ready","pid":4242}\n')
  await settle()
  assert.equal(bridge.isReady(), true)

  bridge.dispose('test')
  await settle()
})

test('spawn 抛异常 / 返回空 → 静默降级 + 日志，绝不抛给调用方', () => {
  const logger = collectingLogger()
  const throwing = new HelperBridge({
    spawn: () => { throw new Error('spawn python ENOENT') },
    restartOnCrash: false,
  }, logger)
  assert.doesNotThrow(() => throwing.start())
  assert.equal(throwing.isRunning(), false)
  assert.equal(throwing.stats.spawnFailures, 1)
  assert.ok(logger.entries.some((entry) => entry.message.includes('ENOENT')))
  assert.equal(throwing.pendingTimers(), 0)

  const empty = new HelperBridge({ spawn: () => null, restartOnCrash: false }, logger)
  assert.doesNotThrow(() => empty.start())
  assert.equal(empty.stats.spawnFailures, 1)
  assert.ok(logger.entries.some((entry) => entry.message.includes('no child process')))

  // 子进程报错（异步 error 事件）同样只降级
  const child = fakeChild()
  const bridging = new HelperBridge({
    spawn: () => child,
    restartOnCrash: false,
    pulseIntervalMs: 0,
    shutdownGraceMs: 0,
  }, logger)
  bridging.start()
  assert.doesNotThrow(() => child.emit('error', new Error('EPIPE')))
  assert.equal(bridging.stats.spawnFailures, 1)
})

test('发送协议外的消息只记日志不抛（编码失败即丢弃）', () => {
  const logger = collectingLogger()
  const bridge = new HelperBridge({ spawn: () => null, restartOnCrash: false }, logger)
  assert.doesNotThrow(() => {
    assert.equal(bridge.send({ protocolVersion: 1, kind: 'nope' }), false)
    // v3 是不存在的版本 → 编码失败，丢弃（v1/v2 都是合法入站版本）
    assert.equal(bridge.send({ protocolVersion: 3, kind: 'state', state: 'IDLE' }), false)
    assert.equal(bridge.send({ protocolVersion: 1, kind: 'state', state: 'BUSY' }), false)
  })
  assert.equal(bridge.stats.droppedMessages, 3)
  assert.equal(bridge.stats.sentMessages, 0)
  // 协议内的消息（v2）在窗口没 ready 时是**入队**，不是丢弃
  assert.equal(bridge.send({ protocolVersion: 2, kind: 'state', state: 'IDLE' }), false)
  assert.equal(bridge.stats.queuedMessages, 1)
  assert.equal(bridge.stats.droppedMessages, 3)
})

test('窗口自己选了退出（closed）之后不再自动拉起', async () => {
  let spawnCalls = 0
  const children = []
  const bridge = new HelperBridge({
    spawn: () => {
      spawnCalls += 1
      const child = fakeChild(5000 + spawnCalls)
      children.push(child)
      return child
    },
    pulseIntervalMs: 0,
    restartDelayMs: 10,
    shutdownGraceMs: 0,
  }, collectingLogger())
  bridge.start()
  children[0].stdout.write('{"protocolVersion":1,"kind":"closed","reason":"user-quit"}\n')
  await settle()
  children[0].emit('exit', 0, null)
  await sleep(80)
  assert.equal(spawnCalls, 1, 'closed 之后不该重启')
  assert.equal(bridge.isRunning(), false)
})

test('🚫 红线（SPEC §10.3）：子进程异常退出后绝不自动重启，且明确记日志', async () => {
  let spawnCalls = 0
  const children = []
  const logger = collectingLogger()
  const bridge = new HelperBridge({
    spawn: () => {
      spawnCalls += 1
      const child = fakeChild(7000 + spawnCalls)
      children.push(child)
      return child
    },
    pulseIntervalMs: 0,
    restartDelayMs: 5, // 就算有人想重启，这个延迟也早该触发了
    shutdownGraceMs: 0,
  }, logger) // ← 默认配置：restartOnCrash=false / maxRestarts=0

  bridge.start()
  assert.equal(bridge.restartEnabled, false)
  assert.equal(bridge.restartOnCrash, false)
  assert.equal(bridge.maxRestarts, 0)

  children[0].emit('exit', 1, null)
  await sleep(150)
  assert.equal(spawnCalls, 1, '进程消失=人为终止，绝不能重启')
  assert.equal(bridge.pendingTimers(), 0, '不该留下任何重启定时器')
  assert.equal(bridge.isRunning(), false)

  // 日志必须明确写出"不重启"的原因
  const warnings = logger.entries.filter((entry) => entry.level === 'warn').map((entry) => entry.message)
  assert.ok(
    warnings.some((line) => line.includes('不重启') && line.includes('人为终止')),
    `日志里应有一条说明不重启的 warn，实际：${JSON.stringify(warnings)}`,
  )

  assert.equal(bridge.stats.restarts, 0)
  assert.equal(bridge.spawnAttempts, 1)
})

test('🚫 红线：spawn 失败（命令不存在）同样不重试、不保活', async () => {
  const logger = collectingLogger()
  let spawnCalls = 0
  const bridge = new HelperBridge({
    command: 'definitely-not-a-real-runtime',
    spawn: () => {
      spawnCalls += 1
      throw new Error('ENOENT')
    },
    restartDelayMs: 5,
  }, logger)
  assert.doesNotThrow(() => bridge.start())
  await sleep(150)
  assert.equal(spawnCalls, 1, 'spawn 失败后不该重试')
  assert.equal(bridge.pendingTimers(), 0)
  assert.equal(bridge.stats.spawnFailures, 1)
})

test('自动重启是显式 opt-in：只有 restartOnCrash=true 且 maxRestarts>=1 才生效', async () => {
  const make = (options) => {
    let spawnCalls = 0
    const children = []
    const bridge = new HelperBridge({
      spawn: () => {
        spawnCalls += 1
        const child = fakeChild(8000 + spawnCalls)
        children.push(child)
        return child
      },
      pulseIntervalMs: 0,
      restartDelayMs: 10,
      shutdownGraceMs: 0,
      ...options,
    }, collectingLogger())
    bridge.start()
    return { bridge, children, calls: () => spawnCalls }
  }

  // 只写 restartOnCrash=true、maxRestarts 留 0 → 不重启（双条件保险）
  const half = make({ restartOnCrash: true })
  assert.equal(half.bridge.restartEnabled, false)
  half.children[0].emit('exit', 1, null)
  await sleep(80)
  assert.equal(half.calls(), 1)

  // 只写 maxRestarts=2、restartOnCrash 留 false → 同样不重启
  const other = make({ maxRestarts: 2 })
  assert.equal(other.bridge.restartEnabled, false)
  other.children[0].emit('exit', 1, null)
  await sleep(80)
  assert.equal(other.calls(), 1)

  // 两个都显式写了 → 才按上限重启（能力保留，但不是默认行为）
  const opted = make({ restartOnCrash: true, maxRestarts: 2 })
  assert.equal(opted.bridge.restartEnabled, true)
  opted.children[0].emit('exit', 1, null)
  await sleep(60)
  assert.equal(opted.calls(), 2)
  opted.children[1].emit('exit', 1, null)
  await sleep(60)
  assert.equal(opted.calls(), 3)
  opted.children[2].emit('exit', 1, null)
  await sleep(60)
  assert.equal(opted.calls(), 3, '达到显式配置的上限后停止')
  assert.equal(opted.bridge.pendingTimers(), 0)
})

test('没有可解析的窗口运行时（command 为空 + 真实 spawn）时安静降级：不 spawn、不抛、不重试', async () => {
  const logger = collectingLogger()
  const bridge = new HelperBridge({}, logger) // ← 不注入 spawn、不配置 command
  assert.doesNotThrow(() => bridge.start())
  await sleep(60)
  assert.equal(bridge.isRunning(), false)
  assert.equal(bridge.spawnAttempts, 0, '压根不该尝试启动')
  assert.equal(bridge.stats.spawnFailures, 1, '要留痕')
  assert.equal(bridge.pendingTimers(), 0)
  assert.ok(logger.entries.some((entry) => entry.message.includes('未配置可用的窗口运行时')))
})

test('心跳：ready 之后按周期发 pulse，载荷来自 pulseProvider', async () => {
  const child = fakeChild()
  const bridge = new HelperBridge({
    spawn: () => child,
    pulseIntervalMs: 20,
    shutdownGraceMs: 0,
    pulseProvider: () => ({ state: 'WORKING', activity: 'testing' }),
  }, collectingLogger())
  bridge.start()
  child.stdout.write('{"protocolVersion":1,"kind":"ready","pid":4242}\n')
  await settle()
  await sleep(80)
  const pulses = child.written.filter((line) => line.includes('"kind":"pulse"'))
  assert.ok(pulses.length >= 2, `期望至少 2 次心跳，实际 ${pulses.length}`)
  assert.match(pulses[0], /"activity":"testing"/)

  // pulseProvider 抛异常也不能把定时器/宿主带崩
  const broken = new HelperBridge({
    spawn: () => child,
    pulseIntervalMs: 10,
    shutdownGraceMs: 0,
    pulseProvider: () => { throw new Error('boom') },
  }, collectingLogger())
  broken.start()
  child.stdout.write('{"protocolVersion":1,"kind":"ready","pid":4242}\n')
  await settle()
  await sleep(40)
  assert.equal(broken.isReady(), true)

  broken.dispose('test')
  bridge.dispose('test')
  await settle()
  assert.equal(bridge.pendingTimers(), 0)
  assert.equal(broken.pendingTimers(), 0)
})

test('真实子进程端到端：ready→state→pulse→echo，dispose 后进程真的消失', async () => {
  const logger = collectingLogger()
  const echoes = []
  const bridge = new HelperBridge({
    command: process.execPath,
    args: [FAKE_HELPER],
    cwd: PACKAGE_ROOT,
    env: { DSH_WORK_ICON_FAKE_HELPER: '1' },
    pulseIntervalMs: 30,
    shutdownGraceMs: 500,
    pulseProvider: () => ({ state: 'WORKING', activity: 'testing' }),
    onSetting: (message) => echoes.push(message),
  }, logger)

  const child = bridge.start()
  assert.ok(child && Number.isFinite(child.pid))
  const pid = child.pid

  assert.equal(await waitFor(() => bridge.isReady(), 8000), true, '假 helper 应发出 ready')
  // 假 helper 在 ready 之前吐了 3 条脏行，必须被忽略且不影响后续
  assert.equal(bridge.stats.invalidLines, 3)
  assert.equal(bridge.stats.spawnFailures, 0)

  // state 上行 → helper 回显
  assert.equal(bridge.send(createMessage('state', { state: 'THINKING', activity: 'editing' })), true)
  assert.equal(
    await waitFor(() => echoes.some((m) => m.value?.kind === 'state' && m.value.state === 'THINKING'), 4000),
    true,
  )

  // 心跳
  assert.equal(await waitFor(() => echoes.some((m) => m.value?.kind === 'pulse'), 4000), true)

  // 优雅收尾
  const exited = once(child, 'exit').catch(() => undefined)
  bridge.dispose('test-dispose')
  assert.equal(await waitFor(() => echoes.some((m) => m.value?.kind === 'shutdown'), 3000), true, 'shutdown 应送达子进程')
  await Promise.race([exited, sleep(5000)])
  await waitFor(() => !bridge.isRunning(), 5000)

  assert.equal(bridge.pendingTimers(), 0, 'dispose 后不该残留定时器')
  assert.equal(isProcessAlive(pid), false, '子进程必须真的退出，不能留孤儿')
  assert.equal(bridge.isReady(), false)
})
