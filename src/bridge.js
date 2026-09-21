/**
 * dsh-work-icon · 原生窗口子进程桥
 *
 * 职责单一：spawn 子进程、按行收发 JSON、维护 ready/pulse 两个定时器与优雅退出，
 * 以及——最重要的一条——**任何失败都只降级、只写日志，绝不把异常抛给 DSH 主进程**。
 *
 * 🚫 RED LINE（SPEC §10.3）：禁止自愈式重试 / 保活 / watchdog。
 * 子进程消失一律视为**人为终止**，绝不自动重启（本机事故：保活逻辑把人为关闭当成崩溃、
 * 连开三次窗口）。默认 `restartOnCrash=false` + `maxRestarts=0`，只有两个值都被显式
 * 打开才会重启；非 opt-in 路径只写一行"不重启"的日志。
 *
 * spawn 实现可注入（options.spawn），所以单测不需要真实窗口进程。
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { appendDiag } from './diag.js'
import {
  LineDecoder,
  MessageKind,
  createMessage,
  encodeMessage,
  isCapability,
  isKind,
} from './protocol.js'

export const DEFAULT_PULSE_INTERVAL_MS = 5000

// ── 可观测性常数（都是"限流"用的，避免诊断刷屏） ─────────────────────────────
/** 同一个跳过原因最多多久记一次（毫秒）。 */
export const SKIP_LOG_INTERVAL_MS = 60000
/** 没有任何消息发出的告警阈值下限：`max(3 × 心跳周期, 这个值)`。 */
export const GAP_WARN_MIN_MS = 15000
/** 事件循环滞后探针周期。 */
export const DEFAULT_PROBE_INTERVAL_MS = 1000
/** 滞后超过这个值才算"事件循环被卡住"。 */
export const DEFAULT_LAG_WARN_MS = 500
/** 滞后告警的限流间隔。 */
export const LAG_LOG_INTERVAL_MS = 30000
/** 诊断文件上限，超过就清空重写（诊断不该无限长）。 */
/** 诊断文件上限（单一来源在 diag.js，这里保留导出以免破坏既有引用）。 */
export { DIAG_MAX_BYTES } from './diag.js'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function noopLogger() {}

function normalizeLogger(logger) {
  const base = logger && typeof logger === 'object' ? logger : {}
  return {
    debug: typeof base.debug === 'function' ? base.debug.bind(base) : noopLogger,
    info: typeof base.info === 'function' ? base.info.bind(base) : noopLogger,
    warn: typeof base.warn === 'function' ? base.warn.bind(base) : noopLogger,
    error: typeof base.error === 'function' ? base.error.bind(base) : noopLogger,
  }
}

export class HelperBridge {
  /**
   * @param {object} options
   *   command / args / cwd / env         子进程启动方式（由 config.resolveHelperLaunch 给出）
   *   spawn                              注入的 spawn 实现（默认 node:child_process.spawn）
   *   pulseIntervalMs                    心跳周期（默认 5000；<=0 关闭）
   *   pulseProvider                      () => payload | null，每拍取一次新鲜载荷
   *   restartOnCrash / maxRestarts       自动重启：**默认关闭**，见下面 RED LINE 注释
   *   restartDelayMs / shutdownGraceMs
   *   onSetting / onReady / onClosed / onMessage  可选回调（全部被 try/catch 包住）
   */
  constructor(options = {}, logger = console) {
    this.options = options
    this.logger = normalizeLogger(logger)
    this.spawnImpl = typeof options.spawn === 'function' ? options.spawn : nodeSpawn
    /** 是否注入了 spawn 实现（注入时 command 只是传给对方的参数，不参与"能否启动"判断）。 */
    this.spawnInjected = typeof options.spawn === 'function'
    this.command = options.command || ''
    this.args = Array.isArray(options.args) ? options.args.map(String) : []
    this.cwd = options.cwd || undefined
    this.env = options.env && typeof options.env === 'object' ? options.env : {}

    this.pulseIntervalMs = Number.isFinite(options.pulseIntervalMs) ? options.pulseIntervalMs : DEFAULT_PULSE_INTERVAL_MS
    this.pulseProvider = typeof options.pulseProvider === 'function' ? options.pulseProvider : undefined
    /**
     * RED LINE（SPEC §10.3）：禁止自愈式重试 / 保活 / watchdog。
     * 进程消失 = 人为终止，不是崩溃，**绝不自动重启**。
     * 本机出过事故：启动脚本的保活逻辑把"人为关闭"当成崩溃、连开三次游戏窗口，
     * 用户只能自己动手关。因此这里**默认 false**，且必须同时把 restartOnCrash 显式设为 true
     * **且** maxRestarts ≥ 1 才会生效；只写一个不给重启。
     */
    this.restartOnCrash = options.restartOnCrash === true
    this.maxRestarts = Number.isFinite(options.maxRestarts) ? Math.max(0, Math.trunc(options.maxRestarts)) : 0
    this.restartEnabled = this.restartOnCrash && this.maxRestarts > 0
    this.restartDelayMs = Number.isFinite(options.restartDelayMs) ? Math.max(0, options.restartDelayMs) : 1500
    this.shutdownGraceMs = Number.isFinite(options.shutdownGraceMs) ? Math.max(0, options.shutdownGraceMs) : 500

    this.child = undefined
    this.decoder = new LineDecoder()
    this.ready = false
    this.disposed = false
    /** 窗口声明的能力（协议 v2）；老窗口不发 → 空集合 → 只发 v1 字段。 */
    this.capabilities = new Set()
    /** 窗口自称的协议版本（仅记录，用于日志）。 */
    this.windowProtocolVersion = undefined
    /** 窗口自己选了"退出"：不要再把它拉起来。 */
    this.restartSuppressed = false
    this.restartCount = 0
    this.spawnAttempts = 0

    this.pulseTimer = undefined
    this.restartTimer = undefined
    this.shutdownTimer = undefined
    /** 事件循环滞后探针（诊断用；只在 ready 后跑）。 */
    this.probeTimer = undefined
    this.probeExpectedAt = 0
    this.probeIntervalMs = Number.isFinite(options.probeIntervalMs) ? Math.max(0, options.probeIntervalMs) : DEFAULT_PROBE_INTERVAL_MS
    this.lagWarnMs = Number.isFinite(options.lagWarnMs) ? Math.max(0, options.lagWarnMs) : DEFAULT_LAG_WARN_MS
    this.lagLogAt = 0
    /** CPU 采样基准（`process.cpuUsage()` 的增量口径）。 */
    this.cpuMark = process.cpuUsage()
    this.cpuMarkAt = undefined
    /**
     * 诊断文件（宿主侧）。**必须落在用户读得到的地方** —— 2026-09-13 的事故里，
     * DSH 的 logger 一个字节都没落盘（`~/.dsh/logs/boot` 是 0 字节），
     * 于是"心跳为什么没发"只能靠窗口侧的 silence 反推。默认放在窗口 helper.log 旁边。
     */
    this.diagFile = typeof options.diagFile === 'string' && options.diagFile.trim() ? options.diagFile : undefined
    /** 跳过原因 → 上次记录时间（限流）。 */
    this.skipLogAt = new Map()
    /** 本次"静默期"是否已经告警过（一次静默只报一条）。 */
    this.gapWarned = false

    /** 未 ready 时先把消息扣住（同类消息只留最新一条），ready 后一次性补发。 */
    this.pending = new Map()
    this.stats = {
      sentMessages: 0,
      queuedMessages: 0,
      droppedMessages: 0,
      spawnFailures: 0,
      receivedMessages: 0,
      receivedLines: 0,
      invalidLines: 0,
      droppedOversize: 0,
      restarts: 0,
      /** 心跳相关计数（诊断"心跳为什么没发"） */
      beats: 0,
      skippedBeats: 0,
      lastSkipReason: undefined,
      /** 最近一次成功写出的时间戳；静默告警以它为基准。 */
      lastSentAt: 0,
      /** 事件循环观察到的最大滞后（毫秒）——"宿主被卡住"的直接证据。 */
      maxLagMs: 0,
      lagWarnings: 0,
      /** CPU 采样数量与最近一次采样（user/system 微秒 → 毫秒）。 */
      cpuSamples: 0,
      lastCpuSample: undefined,
      /** 伴随最近一条滞后告警的 CPU 采样（判定"被工作占住"还是"没被调度"看它）。 */
      lastLagCpuSample: undefined,
    }
  }

  isReady() {
    return this.ready === true
  }

  /** 当前时间（毫秒）。测试可替换它，确定性地验证心跳/静默判定。 */
  now() {
    return Date.now()
  }

  /**
   * 立刻拍一次心跳。定时器用它；**测试也用它**（否则要真等 5 秒才看得到一跳，
   * 而且未就绪时定时器根本不会启动）。与 `#beat()` 是同一个实现，不存在第二套逻辑。
   */
  beat() {
    this.#beat()
  }

  /** 开/关事件循环滞后探针。生产路径由 ready / dispose 管理；这里给测试与手工诊断用。 */
  startProbe() {
    this.#startProbe()
  }

  stopProbe() {
    this.#clearProbe()
  }

  /**
   * 窗口是否声明了某项能力（协议 v2 门控用）。
   * **没 ready 之前一律 false**：能力只在窗口的 `ready` 里声明，不能猜。
   */
  supports(capability) {
    return this.ready === true && this.capabilities.has(capability)
  }

  pid() {
    return this.child?.pid
  }

  isRunning() {
    return this.child !== undefined
  }

  /** 活跃定时器个数（测试用它断言 dispose 后不漏定时器）。 */
  pendingTimers() {
    return [this.pulseTimer, this.probeTimer, this.restartTimer, this.shutdownTimer].filter(Boolean).length
  }

  start() {
    if (this.child || this.disposed || this.restartSuppressed) return this.child
    // 没有可执行命令（自动解析没找到 Electron 运行时）→ 不 spawn，也不重试，只留痕。
    // 注：注入了 spawn 实现时不拦 —— 那时 command 只是传给对方的参数，由调用方负责。
    if (!this.command && !this.spawnInjected) {
      this.#fail('未配置可用的窗口运行时（helper.command 为空且未解析到插件内 Electron）')
      return undefined
    }
    this.spawnAttempts += 1

    let child
    try {
      child = this.spawnImpl(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      // spawn 同步抛出（命令不存在、cwd 非法……）：静默降级，图标不显示。
      this.#fail(`helper spawn threw: ${messageOf(error)}`)
      return undefined
    }

    if (!child || typeof child.on !== 'function') {
      this.#fail('helper spawn returned no child process')
      return undefined
    }

    this.child = child
    this.ready = false
    this.decoder = new LineDecoder()

    // 子进程死得比我们写完早时 stdin 会 EPIPE —— 必须吞掉，否则会冒泡成 uncaught。
    child.stdin?.on?.('error', () => {})
    child.stdout?.on?.('error', () => {})
    child.stderr?.on?.('error', () => {})

    child.stdout?.on?.('data', (chunk) => {
      try {
        const messages = this.decoder.push(chunk)
        // 解码器的计数是权威：把脏行/总行数同步到对外统计里。
        this.stats.receivedLines = this.decoder.receivedLines
        this.stats.invalidLines = this.decoder.invalidLines
        this.stats.droppedOversize = this.decoder.droppedOversize
        for (const message of messages) this.#handleMessage(message)
      } catch (error) {
        this.logger.warn(`dsh-work-icon: failed to read helper output: ${messageOf(error)}`)
      }
    })
    child.stderr?.on?.('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) this.logger.debug(`dsh-work-icon helper stderr: ${text.slice(0, 500)}`)
    })

    child.once('error', (error) => {
      this.#fail(`helper process error: ${messageOf(error)}`)
      if (this.child === child) this.child = undefined
      this.#scheduleRestart('spawn-error')
    })

    child.once('exit', (code, signal) => this.#handleExit(child, code, signal))

    return child
  }

  /** 发送一条消息。未 ready 先入队；编码失败只记日志。 */
  send(message) {
    let line
    try {
      line = encodeMessage(message)
    } catch (error) {
      this.stats.droppedMessages += 1
      this.logger.warn(`dsh-work-icon: refused to send an invalid message: ${messageOf(error)}`)
      return false
    }
    if (!this.ready || !this.child || this.child.stdin?.writable !== true) {
      this.#enqueue(message.kind, line)
      return false
    }
    return this.#write(line)
  }

  /** 只发状态（语法糖，给插件主体用）。 */
  sendState(payload) {
    return this.send(createMessage(MessageKind.STATE, payload))
  }

  /**
   * 优雅收尾：发 shutdown、关 stdin，宽限期后强杀，然后清掉所有定时器。
   * 幂等 —— 重复调用不会留下第二个定时器。
   */
  dispose(reason = 'plugin-disposed') {
    this.disposed = true
    this.restartSuppressed = true
    this.#clearPulse()
    this.#clearProbe()
    this.#clearRestartTimer()
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = undefined
    }

    const child = this.child
    if (!child) return

    try {
      if (this.ready && child.stdin?.writable === true) {
        this.#write(encodeMessage(createMessage(MessageKind.SHUTDOWN, { reason })))
        child.stdin.end()
      }
    } catch (error) {
      this.logger.debug(`dsh-work-icon: graceful shutdown write failed: ${messageOf(error)}`)
    }

    const graceMs = this.shutdownGraceMs
    const forceKill = () => {
      this.shutdownTimer = undefined
      if (this.child !== child) return
      try {
        child.kill()
      } catch (error) {
        this.logger.debug(`dsh-work-icon: helper kill failed: ${messageOf(error)}`)
      }
    }
    if (graceMs <= 0) forceKill()
    else {
      const timer = setTimeout(forceKill, graceMs)
      timer.unref?.()
      this.shutdownTimer = timer
    }
  }

  /** 立刻断开与子进程的关系（不 kill），主要给测试与异常路径用。 */
  detach() {
    this.#clearPulse()
    this.#clearProbe()
    this.#clearRestartTimer()
    const child = this.child
    this.child = undefined
    this.ready = false
    return child
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  #fail(reason) {
    this.stats.spawnFailures += 1
    this.logger.warn(`dsh-work-icon: ${reason} — 图标将不显示（宿主不受影响）`)
  }

  #handleMessage(message) {
    this.stats.receivedMessages += 1
    if (message.kind === MessageKind.READY) {
      if (this.ready) return
      this.ready = true
      // 协议 v2 能力协商：窗口在 ready 里声明它认识哪些扩展。
      // 认不出的条目直接忽略（前向兼容）；老窗口不发这个字段 → 能力集为空。
      this.capabilities = new Set()
      this.windowProtocolVersion = Number.isFinite(message.protocolVersion) ? message.protocolVersion : undefined
      if (Array.isArray(message.capabilities)) {
        for (const value of message.capabilities) {
          if (isCapability(value)) this.capabilities.add(value)
        }
      }
      this.logger.info(
        `dsh-work-icon: 窗口已就绪 (pid=${String(message.pid ?? this.child?.pid ?? 'unknown')}` +
        `, protocolVersion=${String(this.windowProtocolVersion ?? 'unknown')}` +
        `, capabilities=${this.capabilities.size > 0 ? [...this.capabilities].join(',') : '<无，按 v1 只发基础字段>'})`,
      )
      this.#flushPending()
      this.#startPulse()
      this.#startProbe()
      this.#safeCall('onReady', message)
      return
    }
    if (message.kind === MessageKind.SETTING) {
      this.#safeCall('onSetting', message)
      return
    }
    if (message.kind === MessageKind.CLOSED) {
      // 用户从菜单退出：保持关闭状态，直到宿主重启再回来。
      this.restartSuppressed = true
      this.#clearPulse()
      this.#clearProbe()
      this.logger.info(`dsh-work-icon: 窗口已退出 (${String(message.reason ?? 'user-closed')})`)
      this.#safeCall('onClosed', message)
      return
    }
    this.#safeCall('onMessage', message)
  }

  #safeCall(name, ...args) {
    const handler = this.options[name]
    if (typeof handler !== 'function') return
    try {
      handler(...args)
    } catch (error) {
      // 回调是插件主体给的，它炸了不能拖垮桥。
      this.logger.warn(`dsh-work-icon: ${name} callback failed: ${messageOf(error)}`)
    }
  }

  #enqueue(kind, line) {
    if (!isKind(kind)) return
    const maxPending = Number.isFinite(this.options.maxPendingMessages) ? this.options.maxPendingMessages : 64
    if (this.pending.has(kind)) {
      this.stats.droppedMessages += 1
      this.pending.delete(kind)
    } else if (this.pending.size >= maxPending) {
      const oldest = this.pending.keys().next().value
      this.pending.delete(oldest)
      this.stats.droppedMessages += 1
    }
    this.pending.set(kind, line)
    this.stats.queuedMessages += 1
  }

  #flushPending() {
    if (this.pending.size === 0) return
    const lines = [...this.pending.values()].join('')
    this.pending.clear()
    this.#write(lines)
  }

  #write(line) {
    const child = this.child
    if (!child || !line) return false
    const stdin = child.stdin
    if (!stdin || stdin.writable !== true || stdin.destroyed === true) return false
    try {
      stdin.write(line)
      this.stats.sentMessages += 1
      this.stats.lastSentAt = this.now()
      return true
    } catch (error) {
      this.stats.droppedMessages += 1
      this.logger.warn(`dsh-work-icon: helper write failed: ${messageOf(error)}`)
      return false
    }
  }

  #startPulse() {
    this.#clearPulse()
    if (!(this.pulseIntervalMs > 0)) {
      this.#diag(`心跳未启用：pulseIntervalMs=${this.pulseIntervalMs}（<=0 视为关闭）`)
      return
    }
    const timer = setInterval(() => this.#beat(), this.pulseIntervalMs)
    timer.unref?.()
    this.pulseTimer = timer
    this.stats.lastSentAt = this.now()
    this.#diag(`心跳已启动：每 ${this.pulseIntervalMs}ms 一次`)
  }

  /**
   * 心跳。**每一条早退都留痕**（限流）—— 2026-09-13 用户报"图标间歇性变空"时，
   * 这些 `return` 一行日志都不留，只能靠窗口侧的 silence 反推，排查被拖了一整轮。
   */
  #beat() {
    this.stats.beats += 1
    const now = this.now()
    if (this.disposed) return this.#skipBeat('disposed', now)
    if (!this.ready) return this.#skipBeat('window-not-ready', now)
    if (!this.child) return this.#skipBeat('no-child', now)
    let payload
    try {
      payload = this.pulseProvider ? this.pulseProvider() : undefined
    } catch (error) {
      this.logger.warn(`dsh-work-icon: pulse provider failed: ${messageOf(error)}`)
      return this.#skipBeat('provider-threw', now)
    }
    if (!payload || typeof payload !== 'object') return this.#skipBeat('empty-payload', now)
    const sent = this.send(createMessage(MessageKind.PULSE, payload))
    if (sent === false) this.#skipBeat('send-queued-or-refused', now)
    this.#checkSendGap(now)
  }

  /** 记一次"心跳没发出去"，带原因；同一原因限流，不刷屏。 */
  #skipBeat(reason, now) {
    this.stats.skippedBeats += 1
    this.stats.lastSkipReason = reason
    const last = this.skipLogAt.get(reason) ?? 0
    if (now - last < SKIP_LOG_INTERVAL_MS) return false
    this.skipLogAt.set(reason, now)
    const detail = `心跳未发：${reason}（累计跳过 ${this.stats.skippedBeats}/${this.stats.beats} 次，`
      + `ready=${String(this.ready)} child=${this.child ? 'yes' : 'no'} disposed=${String(this.disposed)}）`
    this.#diag(detail)
    this.logger.warn?.(`dsh-work-icon: ${detail}`)
    return true
  }

  /**
   * 静默告警：超过 `max(3 × 心跳周期, 15s)` 没有任何消息发出 → 记一条。
   * 一次静默只报一条（恢复发送后自动重置），这样日志里能直接看到"从几点到几点没发"。
   */
  #checkSendGap(now) {
    const threshold = Math.max(this.pulseIntervalMs * 3, GAP_WARN_MIN_MS)
    const gap = now - this.stats.lastSentAt
    if (gap <= threshold) {
      this.gapWarned = false
      return
    }
    if (this.gapWarned) return
    this.gapWarned = true
    const cpu = this.#sampleCpu()
    const detail = `静默告警：已有 ${Math.round(gap / 1000)}s 没有任何消息发出`
      + `（阈值 ${Math.round(threshold / 1000)}s，最后跳过原因=${this.stats.lastSkipReason ?? '无'}，`
      + `事件循环最大滞后=${this.stats.maxLagMs}ms；${this.#cpuDigest(cpu)}）`
    this.#diag(detail)
    this.logger.warn?.(`dsh-work-icon: ${detail}`)
  }

  /**
   * CPU 采样：`process.cpuUsage(上一次)` 给的是**增量**（微秒，user/system 分开）。
   *
   * 为什么必须和滞后一起记 —— 它把两类根因**分开**（修法完全不同）：
   *   滞后窗口里 CPU 烧掉一大截 ⇒ **被同步工作占住**（本插件或同进程里的别的插件）；
   *   滞后窗口里 CPU 几乎没动 ⇒ **进程根本没被调度 / 被挂起**（Windows 调度层 / 电源）。
   *
   * 采样的时间窗口 = 距上一次采样（探针正常时约一个 probeIntervalMs）。
   */
  #sampleCpu() {
    const now = this.now()
    const delta = process.cpuUsage(this.cpuMark)
    const wallMs = Math.max(0, now - (this.cpuMarkAt ?? now))
    this.cpuMark = process.cpuUsage()
    this.cpuMarkAt = now
    const cpuMs = (delta.user + delta.system) / 1000
    const ratio = wallMs > 0 ? cpuMs / wallMs : 0
    const verdict = ratio >= 0.5
      ? '被同步工作占住'
      : (ratio <= 0.1 ? 'CPU 几乎没动 → 进程没被调度/被挂起' : '混合')
    const sample = { cpuMs, userMs: delta.user / 1000, systemMs: delta.system / 1000, wallMs, ratio, verdict }
    this.stats.cpuSamples += 1
    this.stats.lastCpuSample = sample
    return sample
  }

  /** 把 CPU 采样拼成一行里的一段（滞后告警与静默告警共用同一份口径）。 */
  #cpuDigest(sample) {
    return `CPU user+system=${sample.cpuMs.toFixed(1)}ms / 墙钟 ${Math.round(sample.wallMs)}ms`
      + `（${(sample.ratio * 100).toFixed(0)}% ⇒ ${sample.verdict}）`
  }

  /**
   * 事件循环滞后探针：定时器**本该**何时醒 vs **实际**何时醒的差。
   *
   * 这是"宿主被卡住"唯一的直接证据 —— 心跳和状态消息共用同一个事件循环，
   * 一旦宿主被长时间占用，两者会**一起**停发，而窗口侧只能看到"没消息"。
   * 再加上同窗口的 CPU 增量，就能分清"被工作占住"还是"根本没被调度"。
   */
  #startProbe() {
    this.#clearProbe()
    if (!(this.probeIntervalMs > 0)) return
    this.probeExpectedAt = this.now() + this.probeIntervalMs
    const timer = setInterval(() => {
      const now = this.now()
      const lag = now - this.probeExpectedAt
      this.probeExpectedAt = now + this.probeIntervalMs
      const cpu = this.#sampleCpu()
      if (lag > this.stats.maxLagMs) this.stats.maxLagMs = lag
      if (lag < this.lagWarnMs) return
      if (now - this.lagLogAt < LAG_LOG_INTERVAL_MS) return
      this.lagLogAt = now
      this.stats.lagWarnings += 1
      /** 与这条告警**同一个采样窗口**的 CPU（不是"最近一次"，那样会被后续空闲采样冲掉）。 */
      this.stats.lastLagCpuSample = cpu
      const detail = `事件循环卡顿：定时器晚了 ${lag}ms（阈值 ${this.lagWarnMs}ms）——`
        + `宿主进程被占用这么久，心跳与状态消息在此期间都发不出去；`
        + this.#cpuDigest(cpu)
      this.#diag(detail)
      this.logger.warn?.(`dsh-work-icon: ${detail}`)
    }, this.probeIntervalMs)
    timer.unref?.()
    this.probeTimer = timer
  }

  #clearProbe() {
    if (this.probeTimer) clearInterval(this.probeTimer)
    this.probeTimer = undefined
  }

  /**
   * 写一行宿主侧诊断。**绝不影响图标本体**：任何失败都吞掉。
   * 同步追加（每 ≥60s 才有一次，代价可忽略），路径由 index.js 给（窗口 helper.log 旁边）。
   */
  #diag(line) {
    return appendDiag(this.diagFile, `[${new Date(this.now()).toISOString()}] ${line}`)
  }

  #clearPulse() {
    if (this.pulseTimer) clearInterval(this.pulseTimer)
    this.pulseTimer = undefined
  }

  #clearRestartTimer() {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
  }

  #handleExit(child, code, signal) {
    if (this.child !== child) return
    this.child = undefined
    const wasReady = this.ready
    this.ready = false
    this.#clearPulse()
    this.#clearProbe()
    this.#diag(`窗口进程退出 code=${String(code)} signal=${String(signal)}（心跳随之停止）`)
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = undefined
    }
    if (this.disposed || this.restartSuppressed) return
    this.logger.warn(`dsh-work-icon: 窗口进程退出 (code=${String(code)}, signal=${String(signal)})`)
    this.#scheduleRestart(wasReady ? 'exit' : 'exit-before-ready')
  }

  /**
   * RED LINE（SPEC §10.3）：默认什么都不做，只留一行日志。
   * 进程消失 = 人为终止，不是崩溃 —— 绝不能自作主张把它拉起来。
   * 只有显式 opt-in（restartOnCrash === true 且 maxRestarts ≥ 1）才会走到重启分支。
   */
  #scheduleRestart(reason) {
    if (this.disposed || this.restartSuppressed || this.restartTimer) return
    if (!this.restartEnabled) {
      this.logger.warn(
        `dsh-work-icon: 不重启窗口进程（进程消失=人为终止，不是崩溃；${reason}）。`
        + ' 如需自动重启必须显式同时设置 helper.restartOnCrash=true 与 helper.maxRestarts>=1',
      )
      return
    }
    if (this.restartCount >= this.maxRestarts) {
      this.restartSuppressed = true
      this.logger.warn(`dsh-work-icon: 已达显式配置的重启上限 ${this.maxRestarts} 次，停止（${reason}）`)
      return
    }
    this.restartCount += 1
    this.stats.restarts = this.restartCount
    const delay = this.restartDelayMs
    const timer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.disposed || this.restartSuppressed) return
      this.logger.info(`dsh-work-icon: 按显式配置重启窗口进程（第 ${this.restartCount}/${this.maxRestarts} 次）`)
      this.start()
    }, delay)
    timer.unref?.()
    this.restartTimer = timer
  }
}

export { normalizeLogger }
