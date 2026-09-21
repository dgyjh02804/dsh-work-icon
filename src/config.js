/**
 * dsh-work-icon · 落盘配置
 *
 * 路径：%USERPROFILE%\.dsh\work-icon\config.json（SPEC 第 7 节）
 * 写盘是原子的：先写同目录临时文件，再 rename 覆盖 —— 断电/崩溃不会留下半截 JSON。
 * 读盘永不抛异常：文件缺失、JSON 损坏、字段类型离谱，一律回退到默认值。
 *
 * 默认 enabled=false：装好插件不会自己弹窗，必须用户显式开启。
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件包根目录（默认 helper 的 cwd 基准）。 */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 随包窗口运行时的启动规格（窗口侧 README 的 spawn 规格，已逐字实跑过）：
 *   command = electron 可执行文件绝对路径
 *   args    = ['runtime/electron']（传目录，Electron 读该目录下 package.json.main）
 *   cwd     = 插件包根目录（含 runtime/ 与 src/ 的那一层）
 * 这里按平台列出候选，默认自动解析；用户在 config.json 里显式写 helper.command 可覆盖。
 */
export const ELECTRON_APP_DIR = 'runtime/electron'
export const ELECTRON_CANDIDATES = Object.freeze([
  join(PACKAGE_ROOT, 'runtime', 'electron', 'node_modules', 'electron', 'dist', 'electron.exe'),
  join(PACKAGE_ROOT, 'runtime', 'electron', 'node_modules', 'electron', 'dist', 'electron'),
  join(PACKAGE_ROOT, 'runtime', 'electron', 'node_modules', 'electron', 'dist', 'Electron.app',
    'Contents', 'MacOS', 'Electron'),
])

/** 默认 helper 启动方式：command 留空 = 自动解析插件内的 Electron 运行时。 */
export const DEFAULT_HELPER_COMMAND = ''
export const DEFAULT_HELPER_ARGS = Object.freeze([ELECTRON_APP_DIR])

export const DEFAULT_CONFIG = Object.freeze({
  /** 默认不启动：避免用户装完就被弹窗。 */
  enabled: false,
  /** SUCCESS 闪一下之后由宿主回落的检查周期。 */
  pollIntervalMs: 500,
  /** SPEC 第 5 节：心跳默认 5s。 */
  pulseIntervalMs: 5000,
  /** 窗口侧多久收不到消息才转 OFF。60s：模型长思考（20~40s 无事件）不得被误判为断开
   *  ——"事件静默"不等于"断开"（2026-09-13 实测：真图标日志里 pulse 停发导致 15s 误报）。 */
  windowTimeoutMs: 60000,
  /**
   * 子 Agent 的会话要不要参与状态取舍。
   * 默认 false，与随包发布的 cordis.patch.yml 显式保持一致：图标只反映顶层会话。
   */
  includeSubagents: false,
  /**
   * 错误红灯的三个时长（毫秒）——「粘性必须有出口」这句不变式的可调旋钮。
   *   errorTtlMs     轮级错误（turn 以 error 结束）红灯时长，默认 20s
   *   toolErrorTtlMs 工具级失败闪烁时长，默认 5s
   *   staleStickyMs  会话静默多久后不再以最高优先级占着聚合状态，默认 90s
   * 只影响观感，不影响正确性（出口一定存在）。仅宿主可读，**不在窗口的 setting 白名单里**。
   */
  errorTtlMs: 20000,
  toolErrorTtlMs: 5000,
  staleStickyMs: 90000,
  helper: {
    /** 空 = 自动解析插件内的 Electron 可执行文件（见 resolveHelperLaunch）。 */
    command: DEFAULT_HELPER_COMMAND,
    /** 空 = 用 [ELECTRON_APP_DIR]。 */
    args: [...DEFAULT_HELPER_ARGS],
    /** 空 = 用 PACKAGE_ROOT。 */
    cwd: '',
    env: {},
    /**
     * 🚫 SPEC §10.3 红线：禁止自愈式重试 / 保活 / watchdog。
     * 进程消失 = 人为终止，不是崩溃，**默认绝不自动重启**。
     * 要自动重启必须**同时**显式写 restartOnCrash: true 且 maxRestarts >= 1。
     */
    restartOnCrash: false,
    maxRestarts: 0,
    restartDelayMs: 1500,
    shutdownGraceMs: 500,
  },
  window: {
    /** 直径档位：96 / 140 / 200。 */
    scale: 140,
    /** 百分比：60 / 80 / 100。 */
    opacity: 100,
    alwaysOnTop: true,
    clickThrough: true,
    /** { x, y } 或 null（null = 窗口自己用默认右下角）。 */
    position: null,
    /** 窗口/图标比例，夹在 [1.0, 2.5]，默认 1.5（对齐窗口侧 DEFAULT_RATIO 与 README）。 */
    ratio: 1.5,
    /**
     * 帧率档：预设名（'saver' | 'standard' | 'smooth'）或对象 { power?, idle, thinking, waiting, working }。
     * 取值词汇表归窗口侧所有（它自己会校验），宿主只负责**原样保留**，不猜它的预设集合。
     */
    fps: 'standard',
    /** 面板底板不透明度（定稿 0.78）。夹在 [0, 1]。 */
    panelAlpha: 0.78,
    /**
     * 资源剖面：'eco' | 'standard' | 'smooth'（省电/标准/流畅）。
     *
     * 与 `fps` 的关系：**profile 是正名，fps 是兼容别名**，两者词汇不同：
     *   fps    : 'saver' | 'standard' | 'smooth'（窗口侧旧预设名）
     *   profile: 'eco'   | 'standard' | 'smooth'
     * 对应关系 `saver ↔ eco`（见 normalizeProfile，sanitizeConfig 里调用）：
     *   - 旧配置只写了 `fps` → 由它推导 `profile`，**旧配置不失效**；
     *   - 两者都在 → `profile` 优先（正名优先）；
     *   - `fps` 是自定义对象（无对应剖面名）→ `profile` 保持默认，`fps` 原样保留。
     * 落盘时 `fps` 会被镜像成 profile 的旧词汇，老窗口读到的仍是同一个档位。
     */
    profile: 'standard',
    /** 悬浮层底板：'on' = α≈panelAlpha 的薄板；'off' = 纯 HUD 无板。 */
    hoverPlate: 'on',
    /** 悬浮层那三行文字（状态/计划/进程）：'off' = **不画**（任务 B 默认）；'on' = 原样还原。 */
    hoverRows: 'off',
    /** 悬浮层那根 150px 横向计划进度条（`.v2bullet > .bs`）：'off' = **不画**（任务 C 默认，
     *  用户原话「我这个左上角的任务条也不要了，有环形的这样是多此一举」）；'on' = 原样还原。 */
    hoverBar: 'off',
    /** 面板详细度：'simple'（一行）/ 'columns'（多对话列表）/ 'tree'（含子代理树，默认）。 */
    panelDetail: 'tree',
    // ⚠️ 已废弃：曾有的 window.autostart（开机自启）已删除。
    // 图标是 DSH 的子进程，DSH 不起来它也起不来，"开机自启"逻辑上不成立，
    // 而且实现要写注册表。旧配置里残留的该键会被 sanitizeConfig 直接丢弃，不报错。
  },
})

/**
 * 双方共用的 `window` 配置键：宿主**必须原样保留**，窗口侧读/写同一批。
 * 契约锚点 = runtime/electron/main.js 的 cleanWindow()/DEFAULTS + 它的 README。
 * 测试拿这两个锚点做双向断言：窗口侧将来新增一个键，宿主侧测试立刻变红，
 * 逼着人来同步，而不是等用户发现"我写的值被抹了"。
 */
export const SHARED_WINDOW_KEYS = Object.freeze([
  'scale', 'opacity', 'alwaysOnTop', 'clickThrough', 'position', 'ratio', 'fps',
  'panelAlpha', 'profile', 'hoverPlate', 'hoverRows', 'hoverBar', 'panelDetail',
])

/** `profile` 正名取值（资源剖面）。 */
export const PROFILE_VALUES = Object.freeze(['eco', 'standard', 'smooth'])
/** `hoverPlate` 取值。 */
export const HOVER_PLATE_VALUES = Object.freeze(['on', 'off'])
/** `hoverRows` 取值（任务 B：'off' = 悬浮层那三行文字不画，**默认**；'on' = 原样还原回来）。 */
export const HOVER_ROWS_VALUES = Object.freeze(['on', 'off'])
/** `hoverBar` 取值（任务 C：'off' = 悬浮层那根 150px 横向计划进度条不画，**默认**；'on' = 原样还原回来）。 */
export const HOVER_BAR_VALUES = Object.freeze(['on', 'off'])
/** `panelDetail` 取值。 */
export const PANEL_DETAIL_VALUES = Object.freeze(['simple', 'columns', 'tree'])

/** 旧 `fps` 预设名 ↔ 新 `profile` 名（窗口侧 `saver` 就是现在的 `eco`）。 */
export const FPS_TO_PROFILE = Object.freeze({ saver: 'eco', eco: 'eco', standard: 'standard', smooth: 'smooth' })
export const PROFILE_TO_FPS = Object.freeze({ eco: 'saver', standard: 'standard', smooth: 'smooth' })

/** 枚举回落：非法值一律回默认（**不写进配置**，否则配置会坏）。 */
function oneOf(value, allowed, fallback) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return allowed.includes(text) ? text : fallback
}

/**
 * `profile` 归一化，并顺带处理旧键 `fps` 的兼容：
 *   - 正名 `profile` 合法 → 用它；
 *   - 正名缺失/非法 → 用旧键 `fps` 推导（`saver` → `eco`），救回旧配置；
 *   - 都没有/都不认识 → 回默认；
 *   - 返回值里的 `fps` 是要**镜像写回**的旧词汇（自定义对象则原样保留）。
 * @returns `{ profile, fps }`
 */
export function normalizeProfile(rawWindow, base) {
  const raw = isPlainObject(rawWindow) ? rawWindow : {}
  let profile = oneOf(raw.profile, PROFILE_VALUES, undefined)
  if (profile === undefined) {
    const legacy = FPS_TO_PROFILE[typeof raw.fps === 'string' ? raw.fps.trim().toLowerCase() : '']
    profile = legacy ?? base.window.profile
  }
  const fps = isPlainObject(raw.fps)
    ? fpsValue(raw.fps, base.window.fps)
    : (PROFILE_TO_FPS[profile] ?? base.window.fps)
  return { profile, fps }
}

/**
 * 历史豁免表：双方已同意删除、但窗口侧可能还没删干净的键。
 *
 * 语义刻意与 SHARED_WINDOW_KEYS 不同 —— 它**只做单向豁免**
 * （"窗口侧多出来的键必须是被显式豁免过的"），**绝不进双向相等的期望集**：
 * 期望集只认 SHARED_WINDOW_KEYS。把已删除的键塞进期望集，会在两边都删干净之后
 * 反而永远差一项（上一版就是这个 bug）。
 *
 * 当前为空：`autostart` 窗口侧与宿主侧都已彻底删除
 * （菜单项、配置键、DEFAULTS、cleanWindow、平铺合并列表、saveWindowPatch 全部清掉）。
 */
export const DROPPED_WINDOW_KEYS = Object.freeze([])

const SCALE_STEPS = Object.freeze([96, 140, 200])
const OPACITY_STEPS = Object.freeze([60, 80, 100])

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = clone(item)
    return out
  }
  return value
}

/** 默认值的深拷贝（每次调用都是新对象，调用方随便改）。 */
/** 旧版写进用户配置里的默认值：读取时把它当作"未设置"，让新默认生效。 */
export const LEGACY_WINDOW_TIMEOUT_MS = 15000

export function defaults() {
  return clone(DEFAULT_CONFIG)
}

/** 深合并：纯对象递归，数组和标量整体替换。patch 里的 undefined 不参与覆盖。 */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return clone(base)
  const out = isPlainObject(base) ? clone(base) : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? deepMerge(out[key], value)
      : clone(value)
  }
  return out
}

/**
 * 把配置解析成一份可 spawn 的启动规格。
 *
 * 顺序：
 *   1) `helper.command` 非空 → 完全照用户写的来（逃生口：换栈/换路径/指向别的窗口实现）
 *   2) 否则自动在**包内**解析 Electron 可执行文件（用户什么都不用配）
 *   3) 都没找到 → `ok:false`，调用方安静降级为"图标不显示"，不重试、不报错给用户
 *
 * 返回 `{ ok, command, args, cwd, source, reason? }`；`exists` / `candidates` 可注入，便于测试。
 */
export function resolveHelperLaunch(config = {}, { exists = existsSync, candidates = ELECTRON_CANDIDATES } = {}) {
  const safe = sanitizeConfig(config)
  const { command, args, cwd } = safe.helper
  const resolvedCwd = cwd || PACKAGE_ROOT
  const resolvedArgs = args.length > 0 ? args : [ELECTRON_APP_DIR]

  if (command) {
    return { ok: true, command, args: resolvedArgs, cwd: resolvedCwd, source: 'config' }
  }
  const found = candidates.find((candidate) => {
    try {
      return exists(candidate)
    } catch {
      return false
    }
  })
  if (!found) {
    return {
      ok: false,
      command: '',
      args: resolvedArgs,
      cwd: resolvedCwd,
      source: 'auto',
      reason: `未在包内找到 Electron 可执行文件（候选：${candidates.join(' | ')}）`,
    }
  }
  return { ok: true, command: found, args: resolvedArgs, cwd: resolvedCwd, source: 'auto' }
}

export function workIconDir({ env = process.env } = {}) {
  const override = env?.DSH_WORK_ICON_HOME
  if (typeof override === 'string' && override.trim()) return resolve(override.trim())
  const home = env?.USERPROFILE || env?.HOME || homedir()
  return join(home, '.dsh', 'work-icon')
}

export function configPath(options = {}) {
  return join(workIconDir(options), 'config.json')
}

export function logPath(options = {}) {
  return join(workIconDir(options), 'helper.log')
}

function number(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function boolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function position(value) {
  if (!isPlainObject(value)) return null
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

function nearestStep(value, steps, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return steps.reduce((best, step) => (Math.abs(step - parsed) < Math.abs(best - parsed) ? step : best), steps[0])
}

/** 连续量：非数字回退默认值，数字夹到 [min, max]。 */
function clampNumber(value, fallback, { min, max }) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/**
 * 帧率档：只做"形状"校验，**不校验预设词汇表**（那是窗口侧的所有权，
 * 它自己会用 cleanFps 兜底）。字符串按原样保留；对象只保留已知的数值子键。
 */
function fpsValue(value, fallback) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text && text.length <= 32 ? text : fallback
  }
  if (isPlainObject(value)) {
    const out = {}
    if (typeof value.power === 'string' && value.power.trim()) out.power = value.power.trim().slice(0, 32)
    for (const key of FPS_FRAME_KEYS) {
      const num = Number(value[key])
      if (Number.isFinite(num)) out[key] = Math.round(Math.min(240, Math.max(0, num)))
    }
    return Object.keys(out).length > 0 ? out : fallback
  }
  return fallback
}

const FPS_FRAME_KEYS = Object.freeze(['idle', 'thinking', 'waiting', 'working'])

/**
 * 把任意输入（文件内容 / 插件配置 / setting 消息）收敛成合法配置。
 * 未知字段被丢弃：配置文件是人手改得动的，不能让它塞进任意东西。
 */
export function sanitizeConfig(input = {}) {
  const raw = isPlainObject(input) ? input : {}
  const helper = isPlainObject(raw.helper) ? raw.helper : {}
  const window = isPlainObject(raw.window) ? raw.window : {}
  const base = defaults()
  const args = Array.isArray(helper.args)
    ? helper.args.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : undefined
  const env = {}
  if (isPlainObject(helper.env)) {
    for (const [key, value] of Object.entries(helper.env)) {
      if (typeof key === 'string' && key.trim() && value !== undefined && value !== null) env[key] = String(value)
    }
  }
  // fps ↔ profile 兼容归一（旧键能救正名；只算一次）。
  const profilePair = normalizeProfile(window, base)
  return {
    enabled: boolean(raw.enabled, base.enabled),
    pollIntervalMs: Math.round(number(raw.pollIntervalMs, base.pollIntervalMs, { min: 100, max: 60000 })),
    pulseIntervalMs: Math.round(number(raw.pulseIntervalMs, base.pulseIntervalMs, { min: 0, max: 600000 })),
    /* 迁移：早期版本把默认值 15000 写进了用户配置 ⇒ 那个值当"未设置"，改用当前默认；
       用户显式设过别的值（如 30000）⇒ 原样尊重，绝不越权覆盖。 */
    windowTimeoutMs: raw.windowTimeoutMs === LEGACY_WINDOW_TIMEOUT_MS
      ? base.windowTimeoutMs
      : Math.round(number(raw.windowTimeoutMs, base.windowTimeoutMs, { min: 1000, max: 600000 })),
    includeSubagents: boolean(raw.includeSubagents, base.includeSubagents),
    // 错误红灯时长：夹到合理区间，防止把出口做成"永不"（0 或负数一律回默认）。
    errorTtlMs: Math.round(number(raw.errorTtlMs, base.errorTtlMs, { min: 1000, max: 600000 })),
    toolErrorTtlMs: Math.round(number(raw.toolErrorTtlMs, base.toolErrorTtlMs, { min: 500, max: 600000 })),
    staleStickyMs: Math.round(number(raw.staleStickyMs, base.staleStickyMs, { min: 5000, max: 3600000 })),
    helper: {
      command: stringOr(helper.command, base.helper.command),
      args: args && args.length > 0 ? args : [...base.helper.args],
      cwd: stringOr(helper.cwd, ''),
      env,
      restartOnCrash: boolean(helper.restartOnCrash, base.helper.restartOnCrash),
      maxRestarts: Math.round(number(helper.maxRestarts, base.helper.maxRestarts, { min: 0, max: 50 })),
      restartDelayMs: Math.round(number(helper.restartDelayMs, base.helper.restartDelayMs, { min: 0, max: 60000 })),
      shutdownGraceMs: Math.round(number(helper.shutdownGraceMs, base.helper.shutdownGraceMs, { min: 0, max: 60000 })),
    },
    window: {
      scale: nearestStep(window.scale, SCALE_STEPS, base.window.scale),
      opacity: nearestStep(window.opacity, OPACITY_STEPS, base.window.opacity),
      alwaysOnTop: boolean(window.alwaysOnTop, base.window.alwaysOnTop),
      clickThrough: boolean(window.clickThrough, base.window.clickThrough),
      position: position(window.position),
      // 这两个键归窗口侧所有：宿主只做范围收敛与原样保留，绝不在保存时丢掉。
      ratio: clampNumber(window.ratio, base.window.ratio, { min: 1.0, max: 2.5 }),
      // fps ↔ profile 的兼容归一（旧键能救正名；正名缺失/非法都回默认）。
      fps: profilePair.fps,
      profile: profilePair.profile,
      // 面板相关：非法值一律回默认（**不写进配置**）。
      panelAlpha: clampNumber(window.panelAlpha, base.window.panelAlpha, { min: 0, max: 1 }),
      hoverPlate: oneOf(window.hoverPlate, HOVER_PLATE_VALUES, base.window.hoverPlate),
      hoverRows: oneOf(window.hoverRows, HOVER_ROWS_VALUES, base.window.hoverRows),
      hoverBar: oneOf(window.hoverBar, HOVER_BAR_VALUES, base.window.hoverBar),
      panelDetail: oneOf(window.panelDetail, PANEL_DETAIL_VALUES, base.window.panelDetail),
      // window.autostart 已废弃：这里不再输出该键，旧配置里的残留随之被丢掉。
    },
  }
}

/**
 * 读配置。任何异常都返回默认值（并把 defaults 与文件内容深合并后再收敛），
 * 绝不抛 —— 配置文件坏了不能连带把插件启动搞崩。
 */
export function loadConfig({ path, env = process.env, logger } = {}) {
  const file = path ?? configPath({ env })
  let text
  try {
    if (!existsSync(file)) return defaults()
    text = readFileSync(file, 'utf8')
  } catch (error) {
    logger?.warn?.(`dsh-work-icon: 读取配置失败，使用默认值 (${messageOf(error)})`)
    return defaults()
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    logger?.warn?.(`dsh-work-icon: 配置文件不是合法 JSON，回退到默认值 (${messageOf(error)})`)
    return defaults()
  }
  if (!isPlainObject(parsed)) {
    logger?.warn?.('dsh-work-icon: 配置文件顶层不是对象，回退到默认值')
    return defaults()
  }
  return deepMerge(defaults(), sanitizeConfig(parsed))
}

/**
 * 原子写：同目录临时文件 + fsync + rename。
 * 返回 { ok, error? }，不抛异常（调用方多是事件回调，抛出去会污染宿主）。
 *
 * **落盘留痕**（2026-09-13 加上）：每次真正写入都记一条"谁写的 / 改了哪些键 / 旧值→新值"。
 * 起因：用户明明勾着「跟随子代理」，图标却显示空闲 —— 事后发现顶层 `includeSubagents`
 * 被翻成 false，而**没有任何地方记得是谁写的**（宿主只有窗口 setting 这一条写路径，
 * 但日志里查不到那次写入）。以后它能一眼定位。
 *
 * @param options.origin   写入者标识（例如 `window-setting:includeSubagents`）
 * @param options.previous 写入前的配置快照（用来算"旧值→新值"）
 * @param options.logger   插件 logger（尽力而为）
 * @param options.diag     诊断文件写入函数（DSH 的 logger 本机不落盘，必须另外留痕）
 * @param options.now      时间源（测试可注入；同时用于限流）
 */
export function saveConfig(config, { path, env = process.env, fs = {}, origin = 'unknown', previous, logger, diag, now = Date.now } = {}) {
  const file = path ?? configPath({ env })
  const writeFile = fs.writeFileSync ?? writeFileSync
  const mkdir = fs.mkdirSync ?? mkdirSync
  const rename = fs.renameSync ?? renameSync
  const remove = fs.unlinkSync ?? unlinkSync
  const open = fs.openSync ?? openSync
  const fsync = fs.fsyncSync ?? fsyncSync
  const close = fs.closeSync ?? closeSync
  const temporary = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  try {
    mkdir(dirname(file), { recursive: true })
    /* 只持久化"用户真的改过"的键：把等于当前默认值的键剔掉。
       否则一旦默认值演进（例如 windowTimeoutMs 15s→60s），老配置会把旧默认永久钉住 ✗。 */
    const full = sanitizeConfig(config)
    const def = defaults()
    const changed = {}
    for (const k of Object.keys(full)) {
      if (JSON.stringify(full[k]) === JSON.stringify(def[k])) continue
      changed[k] = full[k]
    }
    const payload = `${JSON.stringify(changed, null, 2)}\n`
    writeFile(temporary, payload, 'utf8')
    // 尽量把数据真正刷到盘上再 rename，避免断电后出现"文件名对、内容空"。
    try {
      const fd = open(temporary, 'r+')
      try {
        fsync(fd)
      } finally {
        close(fd)
      }
    } catch {
      // 刷盘失败不影响 rename 的原子性，继续。
    }
    rename(temporary, file)
    logConfigWrite({ file, full, changed, previous, origin, logger, diag, now })
    return { ok: true, path: file }
  } catch (error) {
    try {
      remove(temporary)
    } catch {
      // 临时文件可能压根没创建成功。
    }
    return { ok: false, error, path: file }
  }
}

/**
 * 启动时合并两份配置：**插件行配置**（composition / bundle patch）与**用户持久化文件**。
 *
 * 规则（2026-09-13 修「跟随子代理每次重启被关掉」时定的口径）：
 *   1) 插件行配置里**写了非默认值**的键 ⇒ 以它为准（那是操作者的显式意图，例如 `enabled: true`）；
 *   2) 其余键（没写 / 写了但恰好等于插件默认值）⇒ 以**文件**为准。
 *
 * 为什么不能简单地 `deepMerge(fileConfig, pluginConfig)`（后者无条件覆盖前者 ✗）：
 *   `cordis.patch.yml` 挂载本插件时写的就是 `includeSubagents: false` —— 它**恰好等于**插件默认值，
 *   却把用户在文件里设的 `true` 覆盖掉 ⇒ 宿主每次重启都推 `false` ⇒ 勾选框被清空 ✗✗
 *   （用户报的正是这个；实测：文件 true + 全新启动 ⇒ 宿主推 false）。
 *   "是否显式"的判据 = 是否等于 `defaults()`（与窗口侧"缺失即 false"同一套默认值）。
 *
 * @returns `{ config, explicitKeys }` —— explicitKeys 供启动留痕（"哪些键是插件行说了算"）。
 */
export function mergeStartupConfig(fileConfig, pluginConfig, def = defaults()) {
  const fromFile = isPlainObject(fileConfig) ? fileConfig : {}
  const fromPlugin = isPlainObject(pluginConfig) ? pluginConfig : {}
  const merged = deepMerge(fromFile, {})
  const explicitKeys = []
  for (const [key, value] of Object.entries(fromPlugin)) {
    if (value === undefined) continue
    // 等于默认值 = 没表态（bundle patch 正是这样写默认的）；只有显式非默认值才算操作者意图。
    if (JSON.stringify(value) === JSON.stringify(def[key])) continue
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? deepMerge(merged[key], value)
      : clone(value)
    explicitKeys.push(key)
  }
  return { config: merged, explicitKeys }
}

/** 两次写入之间，**没有值变化**时的日志限流（有变化永远记，绝不吞掉真正的改动）。 */
export const SAVE_LOG_INTERVAL_MS = 5000
let lastQuietSaveLogAt = 0

/** 测试接缝：清掉限流状态（否则上一个用例的时间戳会污染下一个用例）。 */
export function resetSaveLogLimiter() {
  lastQuietSaveLogAt = 0
}

/** 值 → 便于阅读的短串。 */
function shortValue(value) {
  if (value === undefined) return '(未设置)'
  const text = JSON.stringify(value)
  return text !== undefined && text.length > 60 ? `${text.slice(0, 57)}…` : String(text)
}

/**
 * 组装并写出"配置已落盘"那一条留痕（logger + 诊断文件）。
 *
 * ⚠️ 差异要按**完整配置**算，不能只按"落盘键"算：
 * 一个键的值**变回默认值**时会被 `saveConfig` 省略、不进落盘集 ✗ —— 只按落盘键算差异的话，
 * `includeSubagents: true → false` 这种最该被看见的翻转会显示成"无变化" ✗✗。
 */
function logConfigWrite({ file, full, changed, previous, origin, logger, diag, now }) {
  const before = isPlainObject(previous) ? sanitizeConfig(previous) : undefined
  const diffs = []
  for (const key of Object.keys(full)) {
    if (before === undefined) {
      diffs.push(`${key}=${shortValue(full[key])}`)
    } else if (JSON.stringify(before[key]) !== JSON.stringify(full[key])) {
      diffs.push(`${key}: ${shortValue(before[key])} → ${shortValue(full[key])}`)
    }
  }
  // 没有值变化（例如只是把同一份内容再写一次）：限流，别刷屏
  if (diffs.length === 0) {
    const at = now()
    if (at - lastQuietSaveLogAt < SAVE_LOG_INTERVAL_MS) return false
    lastQuietSaveLogAt = at
  }
  const line = `配置已落盘：origin=${origin}；`
    + `变更=[${diffs.length > 0 ? diffs.join('; ') : '无（内容与上一次相同）'}]；`
    + `落盘键=[${Object.keys(changed).join(', ')}]；文件=${file}`
  try {
    logger?.info?.(`dsh-work-icon: ${line}`)
  } catch {
    /* 日志失败不影响落盘 */
  }
  try {
    diag?.(line)
  } catch {
    /* 诊断失败不影响落盘 */
  }
  return true
}

/** 窗口能改的 window.* 子键（与 SHARED_WINDOW_KEYS 同集合；autostart 已删除）。 */
export const SETTABLE_WINDOW_KEYS = Object.freeze([
  'scale', 'opacity', 'alwaysOnTop', 'clickThrough', 'position', 'ratio', 'fps',
  'panelAlpha', 'profile', 'hoverPlate', 'hoverRows', 'hoverBar', 'panelDetail',
])

/**
 * 每个可写键的值类型校验：类型不对就**整体拒绝**（返回 null），
 * 而不是交给 sanitizeConfig 悄悄回退默认值 —— 后者会让"设置没生效"看起来像"设置生效了"。
 *
 * 枚举类键（profile/hoverPlate/panelDetail）在这里就按枚举拒绝：
 * 窗口发来一个不认识的档位名，宁可拒绝也不要写进配置。
 */
const WINDOW_VALUE_RULES = Object.freeze({
  scale: (value) => Number.isFinite(value),
  opacity: (value) => Number.isFinite(value),
  ratio: (value) => typeof value === 'number' && Number.isFinite(value),
  alwaysOnTop: (value) => typeof value === 'boolean',
  clickThrough: (value) => typeof value === 'boolean',
  position: (value) => isPlainObject(value) && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)),
  fps: (value) => (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 32)
    || (isPlainObject(value) && Object.keys(value).length > 0),
  panelAlpha: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
  profile: (value) => typeof value === 'string' && PROFILE_VALUES.includes(value.trim().toLowerCase()),
  hoverPlate: (value) => typeof value === 'string' && HOVER_PLATE_VALUES.includes(value.trim().toLowerCase()),
  hoverRows: (value) => typeof value === 'string' && HOVER_ROWS_VALUES.includes(value.trim().toLowerCase()),
  hoverBar: (value) => typeof value === 'string' && HOVER_BAR_VALUES.includes(value.trim().toLowerCase()),
  panelDetail: (value) => typeof value === 'string' && PANEL_DETAIL_VALUES.includes(value.trim().toLowerCase()),
})

/**
 * 窗口能改的**顶层**键。只有这一个布尔键 —— 刻意不放开整个顶层：
 * 窗口是独立进程，`helper.command` / `enabled` / `pulseIntervalMs` 这类字段
 * 绝不能由它改写（否则一个坏掉/被替换的窗口就能改宿主行为或把插件关掉）。
 */
export const SETTABLE_TOP_LEVEL_KEYS = Object.freeze(['includeSubagents'])

/**
 * 把窗口右键菜单回传的 setting 应用到配置上。
 *
 * 白名单 = `window.*` 的 7 个子键（点号、扁平、下划线写法都认）+ 唯一的顶层键
 * `includeSubagents`。其余一律返回 null；每个键的值类型也在 WINDOW_VALUE_RULES 里
 * 逐个校验（类型不对整体拒绝，不做静默回退）。
 */
export function applySetting(config, key, value) {
  const name = String(key ?? '').trim()
  if (!name) return null
  const next = sanitizeConfig(config)

  // 点号写法：只接受 window.<白名单子键> 或顶层白名单键
  const dotted = name.includes('.') ? name.split('.') : null
  let path
  if (dotted) {
    path = dotted
  } else if (SETTABLE_TOP_LEVEL_KEYS.includes(name)) {
    path = [name]
  } else if (SETTABLE_WINDOW_KEYS.includes(name)) {
    path = ['window', name]
  } else {
    // 扁平别名（always_on_top / click_through 这类下划线写法）
    const snake = { always_on_top: 'alwaysOnTop', click_through: 'clickThrough' }
    path = snake[name] ? ['window', snake[name]] : null
  }
  if (!path) return null

  const allowedDotted = new Set([
    ...SETTABLE_WINDOW_KEYS.map((item) => `window.${item}`),
    ...SETTABLE_TOP_LEVEL_KEYS,
  ])
  if (!allowedDotted.has(path.join('.'))) return null
  // 唯一的顶层键是布尔开关：只认真布尔
  if (path.length === 1) {
    if (typeof value !== 'boolean') return null
  } else {
    const rule = WINDOW_VALUE_RULES[path.at(-1)]
    if (!rule || !rule(value)) return null
  }

  let cursor = next
  for (const part of path.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) return null
    cursor = cursor[part]
  }
  const leaf = path.at(-1)
  if (!(leaf in cursor)) return null
  cursor[leaf] = value

  // ── fps ↔ profile 双向同步 ─────────────────────────────────────────────
  // 两个方向都要管，否则旧窗口发来的 `window.fps` 会被"正名优先"直接吃掉：
  // 宿主内存里 profile 一直是materialized 的，只写 fps 时 sanitize 会用 profile 覆盖它。
  if (path.length === 2 && path[0] === 'window') {
    if (leaf === 'fps' && typeof value === 'string') {
      const mapped = FPS_TO_PROFILE[value.trim().toLowerCase()]
      if (mapped) next.window.profile = mapped
    }
    if (leaf === 'profile') {
      const mirrored = PROFILE_TO_FPS[next.window.profile]
      if (mirrored) next.window.fps = mirrored
    }
  }
  return sanitizeConfig(next)
}

/**
 * SPEC 第 5 节 config 消息的载荷：冻结的 5 个窗口字段，**外加 v2 的 `includeSubagents`**。
 *
 * 为什么补这一个（2026-09-13 用户报的 bug）：窗口的「跟随子代理」勾选态原来**只在启动时
 * 从 config.json 读一次**，而这条 config 消息不带该键 ⇒ 之后任何一侧改了值，勾选态永远是旧的 ✗
 * （用户明明勾着、图标却显示空闲）。
 * 窗口侧已经明写"宿主日后把该键加进回发，两条路都认（消息优先，没带才读盘）"
 * （`runtime/electron/main.js:653-660`）⇒ 补上它，两条路就都通了。
 * 其余冻结字段一个不动，顺序也不变。
 */
export function configMessagePayload(config) {
  const safe = sanitizeConfig(config)
  return {
    scale: safe.window.scale,
    opacity: safe.window.opacity,
    alwaysOnTop: safe.window.alwaysOnTop,
    clickThrough: safe.window.clickThrough,
    position: safe.window.position,
    includeSubagents: safe.includeSubagents === true,
  }
}

export { SCALE_STEPS, OPACITY_STEPS, isPlainObject, messageOf }
