/**
 * 心跳存活：宿主到底有没有在发心跳？——**并且证明这条判据真的会红**。
 *
 * 背景（2026-09-13 用户报"图标间歇性变空"）：
 *   - 窗口侧日志显示 15s 静默 → DISCONNECTED，共 25 次；
 *   - 但窗口**自己的** 4s 定时器一直准点（中位 4001ms，13 小时里只有 1 次 >15s）⇒ 窗口没卡；
 *   - 静默发生时**任何**入站消息都没有（最近一次 state 渲染就在 15s 前）⇒ 宿主整段没发消息；
 *   - 而 `#beat()` 的每条 `return` 当时都不留日志 ⇒ 无从判断"是心跳没调度，还是宿主被卡住"。
 *
 * 本文件两部分：
 *   ① 存活判据（N 秒内至少 M 条 pulse）—— 走真实子进程上线路；
 *   ② **判据的反证**：把心跳关掉后，同样的判据必须失败（否则这条测试等于没测）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HelperBridge } from '../src/bridge.js'
import { apply } from '../src/index.js'
import { PACKAGE_ROOT } from '../src/config.js'

const LOG_HELPER = fileURLToPath(new URL('./fixtures/fake-helper-log.mjs', import.meta.url))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} }

function readEntries(file) {
  if (!existsSync(file)) return []
  try {
    return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

/** 起一个独立实例（真子进程假窗口），跑 ms 毫秒，数收到了几条 pulse。 */
async function countPulses({ ms, pulseIntervalMs }) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-hb-'))
  const previousHome = process.env.DSH_WORK_ICON_HOME
  process.env.DSH_WORK_ICON_HOME = home
  const file = join(home, 'helper.log')
  const listeners = new Map()
  const disposers = []
  const ctx = {
    logger: quietLogger,
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
      return () => listeners.get(type)?.delete(handler)
    },
    get() {
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      disposers.push(dispose)
      return dispose
    },
    emit(type, ...args) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(...args)
    },
  }
  try {
    apply(ctx, {
      enabled: true,
      pulseIntervalMs,
      helper: {
        command: process.execPath,
        args: [LOG_HELPER],
        cwd: PACKAGE_ROOT,
        env: { DSH_WORK_ICON_FAKE_HELPER: '1', DSH_WORK_ICON_FAKE_LOG: file },
        shutdownGraceMs: 500,
      },
    })
    await sleep(ms)
    return readEntries(file).filter((entry) => entry.event === 'received' && entry.message.kind === 'pulse').length
  } finally {
    for (const dispose of disposers) dispose()
    await sleep(120)
    if (previousHome === undefined) delete process.env.DSH_WORK_ICON_HOME
    else process.env.DSH_WORK_ICON_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
}

test('心跳在跑：3 秒内（心跳周期 500ms）至少收到 3 条 pulse', async () => {
  const count = await countPulses({ ms: 3000, pulseIntervalMs: 500 })
  assert.ok(count >= 3, `心跳应持续发出，实测只收到 ${count} 条 pulse`)
})

test('🩸 反证：把心跳关掉（pulseIntervalMs=0），上面那条判据必须失败', async () => {
  // 同一个判据、同一个观测窗口，只把心跳关掉 —— 结果必须是 0 条。
  // 这条证明"心跳在跑"那句断言不是空断言（否则它永远不会红）。
  const count = await countPulses({ ms: 3000, pulseIntervalMs: 0 })
  assert.equal(count, 0, '关掉心跳后不该有任何 pulse')
  assert.ok(count < 3, '这正是"心跳在跑"这条判据会红的形态')
})

test('静默路径有痕：未就绪时每次跳过的原因都写进诊断文件（限流，不刷屏）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-diag-'))
  const diagFile = join(home, 'host.log')
  const warnings = []
  try {
    // 不 spawn（command 为空且没注入）→ ready 永远为 false → 每一拍都会跳过
    const bridge = new HelperBridge(
      {
        pulseIntervalMs: 40,
        probeIntervalMs: 0,
        diagFile,
        pulseProvider: () => ({ state: 'IDLE' }),
      },
      { debug() {}, info() {}, warn: (line) => warnings.push(line), error() {} },
    )
    bridge.start()
    // 直接拍 8 次（等价于 8 个心跳周期；不依赖真实等待）
    for (let i = 0; i < 8; i++) bridge.beat()
    bridge.dispose('test')

    assert.equal(bridge.stats.beats, 8)
    assert.equal(bridge.stats.skippedBeats, 8, '每次都应被跳过（窗口没就绪）')
    assert.equal(bridge.stats.lastSkipReason, 'window-not-ready', '必须记下"为什么没发"')
    assert.equal(existsSync(diagFile), true, '诊断文件应被写出（用户读得到）')
    const text = readFileSync(diagFile, 'utf8')
    assert.match(text, /心跳未发/u, `诊断内容应说明原因，实际：${text.slice(0, 200)}`)
    // 限流：8 拍同一原因，只记 1 条
    const reasonLines = text.split('\n').filter((line) => line.includes('心跳未发'))
    assert.equal(reasonLines.length, 1, `同一原因必须限流（只记一次），实际 ${reasonLines.length} 条`)
    // logger 侧同样限流（`start()` 自己那条"没有可执行命令"的 warn 不算在内）
    const heartbeatWarnings = warnings.filter((line) => line.includes('心跳未发'))
    assert.equal(heartbeatWarnings.length, 1, `logger 侧也应只收到一条，实际 ${heartbeatWarnings.length} 条`)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('事件循环探针：宿主被同步占住时能被抓到（这就是"宿主卡住"的直接证据）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-lag-'))
  const diagFile = join(home, 'host.log')
  try {
    const bridge = new HelperBridge(
      { pulseIntervalMs: 0, probeIntervalMs: 30, lagWarnMs: 50, diagFile },
      quietLogger,
    )
    bridge.startProbe()
    await sleep(60)
    // 同步占住事件循环 250ms（模拟宿主被长任务卡住）
    const until = Date.now() + 250
    while (Date.now() < until) { /* busy */ }
    await sleep(120)
    bridge.dispose('test')

    assert.ok(bridge.stats.maxLagMs >= 200, `应观察到 ≥200ms 滞后，实际 ${bridge.stats.maxLagMs}ms`)
    assert.equal(bridge.stats.lagWarnings >= 1, true, '应至少告警一次')
    const text = readFileSync(diagFile, 'utf8')
    assert.match(text, /事件循环卡顿/u, `诊断应写明卡顿，实际：${text.slice(0, 200)}`)
    // ① CPU 增量必须真的被记下来（不许只写不验）
    assert.ok(bridge.stats.cpuSamples >= 1, '应至少采样过一次 CPU')
    assert.equal(typeof bridge.stats.lastCpuSample?.cpuMs, 'number')
    assert.match(text, /CPU user\+system=[\d.]+ms/u, `告警行里应带 CPU 增量，实际：${text.slice(-240)}`)
    assert.match(text, /墙钟 \d+ms/u, '还应带同窗口的墙钟时长（否则占比没有意义）')
    // ② 忙等确实烧了 CPU ⇒ 这是"被同步工作占住"那一类，占比必须很高
    //    （看的是**伴随这条告警**的采样，不是"最近一次"——后者会被随后的空闲采样冲掉）
    const lagSample = bridge.stats.lastLagCpuSample
    assert.equal(typeof lagSample?.cpuMs, 'number', '告警应带上它自己那个窗口的 CPU 采样')
    assert.ok(
      lagSample.ratio >= 0.5,
      `忙等应表现为"被同步工作占住"，实际占比 ${(lagSample.ratio * 100).toFixed(0)}%（CPU ${lagSample.cpuMs.toFixed(1)}ms / 墙钟 ${Math.round(lagSample.wallMs)}ms）`,
    )
    assert.match(text, /被同步工作占住/u, '判定词应出现在告警行里')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('CPU 采样能把另一类分出来：不烧 CPU 的阻塞应判为"没被调度"', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-idle-'))
  const diagFile = join(home, 'host.log')
  try {
    const bridge = new HelperBridge(
      { pulseIntervalMs: 0, probeIntervalMs: 30, lagWarnMs: 50, diagFile },
      quietLogger,
    )
    bridge.startProbe()
    await sleep(60)
    // 阻塞主线程 300ms 但**几乎不消耗 CPU**（等价于进程被挂起/没被调度）
    try {
      const shared = new Int32Array(new SharedArrayBuffer(4))
      Atomics.wait(shared, 0, 0, 300)
    } catch {
      // 某些环境不允许主线程 Atomics.wait：退化成忙等，只验"能打印"这一半
      const until = Date.now() + 300
      while (Date.now() < until) { /* busy */ }
    }
    await sleep(150)
    bridge.dispose('test')

    assert.ok(bridge.stats.maxLagMs >= 200, `应观察到 ≥200ms 滞后，实际 ${bridge.stats.maxLagMs}ms`)
    assert.equal(typeof bridge.stats.lastCpuSample?.cpuMs, 'number')
    const text = readFileSync(diagFile, 'utf8')
    assert.match(text, /CPU user\+system=[\d.]+ms/u, `告警行里应带 CPU 增量，实际：${text.slice(-240)}`)
    // 只要环境的 Atomics.wait 真的不烧 CPU，占比就很低 ⇒ 判定词应是"没被调度"
    const lagSample = bridge.stats.lastLagCpuSample
    assert.equal(typeof lagSample?.cpuMs, 'number')
    if (lagSample.ratio <= 0.1) {
      assert.match(text, /CPU 几乎没动 → 进程没被调度/u, '低 CPU 的滞后应被判为"没被调度"')
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('定时器不泄漏：探针与心跳在 dispose 后都要清掉', () => {
  const bridge = new HelperBridge({ pulseIntervalMs: 50, probeIntervalMs: 50 }, quietLogger)
  assert.equal(bridge.pendingTimers(), 0, '还没 start 时不该有定时器')
  bridge.startProbe()
  assert.equal(bridge.pendingTimers(), 1, '探针起来后应有 1 个定时器')
  bridge.detach()
  assert.equal(bridge.pendingTimers(), 0, 'detach 后不该残留定时器')
  bridge.dispose('test')
  assert.equal(bridge.pendingTimers(), 0, 'dispose 后不该残留任何定时器')
})
