/**
 * 真端到端：宿主插件 → 真实 Electron 运行时（离屏）→ 七态 → 优雅退出。
 *
 * 刻意**不**被 `node --test "test/*.test.js"` 匹配（默认 npm test 保持快而自足）；
 * 显式跑：`npm run test:e2e`。
 *
 * 安全红线（SPEC §10）：
 *  - 窗口全程离屏（主进程默认 show:false，我们不传 --show），断言日志里出现
 *    "window created hidden (show=false)"；
 *  - 不做任何真实输入合成（不碰 SetCursorPos / mouse_event / SendInput / SendKeys）；
 *  - 收尾靠 shutdown + stdin EOF，之后清点残留 electron.exe（应为 0）；
 *  - USERPROFILE 指向临时目录，不写用户的真实 Electron profile。
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/index.js'
import { resolveHelperLaunch } from '../src/config.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs = 20000, step = 100) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) return value
    if (Date.now() > deadline) return undefined
    await sleep(step)
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 只数**本次测试**起的 electron：用本次独有的日志路径做归属标记。
 * 本机可能有并行会话在跑窗口侧自己的测试，绝不能把它们算进来、更不能误杀。
 */
function strayElectronCount(marker) {
  const filter = marker
    ? `Where-Object { $_.CommandLine -like '*dsh-work-icon*' -and $_.CommandLine -like '*${marker}*' }`
    : "Where-Object { $_.CommandLine -like '*dsh-work-icon*' }"
  const script = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + `${filter} | Measure-Object | Select-Object -ExpandProperty Count`
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true })
    return Number(String(result.stdout || '0').trim()) || 0
  } catch {
    return -1
  }
}

/** 兜底清理：只杀带本次标记的进程（同样绝不碰并行会话的实例）。 */
function killStrayRuntime(marker) {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + `Where-Object { $_.CommandLine -like '*dsh-work-icon*' -and $_.CommandLine -like '*${marker}*' } | `
    + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true })
  } catch {
    // 清理失败只记录，不影响断言结论
  }
}

/** 最小 Cordis ctx 替身（与 test/index.test.js 同构）。 */
function fakeCtx(logger) {
  const listeners = new Map()
  return {
    disposers: [],
    logger,
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
      return () => listeners.get(type)?.delete(handler)
    },
    get: () => undefined,
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

async function main() {
  const launch = resolveHelperLaunch({})
  if (!launch.ok) {
    console.log(`[E2E][skip] 本机没有可解析的 Electron 运行时：${launch.reason}`)
    process.exitCode = 0
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'dsh-work-icon-e2e-'))
  const home = join(root, 'home')
  const windowLog = join(root, 'window.log')
  // Electron 需要一个可用的用户目录，否则会静默起不来（窗口侧实测过）
  mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true })

  const previousHome = process.env.DSH_WORK_ICON_HOME
  process.env.DSH_WORK_ICON_HOME = home
  const entries = []
  const record = (level) => (message) => entries.push({ level, message: String(message) })
  const logger = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') }
  const ctx = fakeCtx(logger)
  /** 归属标记：本次独有的窗口日志路径，用来把"我起的进程"和并行会话起的区分开。 */
  const marker = windowLog
  const otherRuntimeCount = strayElectronCount()

  try {
    assert.equal(strayElectronCount(marker), 0, '起始不该有本次测试的残留 electron')
    if (otherRuntimeCount > 0) {
      // 只提示，不作断言：并行会话可能正在跑窗口侧自己的测试
      console.log(`[E2E] 提示：本机现有 ${otherRuntimeCount} 个本 runtime 的 electron 进程，`
        + '但不是本次测试起的（可能是并行会话），不会去动它们')
    }

    apply(ctx, {
      enabled: true,
      pulseIntervalMs: 250,
      helper: {
        // --hidden 是**测试专用**：窗口侧默认会 show()（那是产品该有的行为），
        // 端到端测试必须显式离屏，否则会在用户屏幕上弹出一个置顶图标（红线 §10.5）。
        args: ['runtime/electron', '--hidden', '--log', windowLog, '--window-timeout', '3000'],
        env: {
          ...process.env,
          USERPROFILE: home,
          DSH_WORK_ICON_HOME: home,
          ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        },
        shutdownGraceMs: 3000,
      },
    })

    // ① 宿主确实自动解析到了包内 Electron（不需要用户手工配 config）
    const started = entries.find((entry) => entry.message.includes('已启动'))
    assert.ok(started, `宿主应记录启动信息，实际日志：${JSON.stringify(entries.map((e) => e.message))}`)
    assert.match(started.message, /source=auto/, '默认应走自动解析而不是显式配置')
    assert.match(started.message, /electron\.exe/i, '应解析到 electron 可执行文件')

    // ② 窗口进程起来并握手（日志由窗口自己写，是"真的收到了"的证据）
    const created = await waitFor(() => readText(windowLog).includes('window created hidden (show=false)'), 30000)
    assert.ok(created, `窗口应在 30s 内以离屏方式创建；窗口日志：${readText(windowLog).slice(-800)}`)
    assert.ok(readText(windowLog).includes('stdin attached via'), '窗口应通过宿主的管道接管 stdio')
    // 🚫 红线：整个测试期间窗口绝不能 show()
    assert.ok(!readText(windowLog).includes('window shown'), '测试期间窗口不得显示（红线 §10.5 默认离屏）')

    // ③ 喂合成会话事件，走完整的"事件 → 归约 → state 消息 → 窗口渲染"链路
    const session = { header: { id: 'e2e-1', cwd: 'C:\\Users\\david\\Desktop\\构建\\demo' } }
    const feed = async (event, type = 'session/event') => {
      if (type === 'session/event') ctx.emit('session/event', session, event)
      else ctx.emit(type, event)
      await sleep(150)
    }

    await feed({ type: 'request/header', seq: 1, data: {} })                                  // IDLE
    await feed({ type: 'turn/start', turn: 1, data: { turn: 1 }, seq: 2 })                     // THINKING
    await feed({ type: 'tool/call', seq: 3, data: { name: 'bash', callId: 'c1', arguments: '{"command":"pnpm test"}' } }) // WORKING/testing
    await feed({ type: 'approval/asked', seq: 4, data: { id: 'a1', toolName: 'bash' } })        // WAITING
    await feed({ type: 'approval/decided', seq: 5, data: { id: 'a1', outcome: 'approved' } })
    await feed({ type: 'tool/result', seq: 6, data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] } } })
    await feed({ type: 'turn/end', turn: 1, seq: 7, data: { turn: 1, reason: { kind: 'completed' } } })  // SUCCESS
    await feed({ type: 'turn/start', turn: 2, data: { turn: 2 }, seq: 8 })
    await feed({ type: 'turn/end', turn: 2, seq: 9, data: { turn: 2, reason: { kind: 'error', error: { message: 'boom', code: 'E2E' } } } }) // ERROR
    ctx.emit('session/disposed', session)                                                       // DISCONNECTED
    await sleep(400)

    const expected = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']
    // 等最后一个状态到达（不靠猜 sleep），超时则把两边的日志都倒出来再断言
    const arrived = await waitFor(
      () => expected.every((state) => readText(windowLog).includes(`STATE -> ${state}`)),
      15000,
    )
    if (!arrived) {
      console.log('\n[E2E] ❌ 状态没集齐，窗口完整日志:\n' + readText(windowLog))
      console.log('[E2E] 宿主日志:\n' + entries.map((entry) => `       ${entry.level}: ${entry.message}`).join('\n'))
    }
    const text = readText(windowLog)
    const rendered = [...text.matchAll(/STATE -> ([A-Z]+)/g)].map((match) => match[1])
    for (const state of expected) {
      assert.ok(rendered.includes(state), `窗口侧没有渲染 ${state}；实际渲染序列：${rendered.join(' → ')}`)
    }
    // 首次出现顺序必须与事件顺序一致
    const firstIndex = (state) => rendered.indexOf(state)
    for (let i = 1; i < expected.length; i += 1) {
      assert.ok(
        firstIndex(expected[i - 1]) < firstIndex(expected[i]),
        `顺序错误：${expected[i - 1]}(${firstIndex(expected[i - 1])}) 应早于 ${expected[i]}(${firstIndex(expected[i])})；实际 ${rendered.join(' → ')}`,
      )
    }
    assert.ok(text.includes('config <-'), '窗口应收到宿主的 config 消息')

    // ④ 心跳证据：停止喂事件后静置 2s（窗口超时 3s）。若 pulse 没送达，
    //    窗口会自己打一条 watchdog 超时并转 DISCONNECTED；没有新增就说明心跳在维持。
    const watchdogBefore = (readText(windowLog).match(/watchdog: \d+ms 无消息/g) ?? []).length
    await sleep(2000)
    const watchdogAfter = (readText(windowLog).match(/watchdog: \d+ms 无消息/g) ?? []).length
    assert.equal(watchdogAfter, watchdogBefore, '静置期间不该出现新的超时（说明 pulse 没送达）')

    // ⑤ dispose：优雅退出、不留孤儿
    const strayBeforeDispose = strayElectronCount(marker)
    assert.ok(strayBeforeDispose >= 1, `dispose 前应有本次测试的 electron，实际 ${strayBeforeDispose}`)

    ctx.disposeAll()
    const gone = await waitFor(() => strayElectronCount(marker) === 0, 20000)
    assert.ok(gone !== undefined, `dispose 后窗口进程必须退出，实际残留 ${strayElectronCount(marker)} 个`)

    const finalText = readText(windowLog)
    assert.match(finalText, /shutdown received -> exit|stdin EOF -> parent gone/, '应是优雅退出而不是被强杀')

    // ⑥ 不重启：再等 2s，不允许出现新的 electron（红线：进程消失=人为终止）
    await sleep(2000)
    assert.equal(strayElectronCount(marker), 0, '窗口退出后不得被自动拉起')
    const restarts = entries.filter((entry) => /重启窗口进程/.test(entry.message))
    assert.deepEqual(restarts, [], `不该有任何重启日志：${JSON.stringify(restarts)}`)

    console.log('\n[E2E] 窗口渲染序列: ' + rendered.join(' → '))
    console.log('[E2E] 窗口日志尾部:')
    console.log(finalText.split('\n').filter(Boolean).slice(-6).map((line) => '       ' + line).join('\n'))
  } finally {
    ctx.disposeAll()
    await sleep(300)
    // 兜底：无论断言是否失败，都不许给用户留一个图标窗口（只杀带本次标记的进程）
    let stray = strayElectronCount(marker)
    if (stray > 0) {
      console.log(`\n[E2E] ⚠️ dispose 后仍有 ${stray} 个本次测试的 electron，执行兜底清理`)
      killStrayRuntime(marker)
      await sleep(800)
      stray = strayElectronCount(marker)
      console.log(`[E2E] 兜底清理后残留：${stray}`)
    }
    if (previousHome === undefined) delete process.env.DSH_WORK_ICON_HOME
    else process.env.DSH_WORK_ICON_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * 自保护：`node --test` 的默认匹配包含 `**\/*.test.mjs`，从包根裸跑会递归吃到本文件。
 * 本脚本会真的拉起 Electron（虽然离屏），不该混进单元测试里，所以在 runner 子进程里直接退出。
 * 唯一入口：`npm run test:e2e` 或 `node test/e2e-electron.mjs`。
 */
if (process.env.NODE_TEST_CONTEXT) {
  console.log('[skip] test/e2e-electron.mjs 是 Electron 端到端脚本，不是单元测试；'
    + '请用 npm run test:e2e 运行')
  process.exit(0)
}

try {
  await main()
  console.log('\n[E2E] ✅ 通过')
} catch (error) {
  process.exitCode = 1
  console.log(`\n[E2E] ❌ 失败：${error && error.message ? error.message : error}`)
  if (error && error.stack) console.log(error.stack.split('\n').slice(0, 4).join('\n'))
  // 兜底再清一次（只杀本次标记的进程），绝不给用户留窗
  killStrayRuntime(process.env.DSH_WORK_ICON_E2E_MARKER || 'dsh-work-icon-e2e-')
}
