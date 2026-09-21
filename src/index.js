/**
 * dsh-work-icon · Cordis 插件入口（宿主侧）
 *
 * 装配：配置 → 归约器 → 桥 → 会话事件订阅。
 * 所有副作用（子进程、定时器、事件监听）都挂在 ctx.effect 的 disposer 上，
 * 插件被卸载/重载时不会漏进程、不会漏监听。
 */

import { join, dirname } from 'node:path'

import {
  applySetting,
  configMessagePayload,
  configPath,
  loadConfig,
  mergeStartupConfig,
  resolveHelperLaunch,
  sanitizeConfig,
  saveConfig,
} from './config.js'
import { HelperBridge } from './bridge.js'
import { appendDiag } from './diag.js'
import { CostLedger } from './cost.js'
import { DEFAULT_SUCCESS_TTL_MS, WorkIconReducer } from './reducer.js'
import { Capability, MessageKind, WorkState, createMessage } from './protocol.js'
import { textSignature } from './text.js'

export const name = 'dsh-work-icon'
/** 只依赖会话总线；配置走自己的文件，不碰 settings 服务。 */
export const inject = ['sessions']

/**
 * 「人处理了 → 清除错误」的设置键。
 *
 * 这是**错误红灯的第三个出口**（另两个是 TTL 到期、下一轮/用户开口）：
 * 窗口侧「点击图标」或右键菜单「清除错误状态」发一条
 * `setting {key:'work-icon.clearError'}` 即可（值被忽略）。
 * 它不走配置白名单、不落盘 —— 只清当前所有会话的粘性 ERROR。
 */
export const CLEAR_ERROR_KEYS = Object.freeze(['work-icon.clearError', 'error.clear'])

/**
 * 文本节流：实测推理增量 152 块/秒、均值 3 字符 —— 原样转发会每秒唤醒窗口 152 次。
 * ≤6 Hz（160ms）且"可见尾串变化才发"，是调研给出的硬参数。
 */
export const TEXT_THROTTLE_MS = 160
/** 花费刷新节奏：账本是追加写的，增量读很便宜，1 Hz 足够；变化才重推 state。 */
export const COST_REFRESH_MS = 1000

export { HelperBridge, WorkIconReducer }

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function loggerOf(ctx) {
  const logger = ctx?.logger
  if (!logger) return console
  return logger
}

/**
 * 订阅会话总线。DSH 的 loader 条目可能挂在一个 scoped composition 里，
 * 所以优先用 root bus（{ global: true }）；老版本不支持该选项时退回普通订阅。
 */
function subscribe(ctx, type, handler) {
  try {
    const off = ctx.on(type, handler, { global: true })
    if (typeof off === 'function') return off
  } catch {
    // 该版本不认识 global 选项，走下面的普通订阅。
  }
  const off = ctx.on(type, handler)
  return typeof off === 'function' ? off : () => {}
}

/**
 * 读可选的 `agents` 服务（AgentRegistry：get(id) / list()）。
 * 刻意用 ctx.get 而不是 inject：agents 只是"锦上添花的权威信号"，
 * 拿不到时纯靠会话事件推断照样能工作，不该让整块插件停在等待态。
 */
function readAgentsService(ctx, logger) {
  try {
    const agents = ctx?.get?.('agents')
    if (agents && typeof agents.list === 'function') return agents
    return undefined
  } catch (error) {
    logger.warn?.(`dsh-work-icon: 读取 agents 服务失败，改用纯事件推断：${messageOf(error)}`)
    return undefined
  }
}

export function apply(ctx, config = {}) {
  const logger = loggerOf(ctx)
  try {
    mount(ctx, config, logger)
  } catch (error) {
    // DSH 把插件激活失败当成整个启动失败。宿主 API 变了只该让图标消失，
    // 不该让 DSH 起不来。
    logger.error?.(`dsh-work-icon 激活失败，本次会话保持关闭：${messageOf(error)}`)
  }
}

/** 子代理名册（listDescendants）的刷新间隔：名字变化很慢，别拿异步枚举压宿主。 */
export const SUBAGENT_ROSTER_REFRESH_MS = 5000

function mount(ctx, config, logger) {
  const pluginConfig = config && typeof config === 'object' ? config : {}
  const fileConfig = loadConfig({ logger })
  /**
   * ⚠️ 不能写 `deepMerge(fileConfig, pluginConfig)`（插件行无条件覆盖文件 ✗）：
   * 本插件的 bundle patch 里写着 `includeSubagents: false`（= 插件默认值），
   * 那样会把用户在 `config.json` 里设的 `true` 覆盖掉 ⇒ 「跟随子代理」每次重启被清空 ✗
   * （2026-09-13 用户报的 bug，已实测复现）。口径见 mergeStartupConfig 的注释。
   */
  const startup = mergeStartupConfig(fileConfig, pluginConfig)
  let current = sanitizeConfig(startup.config)

  /**
   * 宿主侧诊断文件（与窗口的 helper.log 同目录）。心跳告警、配置落盘留痕、启动口径
   * 三处共用它 —— DSH 本机的 logger 不落盘，宿主侧的事必须自己写文件才查得到。
   * 设 `DSH_WORK_ICON_DIAG=0` 可整体关掉。
   */
  const diagFile = process.env.DSH_WORK_ICON_DIAG === '0'
    ? undefined
    : join(dirname(configPath({ env: process.env })), 'host.log')

  // 启动留痕：一眼看出"用户设的 includeSubagents 有没有被插件行配置覆盖"。
  // 2026-09-13 那次排查就缺这一行 —— 文件是 true、宿主却推 false，日志里两条都不留。
  appendDiag(diagFile, `[${new Date().toISOString()}] 启动配置：includeSubagents=${String(current.includeSubagents)}`
    + `（来源=${startup.explicitKeys.includes('includeSubagents') ? '插件行配置' : '用户文件/默认值'}）`
    + `；插件行显式覆盖的键=[${startup.explicitKeys.join(', ')}]`)

  if (current.enabled !== true) {
    logger.info?.('dsh-work-icon: 未启用（config.enabled=false），图标不启动')
    return
  }

  const reducer = new WorkIconReducer({
    includeSubagents: current.includeSubagents === true,
    successTtlMs: DEFAULT_SUCCESS_TTL_MS,
    // 红灯时长可配（默认 20s / 5s / 90s）；出口一定存在，这几项只调时长。
    errorTtlMs: current.errorTtlMs,
    toolErrorTtlMs: current.toolErrorTtlMs,
    staleStickyMs: current.staleStickyMs,
  })

  let bridge
  const dispatch = (messages) => {
    for (const message of messages) bridge.send(message)
  }

  /**
   * agent 状态对账：窗口侧 setting 可能来得比它早（假 helper 一 ready 就发），
   * 所以先给一个空实现占位，真正实现在下面赋值，避免 TDZ。
   */
  let reconcileAgents = () => {}
  /** 同样的原因：onReady 在 start() 之后异步触发，这里先占位。 */
  let refreshCost = () => {}

  const persistSetting = (message) => {
    // 「清除错误状态」在人处理错误的语义上**先于**配置白名单：
    // 它不是配置项、不该落盘，更不能因为不在白名单里被拒。
    if (CLEAR_ERROR_KEYS.includes(String(message?.key ?? ''))) {
      dispatch(reducer.acknowledgeError())
      logger.info?.('dsh-work-icon: 收到确认，已清除错误状态')
      return
    }
    const next = applySetting(current, message.key, message.value)
    if (!next) {
      logger.warn?.(`dsh-work-icon: 忽略未知设置项 ${String(message.key)}`)
      return
    }
    const previous = current
    current = next
    // 落盘留痕：写清"谁写的 / 改了哪些键 / 旧值→新值"（窗口 setting 是宿主唯一的写路径）。
    const result = saveConfig(current, {
      origin: `window-setting:${String(message?.key ?? '?')}=${JSON.stringify(message?.value)}`,
      previous,
      logger,
      diag: (line) => appendDiag(diagFile, line),
    })
    if (!result.ok) {
      logger.warn?.(`dsh-work-icon: 设置持久化失败 (${messageOf(result.error)})`)
    }

    // 子 Agent 开关要**立即生效**，不能等宿主重启：
    // 打开后归约器从下一条子代理事件（或下一轮 agent/status 对账）起就纳入竞争；
    // 关闭时当场把已记录的子代理会话移除，重新按主会话渲染。
    if (current.includeSubagents !== previous.includeSubagents) {
      logger.info?.(`dsh-work-icon: includeSubagents -> ${current.includeSubagents}（即时生效，无需重启宿主）`)
      dispatch(reducer.setIncludeSubagents(current.includeSubagents))
      // 打开开关时立刻对一次账：正在跑的子代理会话马上进入竞争，
      // 不用等它下一条事件（也不用等 500ms 的 sweeper）。
      if (current.includeSubagents) reconcileAgents()
    }

    // 尺寸/透明度/位置这类变化要立刻下发，而不是等下次重启。
    bridge.send(createMessage(MessageKind.CONFIG, configMessagePayload(current)))
  }

  // 启动方式默认自动解析到包内的 Electron 运行时；解析不到就安静降级（图标不显示、不重试）。
  const launch = resolveHelperLaunch(current)
  if (!launch.ok) {
    logger.warn?.(`dsh-work-icon: ${launch.reason}；图标将不显示（宿主不受影响）`)
  }

  bridge = new HelperBridge({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: current.helper.env,
    pulseIntervalMs: current.pulseIntervalMs,
    restartOnCrash: current.helper.restartOnCrash,
    maxRestarts: current.helper.maxRestarts,
    restartDelayMs: current.helper.restartDelayMs,
    shutdownGraceMs: current.helper.shutdownGraceMs,
    pulseProvider: () => reducer.pulsePayload(),
    /**
     * 宿主侧诊断文件：**与窗口的 helper.log 放在同一个目录**，这样"心跳/静默/谁改了配置"这类
     * 只有宿主知道的事，用户和窗口侧都能直接读（2026-09-13 事故里 DSH 的 logger
     * 一个字节都没落盘，排查只能靠窗口侧反推）。设 DSH_WORK_ICON_DIAG=0 可关掉。
     * 注意：`diagFile` 是**同一个变量**被心跳与配置留痕共用（单一来源，别各算一份）。
     */
    diagFile,
    onSetting: (message) => {
      try {
        persistSetting(message)
      } catch (error) {
        logger.warn?.(`dsh-work-icon: 处理窗口设置回传失败：${messageOf(error)}`)
      }
    },
    onClosed: () => {
      logger.info?.('dsh-work-icon: 窗口已由用户关闭，本次宿主运行内不再拉起')
    },
    onReady: () => {
      // 协议 v2 能力协商：把窗口声明的能力交给归约器，由它决定 state 里带不带新字段。
      // 老窗口（不发 capabilities）→ 空集合 → 字节与 v1 完全一致。
      reducer.setCapabilities(bridge.capabilities)
      logger.info?.(
        `dsh-work-icon: 协商结果 capabilities={${[...bridge.capabilities].join(',')} || '空'}`
        + `；本轮将 ${reducer.supports(Capability.TEXT) ? '启用' : '不启用'}流式文本`,
      )
      // 窗口刚起来时立刻拉一次账本，别让花费等下一个 1s 周期。
      refreshCost(true)
    },
  }, logger)

  // ── 协议 v2：花费读取器 + 文本节流器 ──────────────────────────────────
  //
  // 花费**只做求和**：读 dsh-bottom-info-bar 自己写下的 `cost` 字段（它按价目表算好的），
  // 宿主绝不估算、绝不换汇、绝不猜模型单价 —— 拿不到就明确降级为"只有 tokens"。
  const ledger = new CostLedger({ logger })
  let lastCostKey
  const costKey = (payload) => (payload === undefined ? '' : `${payload.status}|${JSON.stringify(payload.cost ?? null)}|${payload.priced ?? ''}|${payload.unpriced ?? ''}`)

  refreshCost = (force = false) => {
    // 老窗口没声明 cost 能力：连账本都不读（省 I/O，也避免无意义的状态抖动）。
    if (!reducer.supports(Capability.COST)) return
    let payload
    try {
      ledger.refresh()
      // ⚠️ **可相加的量才总计**：花费跨**全部会话**求和（每个会话含它的后代子代理）。
      //    修复前这里用的是 `reducer.sessionIdsFor(reducer.snapshot().sessionId)` ——
      //    只有**焦点会话**那一棵子树，于是图标显示谁就报谁的花费
      //    （实测：两会话轮流干活时在 1.23 / 4.56 之间来回跳，用户说的"价格统计也会抢夺"）。
      const sessionIds = reducer.costSessionIds()
      const total = ledger.total(sessionIds)
      payload = total.status === 'ok'
        ? {
            status: 'ok',
            cost: total.cost,
            priced: total.priced,
            unpriced: total.unpriced,
            partial: total.partial === true ? true : undefined,
            pricingVersion: total.pricingVersion,
          }
        : { status: total.status, reason: total.reason, records: total.records, unpriced: total.unpriced }
    } catch (error) {
      // 账本是别的插件的私有文件：任何意外都只降级，绝不影响图标。
      logger.warn?.(`dsh-work-icon: 读取花费账本失败，降级为只显示 tokens：${messageOf(error)}`)
      payload = { status: 'unavailable', reason: 'read-failed' }
    }
    const key = costKey(payload)
    if (!force && key === lastCostKey) return
    const previousKey = lastCostKey
    lastCostKey = key
    if (reducer.setCost(payload)) {
      // 花费变了但工作状态没变：显式重推一次 state（它不在事件签名里）。
      dispatch([reducer.currentStateMessage()])
    } else if (previousKey === undefined) {
      dispatch([reducer.currentStateMessage()])
    }
  }

  // 文本节流：每 160ms 看一次"可见尾串有没有变"，变了才发一条 text。
  // 事件路径只往环形缓冲里 append（O(1)），序列化只发生在这里。
  let textRevision = 0
  let lastTextSignature
  const textTimer = setInterval(() => {
    try {
      if (!bridge.isReady() || !reducer.supports(Capability.TEXT)) return
      const payload = reducer.textSnapshot()
      const signature = payload === undefined ? '' : textSignature(payload)
      if (signature === lastTextSignature) return
      lastTextSignature = signature
      textRevision += 1
      bridge.send(createMessage(MessageKind.TEXT, {
        revision: textRevision,
        ...(payload ?? { activityText: undefined, thoughtTail: undefined, bodyTail: undefined }),
      }))
    } catch (error) {
      logger.warn?.(`dsh-work-icon: 发送流式文本失败：${messageOf(error)}`)
    }
  }, TEXT_THROTTLE_MS)
  textTimer.unref?.()

  const costTimer = setInterval(() => refreshCost(), COST_REFRESH_MS)
  costTimer.unref?.()

  // 顺序刻意如此：先摆好初始状态与窗口配置，再 start()。
  // 桥在 ready 之前把它们扣在队列里，ready 之后一次性补发。
  dispatch(reducer.initialMessages())
  bridge.send(createMessage(MessageKind.CONFIG, configMessagePayload(current)))
  bridge.start()

  const onSessionEvent = (session, event) => {
    try {
      dispatch(reducer.handle(session, event))
    } catch (error) {
      // 会话总线上的监听器抛异常会影响别的订阅者：必须就地吞掉。
      logger.error?.(`dsh-work-icon: 归约会话事件失败：${messageOf(error)}`)
    }
  }

  const onSessionDisposed = (session) => {
    try {
      dispatch(reducer.disposeSession(session))
    } catch (error) {
      logger.error?.(`dsh-work-icon: 处理会话回收失败：${messageOf(error)}`)
    }
  }

  // `agent/status` 是官方粗粒度信号（payload.agent / payload.status：'idle' | 'running'）：
  // 用来校正/兜底事件推断，但不接管细粒度判断（见 reducer.handleAgentStatus 的注释）。
  const onAgentStatus = (payload) => {
    try {
      const agent = payload?.agent
      const session = agent?.session
      if (!session) return
      dispatch(reducer.handleAgentStatus(session, payload?.status))
    } catch (error) {
      logger.warn?.(`dsh-work-icon: 处理 agent/status 失败：${messageOf(error)}`)
    }
  }

  // 可选服务，不写进 inject：拿不到就纯靠事件推断，一样能用。
  const agents = readAgentsService(ctx, logger)

  /**
   * 子代理名字名册（**限流刷新**，复用上面的 sweeper，不新起一套机制）。
   *
   * 为什么必须走官方枚举：`subagent/descriptor` 是 model-hidden 的 log-only 事件，
   * 生产里收不到（实测载荷里 mode/label 双缺 ⇒ 面板显示"(未命名)"）；
   * `ctx.subagents.listDescendants()` 会把 descriptor 折出来并给出 label
   * （`list-children.d.ts:45-52`）。拿不到或只给 diagnostic 就**留空**，绝不编名字。
   */
  let rosterRefreshAt = 0
  const enrichSubagentRoster = () => {
    const now = Date.now()
    if (now - rosterRefreshAt < SUBAGENT_ROSTER_REFRESH_MS) return
    rosterRefreshAt = now
    let runtime
    try {
      runtime = ctx.get?.('subagents')
    } catch {
      runtime = undefined
    }
    if (!runtime || typeof runtime.listDescendants !== 'function') return
    const roots = reducer.mainSessionsSnapshot({ limit: 8 }).items.map((row) => row.id)
    for (const rootId of roots) {
      try {
        const pending = runtime.listDescendants(rootId)
        if (!pending || typeof pending.then !== 'function') continue
        pending.then((entries) => {
          if (reducer.applySubagentRoster(entries)) dispatch([reducer.currentStateMessage()])
        }).catch(() => { /* 枚举失败就保持空态，不重试、不刷屏 */ })
      } catch {
        /* 安静降级：名字是锦上添花，绝不影响图标 */
      }
    }
  }
  reconcileAgents = () => {
    if (!agents) return
    let list
    try {
      list = agents.list?.()
    } catch (error) {
      logger.warn?.(`dsh-work-icon: 读取 agent 列表失败：${messageOf(error)}`)
      return
    }
    if (!Array.isArray(list)) return
    for (const agent of list) {
      if (!agent?.session) continue
      try {
        dispatch(reducer.handleAgentStatus(agent.session, agent.status))
      } catch (error) {
        logger.warn?.(`dsh-work-icon: 校正 agent 状态失败：${messageOf(error)}`)
      }
    }
  }

  // SUCCESS → IDLE 的 2.5s 回落、心跳之外的状态刷新，以及 agent 状态兜底对账。
  const sweeper = setInterval(() => {
    try {
      dispatch(reducer.tick())
    } catch (error) {
      logger.warn?.(`dsh-work-icon: 状态刷新失败：${messageOf(error)}`)
    }
    reconcileAgents()
    enrichSubagentRoster()
  }, Math.max(100, current.pollIntervalMs))
  sweeper.unref?.()

  let offEvent = () => {}
  let offDisposed = () => {}
  let offAgentStatus = () => {}
  const teardown = () => {
    // disposer 里不能抛：否则 Cordis 卸载流程会中断，进程就漏了。
    for (const timer of [sweeper, textTimer, costTimer]) {
      try {
        clearInterval(timer)
      } catch {
        // 忽略
      }
    }
    for (const [label, off] of [['session/event', offEvent], ['session/disposed', offDisposed], ['agent/status', offAgentStatus]]) {
      try {
        off()
      } catch (error) {
        logger.warn?.(`dsh-work-icon: 解除 ${label} 订阅失败：${messageOf(error)}`)
      }
    }
    try {
      bridge.dispose('host-stop')
    } catch (error) {
      logger.error?.(`dsh-work-icon: 关闭窗口桥失败：${messageOf(error)}`)
    }
  }

  // 下面每一步都在子进程已经拉起来之后执行：任何一步失败都必须先把进程收掉再往外抛，
  // 否则 apply() 吞掉异常之后，这里会留下一个没人管的窗口进程。
  try {
    offEvent = subscribe(ctx, 'session/event', onSessionEvent)
    offDisposed = subscribe(ctx, 'session/disposed', onSessionDisposed)
    offAgentStatus = subscribe(ctx, 'agent/status', onAgentStatus)
    // 插件启动时先对一次账：已经在跑的 agent 立刻亮起来，不用等下一个事件。
    reconcileAgents()
    ctx.effect(() => teardown)
  } catch (error) {
    teardown()
    throw error
  }

  logger.info?.(`dsh-work-icon: 已启动（运行时=${launch.command || '<未解析>'} ${launch.args.join(' ')}，cwd=${launch.cwd}，source=${launch.source}）`)
}

export { WorkState, MessageKind }
