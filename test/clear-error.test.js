/**
 * 端到端回归：「人处理了 → 清除错误」这条出口真的通到线上（不是只测了归约器）。
 *
 * 走的是**真实链路**：窗口进程（假 helper 冒充）→ stdout 的 `setting` 消息
 * → 桥 → 插件 onSetting → 归约器 acknowledgeError → 新的 state 回到窗口。
 * 同时也验证：确认动作**不落盘**（它不是配置项）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, CLEAR_ERROR_KEYS } from '../src/index.js'
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

function logLines(logFile) {
  try {
    return readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

const received = (logFile) => logLines(logFile).filter((entry) => entry.event === 'received').map((entry) => entry.message)
const states = (logFile) => received(logFile).filter((m) => m.kind === 'state').map((m) => m.state)

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

test('端到端：窗口发 work-icon.clearError → 红色立刻被清掉，且不写配置文件', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-work-icon-ack-'))
  const previousHome = process.env.DSH_WORK_ICON_HOME
  process.env.DSH_WORK_ICON_HOME = home
  const logFile = join(home, 'helper.log')
  const logged = []
  const logger = {
    debug() {},
    info: (line) => logged.push(String(line)),
    warn: (line) => logged.push(`WARN ${String(line)}`),
    error: (line) => logged.push(`ERROR ${String(line)}`),
  }
  const ctx = fakeCtx(logger)
  try {
    assert.deepEqual([...CLEAR_ERROR_KEYS], ['work-icon.clearError', 'error.clear'])

    apply(ctx, {
      enabled: true,
      pulseIntervalMs: 1000,
      helper: {
        command: process.execPath,
        args: [LOG_HELPER],
        cwd: PACKAGE_ROOT,
        env: {
          DSH_WORK_ICON_FAKE_HELPER: '1',
          DSH_WORK_ICON_FAKE_LOG: logFile,
          // 窗口侧在 400ms 后才发"清除错误"（模拟：错误先发生，用户随后点了一下图标）
          DSH_WORK_ICON_FAKE_SETTING_KEY: 'work-icon.clearError',
          DSH_WORK_ICON_FAKE_SETTING_DELAY_MS: '400',
        },
        shutdownGraceMs: 1000,
      },
    })

    assert.equal(await waitFor(() => received(logFile).some((m) => m.kind === 'state')), true, '窗口应收到初始状态')

    // 造一次真错误（轮以 error 结束）→ 红
    const session = { header: { id: 'ack-1', cwd: 'C:\\demo' } }
    ctx.emit('session/event', session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    ctx.emit('session/event', session, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } })
    assert.equal(await waitFor(() => states(logFile).includes('ERROR')), true, '应当先红')

    // 窗口那一条 setting 到了之后，插件必须把红色清掉，并推一条新 state
    assert.equal(await waitFor(() => logged.some((line) => line.includes('已清除错误状态'))), true, '应记录"收到确认"')
    const afterAck = () => {
      const list = states(logFile)
      const errorIndex = list.lastIndexOf('ERROR')
      return list.slice(errorIndex + 1).some((state) => state === 'IDLE' || state === 'WORKING' || state === 'THINKING')
    }
    assert.equal(await waitFor(afterAck), true, `确认之后必须离开 ERROR，实际序列 ${states(logFile).join(' → ')}`)

    // 确认不是配置项：既不落盘、也不产生 config.json（本测试全程没有别的 set 动作）
    assert.equal(existsSync(join(home, 'config.json')), false, '确认动作不该写配置文件')
    // 也不该在日志里出现"忽略未知设置项"
    assert.equal(logged.some((line) => line.includes('忽略未知设置项')), false, '确认键必须在白名单之前被识别')
  } finally {
    ctx.disposeAll()
    await sleep(120)
    if (previousHome === undefined) delete process.env.DSH_WORK_ICON_HOME
    else process.env.DSH_WORK_ICON_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
