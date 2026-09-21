'use strict'
/* ==========================================================================
   dsh-work-icon · Electron 原生窗口运行时（H2「等离云核」）
   事实来源：docs/SPEC-H2.md（第 2/3/4 节视觉、第 5 节协议、第 6 节交互、第 7 节落盘、第 9 节实现要点）
   起点    ：temp4/spike/electron（透明/置顶/点击穿透/位置记忆已跑通的原型，未推倒重来）

   进程角色：宿主 Node 进程 spawn 本进程；stdin/stdout = newline-delimited JSON。
   本文件只管：窗口 + 生命周期 + stdio 协议 + 菜单 + 落盘 + 穿透判定。
   视觉（七态几何/配色/动效）全在 index.html，沿用 hybrid.html 的 base-h2。

   ⚠ stdout 是协议通道：任何非 JSON 输出都会污染协议。日志一律走 stderr + helper.log。
   ========================================================================== */
const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')

const HERE = __dirname
const PROC_T0 = Date.now()

/* ------------------------------------------------------------------ 参数 */
const argv = process.argv.slice(2)
function arg (name, def) {
  const i = argv.indexOf('--' + name)
  if (i < 0) return def
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const FLAG = (n) => argv.includes('--' + n)
const NUM = (n, d) => { const v = Number(arg(n, NaN)); return Number.isFinite(v) ? v : d }

const OPT = {
  state: String(arg('state', 'IDLE')).toUpperCase(),
  hidden: FLAG('hidden'),
  show: FLAG('show'),
  shot: arg('shot', null),                       // 黄金样本/像素比对模式：svg 盒子尺寸(px)
  bg: String(arg('bg', 'none')),                 // none | dark | white
  out: arg('out', null),                         // 抓图输出路径
  exitAfter: NUM('exit-after', 0),               // 秒
  grabAt: NUM('grab-at', 0.7),                   // 秒，抓图时刻
  scale: NUM('scale', 0),
  ratio: NUM('ratio', 0),
  fps: arg('fps', ''),
  spin: NUM('spin', -1),
  hide: arg('hide', ''),
  logFile: arg('log', ''),
  home: arg('home', ''),
  windowTimeoutMs: NUM('window-timeout', 60000),   /* 60s：模型长思考（20~40s 无事件）不得被误判为断开；"事件静默"≠"断开" */
  metricsInterval: NUM('metrics-interval', 0),   // 秒，0=不打印
  fpsLog: FLAG('fps-log'),
  noConfig: FLAG('no-config'),
  idleLinear: FLAG('idle-linear'),               // 空闲帧率不限步（对比用）
  clickThrough: arg('click-through', null),      // force on/off
  alwaysOnTop: arg('always-on-top', null),
  emitHwnd: FLAG('emit-hwnd'),
  transTest: arg('trans-test', null),           // 目录：抓 300ms 交叉淡入的中间帧
  shotStates: arg('shot-states', null),
  testSetting: arg('test-setting', null),       // key=value：走 applySetting（与菜单项同一条路径）
  testDrag: arg('test-drag', null),             // dx,dy：走 drag-by/drag-end（与真实拖动同一条路径）
  testActivate: arg('test-activate', null),     // n：走 onActivate（与用户点图标同一条路径），不合成真实输入
  testMouse: arg('test-mouse', null),           // "间隔ms|d,x,y;m,x,y;u,x,y|..."：走渲染层同一套 hDown/hMove/hUp
  testHover: arg('test-hover', null),           // on|off：走渲染层同一个 setHot
  testScript: arg('test-script', null),
  shotPayload: arg('shot-payload', null),
  shotBurst: arg('shot-burst', null),          // 与 --shot 合用：把完成相位**冻结**在 tight|out（否则抓图永远落在回归之后）      // 与 --shot 合用：把一份 v2 载荷 JSON 喂给渲染层，让截图里**有真实数据**（只读，不改协议）         // JSON 时间轴：灌鼠标脚本/悬停（测试专用，**不改 stdio 协议**）
  shotPanel: FLAG('shot-panel'),                 // 与 --shot 合用：直接把完整面板展开后截图（设计验收用）
  testOpenSettings: FLAG('test-open-settings'),  // 测试钩子：走菜单模板里那一项的 click 打开设置窗口
  testThemeDrive: arg('test-theme-drive', null), // 测试钩子："ms:set:id:value;ms:dump;ms:reset"：驱动设置窗口自己的 DOM（不合成真实输入）
  dwmPhase: NUM('dwm-phase', 0),                // 显示真窗口的受控测试：持续秒数
  probe: FLAG('probe'),
  label: arg('label', ''),
  settleMs: NUM('settle-ms', 500)
}
const SHOT = !!OPT.shot
if (SHOT) { OPT.hidden = true }

/* ------------------------------------------------------------------ 常量 */
/* ------------------------------------------------------------------ 完整面板（2026-09-12 定稿）
   尺寸 440 × 340、底板 α 0.78（用户选定）。**α 只在这里一处**，将来由 `window.panelAlpha` 驱动。
   ⚠️ α 0.78 的代价（实测）：浅色壁纸下明细行 3.5:1、微标签 3.3:1，**低于 WCAG AA 4.5**；
      深色/蓝调壁纸下全绿（主文 11.1 / 明细 5.7 / 微标签 5.3）。用户已知情、接受（将来可自行调）。 */
const PANEL_W = 440
const PANEL_H = 340
const PANEL_ALPHA = 0.78
/* 窗口声明 v2：宿主 protocol.js 的 PROTOCOL_VERSION=2、SUPPORTED=[1,2]。
   只加 capabilities 却仍报 v1，宿主可能按"老窗口"处理而不下发 v2 字段 ⇒ 面板会是空的。 */
const PROTOCOL_VERSION = 2
const VIEW = 200
const PLATE_R = 97
const SPAN = 100 / PLATE_R                      // svg 盒子 = 直径 × 100/97
const STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']
const ALIAS = {
  IDLE: 'IDLE', THINKING: 'THINKING', THINK: 'THINKING', WORKING: 'WORKING', WORK: 'WORKING',
  WAITING: 'WAITING', WAIT: 'WAITING', SUCCESS: 'SUCCESS', OK: 'SUCCESS', DONE: 'SUCCESS',
  ERROR: 'ERROR', ERR: 'ERROR', DISCONNECTED: 'DISCONNECTED', DISCONNECT: 'DISCONNECTED', OFF: 'DISCONNECTED'
}
const SUCCESS_HOLD_MS = 2500                    // SPEC 第 4 节：2.5s 后自动回 IDLE
const SCALES = [96, 140, 200]
const OPACITIES = [60, 80, 100]
const DEFAULT_RATIO = 1.5                      /* SPEC 第 1 节 v2：窗口 = 图标直径 × 1.5（图标占 66%） */
/* 帧率三档预设（用户反馈「空闲 4fps 太顿」，默认改成 standard = IDLE 15fps） */
const FPS_PRESETS = {
  saver: { idle: 4, thinking: 15, waiting: 15, working: 30 },
  standard: { idle: 15, thinking: 30, waiting: 30, working: 60 },
  smooth: { idle: 30, thinking: 60, waiting: 60, working: 120 }
}
const FPS_LABELS = { saver: '省电', standard: '标准', smooth: '流畅' }
/* 插件级（非窗口偏好）设置：发扁平键给宿主，不走 window.* 前缀 */
const TOP_LEVEL_SETTING_KEYS = { includeSubagents: 'includeSubagents' }
const DEFAULT_FPS = 'standard'
/* window.profile：资源剖面（用户可挑）。eco/standard/smooth ↔ 帧率预设 saver/standard/smooth。
   window.fps 保留为兼容别名：两者都给时 fps 优先（显式胜过档位）。 */
const PROFILES = ['eco', 'standard', 'smooth']
const PROFILE_TO_FPS = { eco: 'saver', standard: 'standard', smooth: 'smooth' }
const DEFAULT_PROFILE = 'standard'
/* window.hoverPlate：悬浮层底板（on=文字高度 α0.78 薄板，默认；off=纯 HUD 无板，浅色壁纸会读不清） */
const HOVER_PLATES = ['on', 'off']
/* window.hoverRows：悬浮层里那**三行文字**（状态行 / 计划行 / 进程行）画不画。
   任务 B（2026-09-20）用户原话「就是左上角这个字我都不希望留，太碍眼了」⇒ 默认 'off' = 删掉。
   ⚠️ 只删**文字**：行首小圆点 `.dot`、150px 计划进度条 `.bs`、「▲ 计划 6→11」`.warnv2` **全部保留**
   （用户明确选了"全留"）。'on' 用来把三行原样还原回来（用户会改主意）。
   ⚠️ **2026-09-21 任务 C 更新**：上面那句里的「150px 计划进度条 `.bs`」**已被用户点名去掉**
   （见下面的 window.hoverBar，「有环形的这样是多此一举」）⇒ 现在"默认全留"的只剩
   行首小圆点与「▲ 计划 6→11」两个图形。 */
const HOVER_ROWS = ['on', 'off']
/* window.hoverBar：悬浮层里那根 **150px 横向计划进度条**（`.v2bullet > .bs`）画不画。
   任务 C（2026-09-21）用户原话（附截图）：「我这个左上角的任务条也不要了，有环形的这样是多此一举」
   ⇒ 默认 'off' = 去掉这根条。
   ⚠️ 只删**这一根横条**：
     · 环形的进度（图标本体那道青色弧）**保留** —— 那正是用户认可的东西，也是他说"多此一举"的对照物；
     · `#lab` / `#lab2` 两行青色中文（「空闲 · 160.4k 词元」/「4 轮 · 44 工具」）**保留**（独立 div，不在悬浮层里）；
     · 行首小圆点 `.r1 > .dot` 与「▲ 计划 6→11」`.h3 > .warnv2` **照旧保留**（用户没点名它们）。
   与 window.hoverRows 的关系：**两个独立开关**。
     hoverRows 管那三行**文字**（默认 off），hoverBar 管这一根**条**（默认 off）。
     旧形态（条在、文字分档）用 hoverBar='on' 就能整根还原回来 —— 这两个键互不覆盖。
   运行时取证（用户机器上那次的真实日志，见报告）：有计划的 10:52:36~10:53:01 那一段
     `hover rows` 报 `bullet=1, bs=1` 且 `hover geom(hover)` 的板高 = **204x35**；
     计划结束后的 10:54:09 起报 `bullet=0, bs=0` 且板高 = **204x22**。差值 **13px = `.v2bullet` 的 height**。 */
const HOVER_BARS = ['on', 'off']
/* window.panelDetail：面板详细度（simple 一行计数 / columns 多列图形 / tree 子代理树） */
const PANEL_DETAILS = ['simple', 'columns', 'tree']
const DEFAULT_PANEL_ALPHA = 0.78
const DEFAULTS = {
  scale: 140, opacity: 100, alwaysOnTop: true, clickThrough: true, position: null, ratio: DEFAULT_RATIO,
  fps: DEFAULT_FPS,
  profile: DEFAULT_PROFILE,          /* window.profile */
  panelAlpha: DEFAULT_PANEL_ALPHA,   /* window.panelAlpha */
  hoverPlate: 'on',                  /* window.hoverPlate */
  hoverRows: 'off',                  /* window.hoverRows：默认删掉悬浮层那三行文字 */
  hoverBar: 'off',                   /* window.hoverBar：默认删掉悬浮层那根 150px 横向计划进度条 */
  panelDetail: 'tree'                /* window.panelDetail */
}
/* 给跨侧绊线测试用：窗口侧认的全部键（宿主 SHARED_WINDOW_KEYS 必须与此**逐键相等**） */
const WINDOW_KEYS = Object.keys(DEFAULTS).sort()

/* ------------------------------------------------------------------ 落盘 */
function homeDir () {
  if (OPT.home) return path.resolve(OPT.home)
  const env = process.env.DSH_WORK_ICON_HOME
  if (env && env.trim()) return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh', 'work-icon')
}
const HOME = homeDir()
const CFG_PATH = path.join(HOME, 'config.json')
const LOG_PATH = OPT.logFile ? path.resolve(String(OPT.logFile)) : path.join(HOME, 'helper.log')
const LOG_MAX = 1024 * 1024

let logBytes = 0
try { logBytes = fs.statSync(LOG_PATH).size } catch { /* 首次运行 */ }
function log (msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg
  try { process.stderr.write(line + '\n') } catch { /* ignore */ }
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    if (logBytes > LOG_MAX) {                    /* 滚动：超 1MB 归档成 .1 再重开 */
      try { fs.renameSync(LOG_PATH, LOG_PATH + '.1') } catch { try { fs.unlinkSync(LOG_PATH) } catch { /* ignore */ } }
      logBytes = 0
    }
    fs.appendFileSync(LOG_PATH, line + '\n')
    logBytes += Buffer.byteLength(line) + 1
  } catch { /* 日志失败绝不影响主流程 */ }
}

function readDiskConfig () {
  try {
    const txt = fs.readFileSync(CFG_PATH, 'utf8')
    const j = JSON.parse(txt)
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch { return {} }
}
function numberOr (v, d, min, max) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return d
  return Math.min(max, Math.max(min, n))
}
function nearest (v, steps, d) {
  const n = Number(v)
  if (!Number.isFinite(n)) return d
  return steps.reduce((b, s) => (Math.abs(s - n) < Math.abs(b - n) ? s : b), steps[0])
}
function cleanWindow (raw) {
  const w = raw && typeof raw === 'object' ? raw : {}
  const pos = w.position && typeof w.position === 'object' &&
    Number.isFinite(Number(w.position.x)) && Number.isFinite(Number(w.position.y))
    ? { x: Math.round(Number(w.position.x)), y: Math.round(Number(w.position.y)) } : null
  return {
    scale: nearest(w.scale, SCALES, DEFAULTS.scale),
    opacity: nearest(w.opacity, OPACITIES, DEFAULTS.opacity),
    alwaysOnTop: typeof w.alwaysOnTop === 'boolean' ? w.alwaysOnTop : DEFAULTS.alwaysOnTop,
    clickThrough: typeof w.clickThrough === 'boolean' ? w.clickThrough : DEFAULTS.clickThrough,
    position: pos,
    /* 比例可覆盖：config.json 里 window.ratio 或 --ratio，范围夹在 1.0–2.5 */
    ratio: numberOr(w.ratio, DEFAULTS.ratio, 1.0, 2.5),
    /* 流畅度：预设名（saver/standard/smooth）或自定义 { idle, thinking, waiting, working } */
    /* window.profile 是资源剖面；显式 window.fps 优先（兼容别名） */
    profile: PROFILES.indexOf(w.profile) >= 0 ? w.profile : DEFAULTS.profile,
    /* 实测过：cleanFps(w.fps) 命中优先；未显式给 fps 时按 profile 派生（探针已撤，见报告） */
    fps: cleanFps(w.fps) || PROFILE_TO_FPS[PROFILES.indexOf(w.profile) >= 0 ? w.profile : DEFAULTS.profile] || DEFAULTS.fps,
    /* 面板底板不透明度（0.5–1.0；0.78 是定稿值） */
    panelAlpha: numberOr(w.panelAlpha, DEFAULTS.panelAlpha, 0.5, 1.0),
    /* 悬浮层底板：on 薄板（默认）/ off 纯 HUD 无板 */
    hoverPlate: HOVER_PLATES.indexOf(w.hoverPlate) >= 0 ? w.hoverPlate : DEFAULTS.hoverPlate,
    /* 悬浮层三行文字：off 删掉（默认，任务 B）/ on 原样还原 */
    hoverRows: HOVER_ROWS.indexOf(w.hoverRows) >= 0 ? w.hoverRows : DEFAULTS.hoverRows,
    /* 悬浮层那根横向计划进度条：off 去掉（默认，任务 C）/ on 原样还原 */
    hoverBar: HOVER_BARS.indexOf(w.hoverBar) >= 0 ? w.hoverBar : DEFAULTS.hoverBar,
    /* 面板详细度：简单 / 分列 / 树（默认树） */
    panelDetail: PANEL_DETAILS.indexOf(w.panelDetail) >= 0 ? w.panelDetail : DEFAULTS.panelDetail
  }
}
function cleanFps (v) {
  if (typeof v === 'string' && FPS_PRESETS[v]) return v
  if (v && typeof v === 'object') {
    if (typeof v.power === 'string' && FPS_PRESETS[v.power] && Object.keys(v).length <= 2) return v.power
    const o = {}
    for (const k of ['idle', 'thinking', 'waiting', 'working']) {
      if (v[k] != null) o[k] = Math.round(numberOr(v[k], FPS_PRESETS.standard[k], 0, 240))
    }
    if (Object.keys(o).length) return o
  }
  return null   /* 非法值 -> null：调用方决定是忽略（config）还是回退默认（读盘） */
}
function resolveFps (v) {
  const base = Object.assign({}, FPS_PRESETS.standard)
  if (typeof v === 'string' && FPS_PRESETS[v]) return Object.assign({ power: v }, FPS_PRESETS[v])
  if (v && typeof v === 'object') {
    const p = (typeof v.power === 'string' && FPS_PRESETS[v.power]) ? v.power : 'custom'
    const merged = Object.assign(base, FPS_PRESETS[p] || {}, v)
    const out = { power: p }
    for (const k of ['idle', 'thinking', 'waiting', 'working']) out[k] = Math.round(numberOr(merged[k], base[k], 0, 240))
    return out
  }
  return Object.assign({ power: 'standard' }, base)
}
/* 配置读：文件里的 window 优先，兼容早期平铺字段；任何异常回退默认值，绝不抛 */
function loadWindowConfig () {
  if (OPT.noConfig) return Object.assign({}, DEFAULTS)
  const disk = readDiskConfig()
  const nested = disk.window && typeof disk.window === 'object' ? disk.window : {}
  const flat = {}
  for (const k of ['scale', 'opacity', 'alwaysOnTop', 'clickThrough', 'position']) {
    if (k in disk) flat[k] = disk[k]
  }
  const cfg = cleanWindow(Object.assign({}, DEFAULTS, flat, nested))
  if (OPT.scale) cfg.scale = nearest(OPT.scale, SCALES, cfg.scale)
  if (OPT.clickThrough !== null) cfg.clickThrough = OPT.clickThrough !== 'off' && OPT.clickThrough !== 'false'
  if (OPT.alwaysOnTop !== null) cfg.alwaysOnTop = OPT.alwaysOnTop !== 'off' && OPT.alwaysOnTop !== 'false'
  if (OPT.ratio > 0) cfg.ratio = Math.min(2.5, Math.max(1.0, OPT.ratio))
  if (OPT.fps) {
    let spec = OPT.fps
    if (spec === 'json') { try { spec = JSON.parse(arg('fps-json', '{}')) } catch { spec = DEFAULTS.fps } }
    cfg.fps = cleanFps(spec) || DEFAULTS.fps
  }
  return cfg
}
/* 原子写：临时文件 + fsync + rename。保留磁盘上其它字段（宿主写的 enabled/helper/... 不能被抹掉） */
function saveWindowPatch (patch) {
  const disk = readDiskConfig()
  const nested = disk.window && typeof disk.window === 'object' ? disk.window : {}
  const next = Object.assign({}, disk, { window: Object.assign({}, nested, patch) })
  const tmp = CFG_PATH + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp'
  try {
    fs.mkdirSync(HOME, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    try { const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } catch { /* fsync 失败不影响 rename 原子性 */ }
    fs.renameSync(tmp, CFG_PATH)
    log('config saved -> ' + JSON.stringify(patch))
    return true
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    log('WARN config save failed: ' + e.message)
    return false
  }
}

/* ==========================================================================
   窗口侧主题（任务 F，2026-09-19）：右键菜单「配色设置…」→ 独立设置窗口 → **实时**改这些量
   --------------------------------------------------------------------------
   🔴 落盘位置：`~/.dsh/work-icon/theme.json` —— **窗口侧自己的文件**。
      **绝不写宿主那份 config.json**：本项目踩过坑 —— 窗口侧一个"恰好等于默认值"的键把用户文件覆盖掉，
      结果「跟随子代理」的勾选态每次重启被清空。窗口侧设置与宿主配置必须是**两个真相源、两个文件**。
   🔴 热更新通路：设置窗口 → ipcMain.handle('theme:set') → 本进程直接 `sendToRenderer({kind:'theme'})`
      → 图标窗口当场改 CSS 变量。**不过 DSH 宿主的 stdio 协议**（那条路上有宿主自己的落盘与回写，
      会把窗口侧设置冲掉），也**不需要重启**。
   ========================================================================== */
const THEME_PATH = path.join(HOME, 'theme.json')
/* panelAlpha 默认 null = "没在设置窗口里调过" ⇒ 大面板底色仍听宿主的 cfg.panelAlpha（默认 0.78，**保留**）。
   用户在设置窗口里把它拖到任意值（含 0）之后才落成数字 —— 那时窗口侧覆盖值优先。 */
const THEME_DEFAULTS = { hoverPlateAlpha: 0, panelAlpha: null, textBoost: 1, panelOpacity: 1, iconBright: 1 }
const THEME_RANGE = {
  hoverPlateAlpha: [0, 1], panelAlpha: [0, 1], textBoost: [0.5, 2], panelOpacity: [0.2, 1], iconBright: [0.4, 1.6]
}
/* 用户真实浅色壁纸（天空+水面）在**悬浮板可能落到的位置**上的最亮取样（像素口径）。
   来源：tests/hover-plate.mjs 的实测输出（四个屏幕角落位形里最亮的那个块）。
   设置窗口用它做**实时**公式估算（够快）；像素复验由 tests/hover-plate.mjs / settings-window.mjs 做。
   ⚠️ 换壁纸/改取样口径 ⇒ 这两个数字要跟着重测；tests/hover-plate.mjs 有一条断言盯着它别漂。 */
const WALLPAPER_WORST_RGB = [141, 187, 203]
const WALLPAPER_WORST_LUM = 0.4552
function themeFromDisk () {
  try {
    const j = JSON.parse(fs.readFileSync(THEME_PATH, 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch { return {} }
}
function cleanTheme (raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  out.hoverPlateAlpha = numberOr(t.hoverPlateAlpha, THEME_DEFAULTS.hoverPlateAlpha, THEME_RANGE.hoverPlateAlpha[0], THEME_RANGE.hoverPlateAlpha[1])
  /* panelAlpha 允许显式 null：那是"跟随宿主"的语义，不能当成 0 */
  out.panelAlpha = (t.panelAlpha === null || t.panelAlpha === undefined)
    ? null
    : numberOr(t.panelAlpha, 0.78, THEME_RANGE.panelAlpha[0], THEME_RANGE.panelAlpha[1])
  out.textBoost = numberOr(t.textBoost, THEME_DEFAULTS.textBoost, THEME_RANGE.textBoost[0], THEME_RANGE.textBoost[1])
  out.panelOpacity = numberOr(t.panelOpacity, THEME_DEFAULTS.panelOpacity, THEME_RANGE.panelOpacity[0], THEME_RANGE.panelOpacity[1])
  out.iconBright = numberOr(t.iconBright, THEME_DEFAULTS.iconBright, THEME_RANGE.iconBright[0], THEME_RANGE.iconBright[1])
  return out
}
let theme = cleanTheme(themeFromDisk())
/* theme.json 的**原子写**（临时文件 + fsync + rename）。只碰 THEME_PATH，绝不碰 CFG_PATH。 */
function saveTheme () {
  const tmp = THEME_PATH + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp'
  try {
    fs.mkdirSync(HOME, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(theme, null, 2) + '\n', 'utf8')
    try { const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } catch { /* fsync 失败不影响 rename 原子性 */ }
    fs.renameSync(tmp, THEME_PATH)
    log('theme saved -> ' + THEME_PATH + ' ' + JSON.stringify(theme))
    return true
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    log('WARN theme save failed: ' + e.message)
    return false
  }
}
/* 当前**生效**的大面板底色 α：设置窗口调过就用窗口侧的值，没调过就听从宿主的 cfg.panelAlpha。 */
function effectivePanelAlpha () { return theme.panelAlpha === null ? cfg.panelAlpha : theme.panelAlpha }
/* 发给图标窗口/设置窗口的主题快照（**只含叶子字段**，不带任何 live 对象） */
function themeForRenderer () {
  return {
    hoverPlateAlpha: theme.hoverPlateAlpha,
    panelAlpha: theme.panelAlpha,
    effectivePanelAlpha: effectivePanelAlpha(),
    textBoost: theme.textBoost,
    panelOpacity: theme.panelOpacity,
    iconBright: theme.iconBright,
    wallpaperWorst: { rgb: WALLPAPER_WORST_RGB, lum: WALLPAPER_WORST_LUM },
    themePath: THEME_PATH
  }
}
function sendTheme (why) {
  sendToRenderer({ kind: 'theme', theme: themeForRenderer() })
  if (settingsWin && !settingsWin.isDestroyed()) { try { settingsWin.webContents.send('theme', themeForRenderer(), why || 'push') } catch { /* ignore */ } }
}
/* 唯一的主题写入口（设置窗口的滑块 / 复位 / 测试钩子都走它） */
function applyTheme (patch, why) {
  const before = JSON.stringify(theme)
  theme = cleanTheme(Object.assign({}, theme, patch || {}))
  const persist = why !== 'startup'
  if (persist) saveTheme()
  if (JSON.stringify(theme) === before && persist) log('theme: 无变化（' + why + '）')
  log('theme apply（' + why + '）-> ' + JSON.stringify(theme) + ' effPanelAlpha=' + effectivePanelAlpha() +
    ' 落盘=' + (persist ? THEME_PATH : '否（启动读取）') + ' cfg.json 未触碰=yes')
  sendTheme(why)
  return themeForRenderer()
}
let settingsWin = null
/* 设置窗口：**普通窗口**（不透明 / 有标题栏 / 可调大小 / 可关闭），不是透明置顶无边框的悬浮层。
   · 它不碰图标窗口：不动它的 bounds / alwaysOnTop / 穿透判据（那些都挂在 computeGeo 与轮询上）。
   · `--hidden`（离屏测试）时本窗口也不显示 —— GUI 测试默认离屏，绝不弹到用户屏幕上。 */
function openSettingsWindow () {
  if (settingsWin && !settingsWin.isDestroyed()) {
    try { if (!OPT.hidden) { settingsWin.show(); settingsWin.focus() } } catch { /* ignore */ }
    log('settings window 已存在，复用（shown=' + !OPT.hidden + '）')
    return settingsWin
  }
  const ib = win && !win.isDestroyed() ? win.getBounds() : null
  settingsWin = new BrowserWindow({
    width: 560, height: 660, minWidth: 460, minHeight: 520,
    x: 80, y: 80,                             /* 固定落点：**不跟随图标窗口**，也不抢它的位置 */
    frame: true, transparent: false, backgroundColor: '#f5f7fa',
    resizable: true, maximizable: true, minimizable: true, fullscreenable: false,
    alwaysOnTop: false, skipTaskbar: false, hasShadow: true,
    show: !OPT.hidden,                        /* 离屏：--hidden ⇒ 不显示（单次 ≤20s 的红线不适用于本窗口） */
    title: 'DSH 工作图标 · 配色设置',
    webPreferences: {
      preload: path.join(HERE, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  settingsWin.loadFile(path.join(HERE, 'settings.html'))
  settingsWin.on('closed', () => { settingsWin = null; log('settings window closed') })
  settingsWin.webContents.on('console-message', (...a) => {
    const m = a.length >= 3 ? a[2] : (a[1] && a[1].message)
    if (m) log('settings-console: ' + String(m).slice(0, 200))
  })
  settingsWin.webContents.on('did-finish-load', () => { try { sendTheme('open') } catch { /* ignore */ } })
  log('settings window created shown=' + !OPT.hidden + ' bounds=' + JSON.stringify(settingsWin.getBounds()))
  /* 取证：开窗前后的图标窗口状态（证明"没抢焦点、没动置顶/穿透/几何"） */
  const ib2 = win && !win.isDestroyed() ? win.getBounds() : null
  log('settings focuscheck icon(before)=' + JSON.stringify(ib) + ' icon(after)=' + JSON.stringify(ib2) +
    ' iconAlwaysOnTop=' + (win && !win.isDestroyed() ? win.isAlwaysOnTop() : 'n/a') +
    ' iconFocusable=' + (win && !win.isDestroyed() ? win.isFocusable() : 'n/a') +
    ' settingsAlwaysOnTop=' + settingsWin.isAlwaysOnTop() + ' settingsTransparent=false frame=true' +
    ' ignoreOn=' + ignoreOn + ' panelOpen=' + panelOpen)
  return settingsWin
}
/* 设置窗口的取数：图标窗口现状（只读取证，不改任何东西） */
function iconStateForSettings () {
  if (!win || win.isDestroyed()) return { alive: false }
  const b = win.getBounds()
  return { alive: true, bounds: b, alwaysOnTop: win.isAlwaysOnTop(), focusable: win.isFocusable(),
    clickThrough: cfg.clickThrough, ignoreOn: ignoreOn, panelOpen: panelOpen, geo: { w: geo.w, h: geo.h, cx: geo.cx, cy: geo.cy } }
}
ipcMain.handle('theme:get', () => themeForRenderer())
ipcMain.handle('theme:set', (_e, patch) => applyTheme(patch, 'settings-ui'))
ipcMain.handle('theme:reset', () => applyTheme(Object.assign({}, THEME_DEFAULTS), 'settings-reset'))
ipcMain.handle('icon:state', () => iconStateForSettings())

/* ------------------------------------------------------------------ 协议输出 */
function out (kind, payload) {
  const msg = Object.assign({ protocolVersion: PROTOCOL_VERSION, kind, timestamp: Date.now() }, payload || {})
  try { process.stdout.write(JSON.stringify(msg) + '\n') } catch (e) { log('WARN stdout failed: ' + e.message) }
}
function sendToRenderer (msg) { try { if (win && !win.isDestroyed()) win.webContents.send('msg', msg) } catch { /* ignore */ } }

/* ------------------------------------------------------------------ 窗口几何 */
let cfg = loadWindowConfig()
let prevFps = null
/* includeSubagents：**单一真相源在宿主的顶层配置**（SETTABLE_TOP_LEVEL_KEYS）。
   窗口侧只在内存里留一份用于显示勾选态：启动时从 config.json 顶层读一次，之后靠宿主回发的 config 更新。
   绝不写进 config.json 的 window 块（两个真相源迟早漂移，宿主下次保存会把 window 里的抹掉）。 */
let includeSubagents = false
function setIncludeSubagents (v, why) {
  const next = v === true
  if (next === includeSubagents) { log('includeSubagents 已是 ' + next + '（' + why + '），无变化'); return false }
  includeSubagents = next
  log('includeSubagents -> ' + next + '（' + why + '；窗口只显示勾选态，过滤逻辑在宿主侧）')
  return true
}
let geo = computeGeo(cfg.scale, false)

function computeGeo (scale, panelOpen) {
  /* SPEC 第 1 节（v2）：窗口尺寸 = 图标直径 × 1.5，图标在窗口内居中 —— 边距是给光晕的容身之处，
     给不够小尺寸下光晕边缘会出现硬切。SVG 盒子 = 直径 × 200/194（底盘 r=97/200 正好等于直径）。
     ★ 面板展开时：窗口**只向下和左右同时加宽**，图标位置**一动不动** ——
       所以图标中心的 y 恒等于"关闭态正方形窗口"的一半（iconWin/2），与展开后的高度无关。
       这条是命中区能沿用同一套判据的前提：圆心跟着图标走，而不是跟着窗口中心走。 */
  const svgSize = Math.round(scale * SPAN)
  const iconWin = Math.max(Math.round(scale * (cfg && cfg.ratio ? cfg.ratio : DEFAULT_RATIO)), svgSize + 4)
  const pad = (iconWin - svgSize) / 2
  const w = panelOpen ? PANEL_W : iconWin
  const h = panelOpen ? (iconWin - (iconWin - scale) / 2 + 10 + PANEL_H) : iconWin
  const panelTop = panelOpen ? (iconWin + scale) / 2 + 10 : null
  return { scale, svgSize, pad, w, h, cx: w / 2, cy: iconWin / 2, hitR: scale / 2, iconWin, panelTop, panelOpen: !!panelOpen, iconRatio: +(scale / iconWin).toFixed(3) }
}
function shotGeo (box) {
  return { scale: box, svgSize: box, pad: 0, w: box, h: box, cx: box / 2, cy: box / 2, hitR: box / 2, iconWin: box, panelTop: null, panelOpen: false }
}
/* 面板开关状态：**只活在内存里，绝不落盘**（避免重启后莫名多出一个大面板） */
let panelOpen = false
/* ------------------------------------------------------------------ 面板可交互命中区（2026-09-13 用户拍板）
   「你这个右边有个条，但是我不能拉动这个条……我现在撤回我这个决定，他就是一个可以交互的窗口」
   交互范围 = **图标圆 ∪ 面板可见矩形**（用户明确否掉了"整个窗口矩形"：那会让图标四周、
   面板周围的透明角也挡鼠标，而那些地方他现在能点到后面的东西）。
   panelHitRect 由**渲染层从真实布局量出来**（#plate.getBoundingClientRect()），
   不是拿窗口矩形顶替 —— 两者的差别正是"透明角会不会开始吃鼠标"。 */
let panelHitRect = null
function finiteOr (v, d) { return Number.isFinite(v) ? v : d }
function normRect (r) {
  if (!r) return null
  const l = finiteOr(Number(r.left), NaN), t = finiteOr(Number(r.top), NaN)
  const rr = finiteOr(Number(r.right), NaN), b = finiteOr(Number(r.bottom), NaN)
  if (![l, t, rr, b].every(Number.isFinite)) return null
  return { left: Math.min(l, rr), top: Math.min(t, b), right: Math.max(l, rr), bottom: Math.max(t, b) }
}
/* 面板矩形**必须夹进窗口**：DOM 量到的黑板是 442×342（含 1px 边框），窗口只有 440×525，
   落在窗口外的部分是看不见的，绝不能让它变成可交互区。 */
function clipRect (r, w, h) {
  if (!r) return null
  const left = Math.max(0, r.left), top = Math.max(0, r.top)
  const right = Math.min(w, r.right), bottom = Math.min(h, r.bottom)
  if (right - left < 1 || bottom - top < 1) return null
  return { left, top, right, bottom }
}
function panelRectRaw () {
  /* ① 优先用渲染层量到的真实布局。
     ⚠️ 但必须**与本次几何对得上**才算数：渲染层在面板**关闭**时也会上报（那时板子还没摆到 --panel-top
        上，量到的是 (0,0,442,342) 这类"错位"矩形）。否则 setPanel(true) 后那一瞬间会先用上一帧
        的错位矩形判据 ⇒ 面板顶那几十像素被误判成穿透（实测被 panel-toggle ⑤ 抓到 1 次红）。
        判据：DOM 矩形与"几何算出的面板横带 (panelTop..h) 必须有重叠"。 */
  const dom = normRect(panelHitRect)
  if (dom && geo && geo.panelOpen && Number.isFinite(geo.panelTop)) {
    /* 对齐容差 30px：panelTop 在 scale=140 是 185，而"面板关闭时量到的错位矩形"是 top=0
       ⇒ 只有真的摆到面板位置上的那一版才被接受。 */
    const aligned = Math.abs(dom.top - geo.panelTop) <= 30 && dom.right > dom.left && dom.bottom > dom.top
    if (aligned) return { rect: dom, source: 'dom' }
    log('panel hitrect 与本次几何不符（dom.top=' + Math.round(dom.top) + ' vs geo.panelTop=' + geo.panelTop +
      '，差 ' + Math.round(Math.abs(dom.top - geo.panelTop)) + 'px > 30）⇒ 退回几何常量，等渲染层重报')
  }
  /* ② 渲染层还没量到（刚展开的那几十毫秒）⇒ 退回由几何常量推出的同一块区域。
       依据：几何**只在这里一处**——computeGeo() 已经把 panelOpen 编进 w/h/panelTop。 */
  if (!geo || !geo.panelOpen || !Number.isFinite(geo.panelTop)) return null
  return { rect: { left: 0, top: geo.panelTop, right: Math.min(PANEL_W, geo.w), bottom: Math.min(geo.panelTop + PANEL_H, geo.h) }, source: 'geo' }
}
/* 命中区矩形列表：面板收起时**空数组** ⇒ 判据退回"只有图标圆"（用户在面板关闭态的行为一个字节不变） */
function panelHitRects () {
  if (!panelOpen || !geo || !geo.panelOpen) return []
  const raw = panelRectRaw()
  if (!raw) return []
  const c = clipRect(raw.rect, geo.w, geo.h)
  return c ? [{ left: c.left, top: c.top, right: c.right, bottom: c.bottom, source: raw.source }] : []
}
function inAnyRect (px, py, rects) {
  for (const r of rects) if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return r
  return null
}
function panelMsg (open) {
  return { kind: 'panel', open: open, w: geo.w, h: geo.h, iconWin: geo.iconWin, panelTop: geo.panelTop, panelW: PANEL_W, panelH: PANEL_H, alpha: PANEL_ALPHA }
}
function setPanel (open, why) {
  if (!open) { resetRows('panel closed'); panelHitRect = null }   /* 面板收起 ⇒ 命中区必须立刻退回"只有图标圆" */
  if (!win || win.isDestroyed()) return
  if (open === panelOpen) { log('panel ' + (open ? 'OPEN' : 'CLOSED') + '：已是该状态（' + why + '），忽略'); return }
  const b = win.getBounds()
  const iconX = b.x + geo.cx, iconY = b.y + geo.cy        /* 图标屏幕位置：展开/收起全程不动 */
  panelOpen = !!open
  geo = computeGeo(cfg.scale, panelOpen)
  const x = Math.round(iconX - geo.cx), y = Math.round(iconY - geo.cy)
  win.setBounds({ x, y, width: geo.w, height: geo.h })
  sendToRenderer(panelMsg(panelOpen))
  /* 命中区自检（展开时打一行）：判据 = 图标圆 ∪ 面板可见矩形 ——
     圆内必须可交互；图标与面板之间的空隙必须穿透；面板内（含右侧滚动条那一列）必须可交互。 */
  if (panelOpen) {
    const bb = win.getBounds()
    const ic = (dy) => insideIcon(bb.x + geo.cx, bb.y + geo.cy + dy)
    const at = (x, y) => insideIcon(bb.x + x, bb.y + y).inside
    const rect = panelHitRects()[0] || null
    /* belowIcon 取"图标下沿 ~ 面板上沿"这段**透明空隙**的中点（窗口 y 从窗口顶算起：
       图标下沿 = cy + hitR，面板上沿 = panelTop；scale=140 时中点 = 180）。 */
    const gapY = Math.round((geo.cy + geo.hitR + geo.panelTop) / 2)
    log('panel hitcheck iconCenter=' + ic(0).inside + ' belowIcon=' + at(geo.cx, gapY) +
      ' panelTop=' + at(geo.cx, geo.panelTop + 6) + ' panelMid=' + at(geo.cx, geo.panelTop + 80) +
      ' scrollbar=' + at(geo.w - 6, geo.panelTop + 80) +
      ' rect=' + (rect ? [rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(',') : 'none') +
      ' src=' + (rect ? rect.source : '-') +
      ' hitR=' + geo.hitR + ' cy=' + geo.cy + ' win=' + geo.w + 'x' + geo.h)
  }
  log('panel ' + (panelOpen ? 'OPEN' : 'CLOSED') + '（' + why + '）win=' + geo.w + 'x' + geo.h +
    ' bounds=' + JSON.stringify(win.getBounds()) + ' iconCenter=(' + (x + geo.cx) + ',' + (y + geo.cy) + ')')
}

function clampToDisplay (x, y, w, h) {
  let d
  try { d = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }) } catch { d = screen.getPrimaryDisplay() }
  const a = d.workArea
  const nx = Math.min(Math.max(x, a.x), a.x + a.width - w)
  const ny = Math.min(Math.max(y, a.y), a.y + a.height - h)
  return { x: Math.round(nx), y: Math.round(ny) }
}
function defaultPosition (w, h) {
  const d = screen.getPrimaryDisplay()
  const a = d.workArea || d.bounds
  return { x: Math.round(a.x + a.width - w - 24), y: Math.round(a.y + a.height - h - 24) }
}

/* ------------------------------------------------------------------ 窗口 */
let win = null
let probeWin = null
let curState = null
let curReasonKind = null   /* 宿主载荷里的中性/故障原因，仅用于极轻的提示，绝不参与状态机 */
/* 静默计时器：SPEC 第 5 节"15s 未收到任何消息 → 自行转 DISCONNECTED"。
   它**只改显示状态**，不重启、不重拉、不保活任何进程 —— SPEC 第 10 节第 3 条禁止的是自愈式重试/保活/进程看门狗，
   本运行时不存在那类逻辑（全树无 relaunch/respawn/restart）。 */
let silenceTimer = null
let successTimer = null
let mouseTimer = null
let lastInside = null
let ignoreOn = null
let ipcStats = { lines: 0, bad: 0, kinds: {}, stateSwitches: 0 }
let frames = 0
let shownAt = 0
let dragByCount = 0
let rendererDowns = 0

function buildWindow () {
  const g = SHOT ? (FLAG('shot-panel') ? Object.assign(computeGeo(cfg.scale, true), { scale: cfg.scale }) : shotGeo(Number(OPT.shot))) : geo
  if (SHOT && FLAG('shot-panel')) { geo = g; panelOpen = true }   /* 截图验收：面板几何也写回模块级 geo，渲染层才收得到 */
  const pos = SHOT ? { x: 40, y: 40 }
    : (cfg.position ? clampToDisplay(cfg.position.x, cfg.position.y, g.w, g.h) : defaultPosition(g.w, g.h))
  log(`layout: ${SHOT ? 'shot' : (cfg.position ? 'restored' : 'default')} -> (${pos.x},${pos.y}) ${g.w}x${g.h} scale=${g.scale} svg=${g.svgSize}`)

  const bg = OPT.bg === 'dark' ? '#111111' : OPT.bg === 'white' ? '#ffffff' : '#00000000'
  win = new BrowserWindow({
    width: g.w, height: g.h, x: pos.x, y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: bg,
    alwaysOnTop: !SHOT && cfg.alwaysOnTop,
    skipTaskbar: true,
    focusable: false,                 // SPEC 第 1 节：默认不抢焦点
    hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    acceptFirstMouse: true,
    show: false,
    title: 'DSH 工作图标',
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,    // 隐藏窗口也要能推进 300ms 交叉淡入
      spellcheck: false,
      v8CacheOptions: 'code'
    }
  })
  try { win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver') } catch { /* ignore */ }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch { /* ignore */ }
  win.on('closed', () => { log('window closed'); win = null })
  win.on('unresponsive', () => log('WARN window unresponsive'))
  win.webContents.on('render-process-gone', (_e, d) => {
    log('FATAL renderer gone: ' + JSON.stringify(d))
    out('closed', { reason: 'renderer-gone:' + (d && d.reason) })   /* 让宿主知道窗口没了 */
  })
  win.webContents.on('console-message', (...a) => {
    const m = a.length >= 3 ? a[2] : (a[1] && a[1].message)
    if (m) log('renderer-console: ' + String(m).slice(0, 300))
  })

  const q = {
    state: SHOT ? OPT.state : 'IDLE',
    svg: String(g.svgSize), pad: String(g.pad), opacity: String(cfg.opacity),
    scale: String(g.scale)
  }
  if (OPT.fpsLog) q.fps = '1'          /* 只有要测帧率时才让渲染层排 rAF 自转循环 */
  if (OPT.spin >= 0) q.spin = String(OPT.spin)   /* 冻结相位(度)，供旋转轴心取证 */
  if (OPT.hide) q.hide = String(OPT.hide)        /* 取证用：临时隐藏指定层 */
  if (SHOT) { q.shot = '1'; q.bg = OPT.bg }
  win.loadFile(path.join(HERE, 'index.html'), { query: q })

  if (!OPT.hidden && !SHOT) {
    win.once('ready-to-show', () => {
      win.show()
      shownAt = Date.now()
      log('window shown scale=' + g.scale + ' opacity=' + cfg.opacity + ' onTop=' + cfg.alwaysOnTop + ' clickThrough=' + cfg.clickThrough)
      startMouseWatch()
      startTopWatch()
    })
  } else {
    log('window created hidden (show=false)')
  }
  return win
}

/* ------------------------------------------------------------------ 鼠标穿透（验收第 8 条）
   透明 ≠ 穿透。做法：默认整窗 setIgnoreMouseEvents(true,{forward:true})，
   用屏幕光标位置做判定：**落在图标圆 ∪ 面板可见矩形内 → 关闭 ignore（本窗口接收鼠标）**，
   两者之外 → 打开 ignore（穿透到下层窗口）。判定全程在 DIP 逻辑坐标里做。

   ⚠️ 2026-09-13 用户拍板改判据（原话见 sPanelHitRect 处注释）：
      · 改 **前**：只有图标圆（r=scale/2）⇒ 面板整块穿透 ⇒ 面板右侧那条滚动条拖不动 ✗
      · 改 **后**：图标圆 ∪ 面板可见矩形 ⇒ 面板内可交互（能拖滚动条、能选中文字），
                  图标四周与面板周围的透明处**照旧穿透**（用户当年验收过的行为，不许弄丢）。
      · hover 宽限期：SPEC-panel §2 那份 400ms 宽限是给**已废弃的"面板纯展示/hover 自动展开"**方案写的
        （"否则鼠标下移去看面板会立刻收起"）。当前产品的面板开合只由**双击图标**触发，
        代码里从来没有"鼠标离开就收起面板"这件逻辑，所以那个宽限期既不存在也不需要 →
        面板变成可交互之后，鼠标可以**真的停在面板上**，前提更不成立。不做,也不新增（见报告）。 */
/* 命中判定：只有图标实际绘制的圆形区域 ∪ 面板可见矩形内才拦截鼠标，其余一律穿透（SPEC 第 1 节 + 验收第 8 条）。
   抽成独立函数是为了让**离屏取证**能走与实时监看完全相同的这段代码。 */
function insideIcon (px, py) {
  const b = win.getBounds()
  const cx = b.x + geo.cx, cy = b.y + geo.cy
  const dx = px - cx, dy = py - cy
  const d2 = dx * dx + dy * dy
  const inCircle = d2 <= (geo.hitR * geo.hitR)
  /* 面板可见矩形（窗口局部坐标 = 屏幕坐标 - 窗口原点；隐藏/透明窗口下 CSS px 就是 DIP） */
  const pr = inAnyRect(px - b.x, py - b.y, panelHitRects())
  return {
    inside: !!(inCircle || pr),
    inCircle: inCircle,
    inPanel: !!pr,
    d: Math.sqrt(d2),
    cx: cx,
    cy: cy,
    rect: pr || null
  }
}
function startMouseWatch () {
  if (mouseTimer) return
  mouseTimer = setInterval(() => {
    /* 测试钩子：热态由 --test-hover 决定，别被真实光标轮询覆盖（否则测试里 hover 永远被翻回 false） */
    if (OPT.testHover) return
    if (!win || win.isDestroyed() || !win.isVisible()) return
    let p
    try { p = screen.getCursorScreenPoint() } catch { return }
    const r = insideIcon(p.x, p.y)
    const inside = r.inside
    /* ---- 子代理树：用同一套轮询算"命中第几行"（**不依赖 DOM 事件**：forward 实测不转发 mousemove） ---- */
    if (panelOpen && cfg.panelDetail === 'tree' && treeRows.length) {
      let b
      try { b = win.getBounds() } catch { b = null }
      if (b) {
        const cy = p.y - b.y
        const id = rowAt(cy)
        if (id !== null) {
          rowLeaveAt = 0
          if (id !== hotRow) { hotRow = id; sendToRenderer({ kind: 'row', id: id }); log('tree row -> ' + id + '（cursor cy=' + Math.round(cy) + '）') }
        } else if (hotRow !== null) {
          if (!rowLeaveAt) rowLeaveAt = Date.now()
          else if (Date.now() - rowLeaveAt > ROW_LEAVE_GRACE_MS) {
            hotRow = null; rowLeaveAt = 0
  sendToRenderer({ kind: 'row', id: null })
            log('tree row -> null（离开超过 ' + ROW_LEAVE_GRACE_MS + 'ms 宽限）')
          }
        }
      }
    }
    if (inside !== lastInside) {
      lastInside = inside
      setIgnore(!inside)
      sendToRenderer({ kind: 'hot', inside })
      log(`hit-test cursor=(${p.x},${p.y}) center=(${r.cx},${r.cy}) d=${Math.round(r.d)} hitR=${geo.hitR} inside=${inside} panel=${r.inPanel}`)
    }
  }, 40)
}
function setIgnore (on) {
  if (!win || win.isDestroyed()) return
  if (ignoreOn === on) return
  ignoreOn = on
  try {
    if (on) win.setIgnoreMouseEvents(true, { forward: true })
    else { win.setIgnoreMouseEvents(false) }
  } catch (e) { log('WARN setIgnoreMouseEvents failed: ' + e.message) }
}
function applyClickThrough () {
  if (SHOT || OPT.hidden) return
  if (cfg.clickThrough) { setIgnore(true); lastInside = null }
  else { setIgnore(false); lastInside = true; sendToRenderer({ kind: 'hot', inside: true }) }
}

/* 置顶保持：本机实测 —— 别的置顶窗口（例如被"点击聚焦"拉起来的 Edge/DSH 页面）一旦被激活，
   就会排到同层窗口 z 序的更上面，把图标压住。所以按周期把图标重新顶回 screen-saver 层顶部。
   这是 SPEC 第 1 节"任意应用上层可见"的必要条件，不是可选项。 */
let topTimer = null
let topReasserts = 0
function keepOnTop () {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  if (!cfg.alwaysOnTop) return
  try { win.setAlwaysOnTop(false) } catch { /* ignore */ }
  try { win.setAlwaysOnTop(true, 'screen-saver') } catch { /* ignore */ }
  try { win.moveTop() } catch { /* ignore */ }
  topReasserts++
  log('topmost re-assert #' + topReasserts + ' bounds=' + JSON.stringify(win.getBounds()))
}
function startTopWatch () {
  if (topTimer) return
  topTimer = setInterval(keepOnTop, 4000)
}

/* ------------------------------------------------------------------ 状态 */
function normalizeState (s) {
  if (typeof s !== 'string') return null
  return ALIAS[s.trim().toUpperCase()] || null
}
function setState (name, payload, why) {
  const st = normalizeState(name)
  if (!st) { log('WARN ignored unknown state: ' + JSON.stringify(name)); return false }
  const changed = st !== curState
  curState = st
  curReasonKind = (payload && typeof payload.reasonKind === 'string') ? payload.reasonKind : null
  if (changed) ipcStats.stateSwitches++
  sendToRenderer({
    kind: 'state',
    state: st,
    activity: payload && payload.activity,
    task: payload && payload.task,
    session: payload && payload.session,
    progress: payload ? cleanProgress(payload.progress) : undefined,
    metrics: payload && payload.metrics,
    subagents: payload && payload.subagents,
    todos: payload && payload.todos,          /* 信封 {items,more} */
    cost: payload && payload.cost,             /* {status,cost,priced,unpriced} */
    context: payload && payload.context,       /* {applicable,used,limit,ratio} */
    tokens: payload && payload.tokens,
    sessions: payload && payload.sessions,
    elapsedMs: payload && payload.elapsedMs,
    tokens: payload && payload.tokens,
    reasonKind: payload && payload.reasonKind
  })
  if (changed) log(`STATE -> ${st}${why ? ' (' + why + ')' : ''}`)
  /* SPEC 第 4 节的 "2.5s 后自动回 IDLE" 由**宿主**负责（宿主会自己发一条 IDLE）。
     窗口侧只播一次性动画，绝不自行改状态机 —— 两边同时切会打架。 */
  return true
}

/* ------------------------------------------------------------------ 心跳看门狗（SPEC 第 5 节：15s 无消息 → OFF） */
function resetSilenceTimer () {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
  if (!(OPT.windowTimeoutMs > 0)) return
  silenceTimer = setTimeout(() => {
    silenceTimer = null
    if (curState !== 'DISCONNECTED') {
      log(`silence: ${OPT.windowTimeoutMs}ms 无消息 -> DISCONNECTED（只改显示状态，不重启任何进程）`)
      setState('DISCONNECTED', null, 'silence timeout')
    }
  }, OPT.windowTimeoutMs)
}

/* --------------------------------------------------- v2 能力门控与载荷转发
   宿主**逐项能力门控**：老宿主不会声明、也不会下发这些字段。
   纪律：① 只转发"真的收到"的字段，**绝不补默认值**（不造 done/total）；
        ② progress.applicable===false → 不下发 done/total（宿主刻意如此，下游也不可能画成 0%）；
        ③ 子代理节点**没有百分比子字段**（协议里不存在），节点上不许画条。 */
/* 窗口**声明**自己要消费的能力（宿主 src/protocol.js 的 Capability 名字）。
   纪律：**只声明真的会渲染的**（多声明会收到处理不了的东西）。
   本窗口渲染：progress（计划进度条）/ subagents（子代理树）/ sessions（多对话列表）。
   ⚠️ metrics 与 context **不是能力名**：metrics 随 progress 一起下发；context 本轮不渲染，故不声明。
   不声明 ⇒ 宿主按 v1 逐字节发（老窗口行为），窗口这边什么都不缺。 */
/* ⚠️ 只声明**已经端到端验证会渲染**的能力（纪律：声明了就必须看得见）。
   todos/cost/context/text 的实现已落地，但面板端到端验证未通过（测试里面板没能打开）
   ⇒ 暂时不声明；验证通过后再加回这四项。 */
const DECLARED_CAPABILITIES = ['progress', 'subagents', 'sessions', 'todos', 'cost', 'context', 'text']
/* 入站 v2 字段名（全部出现在 state 载荷里，**不是独立 kind**） */
const V2_STATE_FIELDS = ['progress', 'metrics', 'subagents', 'sessions', 'todos', 'cost', 'context', 'tokens']
let caps = { progress: false, subagents: false, sessions: false }
let v2 = { progress: null, subagents: null, sessions: null, metrics: null }
/* progress 纪律：applicable!==true 时**剥掉 done/total**（宿主本就刻意不发；万一带了也绝不画成 0%） */
function cleanProgress (p) {
  if (!p || typeof p !== 'object') return p
  if (p.applicable !== true && (p.done !== undefined || p.total !== undefined)) {
    log('progress.applicable!=true 但仍带 done/total → 按纪律剥除（不画条）')
    const c = Object.assign({}, p); delete c.done; delete c.total; return c
  }
  return p
}
/* 子代理树的行命中（**主进程 40ms 轮询屏幕光标**，不依赖 DOM 事件） */
let treeRows = []
let hotRow = null
let rowLeaveAt = 0
const ROW_LEAVE_GRACE_MS = 350
function rowAt (cy) {
  for (const r of treeRows) if (cy >= r.y0 && cy < r.y1) return r.id
  return null
}
function resetRows (why) {
  if (treeRows.length) log('tree rows cleared（' + why + '）')
  treeRows = []; hotRow = null; rowLeaveAt = 0
}

/* -------------------------------------------------------------- text 通道
   ⚠️ 2026-09-20 实测修（用户真实日志 helper.log.1：连续流式期 **6.17 条/秒**，每一条都被丢）：
   这里原来只认 `msg.text`（**嵌套对象**）：
     · 宿主 src/index.js:308 走的是 `createMessage(MessageKind.TEXT, {revision, ...payload})`，
       而 `createMessage()` 会把 payload **平铺到顶层**（src/protocol.js `stripReserved`），
       `validatePayload` 也按**顶层**校验（`message.revision` / `message.thoughtTail`）；
     · 于是宿主发的永远是扁平形状 ⇒ 这个分支**每一条都走 else**，面板「思考文本」永远拿不到内容。
   两侧各自绿、合起来是空的：宿主测试校验扁平 ✓，窗口测试（v2-fields.mjs 旧版）自己造了嵌套形状 ✓
   ⇒ 谁都没在测"真实配对"。
   那条 WARN 不是噪声，是**真故障的报警**；6.17 条/秒正好等于宿主 `TEXT_THROTTLE_MS=160` 的节拍
   （p50 间隔实测 162ms）⇒ 意味着**100% 丢失率**，而不是偶发丢包。

   纪律（本次的判据）：**"没有输出"必须能和"出故障"区分开**，所以分三种情形，一个都不静默：
     ① 有内容（**扁平为权威**；嵌套是历史脚手架形状，容忍但留痕）→ 正常转发；
     ② 合法但没有文本（宿主刻意只发 revision，"本轮没有可发文本"）→ 转发空载荷，
        渲染层显示**"等待数据"**（不是故障）；**不告警**（否则又是一条 6 次/秒的噪声）；
     ③ 字段类型非法 / revision 非法 → 转发 degraded，渲染层显示**"思考文本不可用（原因）"**，
        并**限流**留痕（5s 一条 + 如实补报被抑制的条数）。 */
const TEXT_FIELDS = ['activityText', 'thoughtTail', 'bodyTail']
const TEXT_DIAG_MIN_MS = 5000
let textDiagAt = 0
let textDiagSuppressed = 0
let textEmptyStreak = false
function textDiag (why) {
  const now = Date.now()
  if (now - textDiagAt < TEXT_DIAG_MIN_MS) { textDiagSuppressed += 1; return }
  const tail = textDiagSuppressed > 0 ? '（此前同类已抑制 ' + textDiagSuppressed + ' 条）' : ''
  textDiagAt = now; textDiagSuppressed = 0
  log('WARN text ' + why + tail)
}
function handleTextMessage (msg) {
  const nested = msg.text !== undefined && msg.text !== null && typeof msg.text === 'object'
  const src = nested ? msg.text : msg
  const revision = Number.isFinite(src.revision) ? src.revision : undefined
  const fields = {}
  const bad = []
  for (const field of TEXT_FIELDS) {
    const value = src[field]
    if (value === undefined || value === null) { fields[field] = undefined; continue }
    if (typeof value === 'string') { fields[field] = value; continue }
    bad.push(field + ' 是 ' + typeof value)          /* 类型非法：绝不当字符串用（宁可缺，不可假） */
    fields[field] = undefined
  }
  if (bad.length || revision === undefined) {
    /* ③ 降级：明确说出来。revision 非法 ⇒ force 让渲染层至少能把降级态画出来。 */
    const reason = bad.length ? bad.join('、') : 'revision 非法（' + JSON.stringify(src.revision) + '）'
    sendToRenderer({ kind: 'text', revision: revision, force: true, degraded: reason,
      activityText: undefined, thoughtTail: undefined, bodyTail: undefined })
    textDiag(reason + ' ⇒ 已按降级转发，面板显示"思考文本不可用"')
    return
  }
  sendToRenderer({ kind: 'text', revision: revision, force: false, degraded: null,
    activityText: fields.activityText, thoughtTail: fields.thoughtTail, bodyTail: fields.bodyTail })
  const empty = fields.activityText === undefined && fields.thoughtTail === undefined && fields.bodyTail === undefined
  if (empty) {
    /* ② 宿主的真空形态：不是故障，但也不静默 —— 渲染层画的是"等待数据"，这里只留一条转变痕迹 */
    if (!textEmptyStreak) { textEmptyStreak = true; log('text 空载荷（宿主本轮无可发文本）⇒ 渲染层显示"等待数据"（区分于故障）') }
    return
  }
  textEmptyStreak = false
  log('text -> renderer revision=' + JSON.stringify(revision) +
    (nested ? '（嵌套形状：宿主实际发扁平，仅兼容保留）' : ''))
}

/* ------------------------------------------------------------------ stdio */
function handleMessage (msg) {
  if (!msg || typeof msg !== 'object') { ipcStats.bad++; log('WARN non-object message, ignored'); return }
  const kind = msg.kind
  ipcStats.kinds[kind] = (ipcStats.kinds[kind] || 0) + 1
  switch (kind) {
    case 'state':
      setState(msg.state, msg, 'state')
      break
    case 'pulse':
      if (msg.state && normalizeState(msg.state) && curState === 'DISCONNECTED') {
        setState(msg.state, msg, 'pulse-recover')
      } else if (msg.state && normalizeState(msg.state) && msg.state !== curState) {
        setState(msg.state, msg, 'pulse')
      }
      break
    case 'config':
      applyConfigMessage(msg)
      break
    case 'text':
      handleTextMessage(msg)
      break
    case 'shutdown':
      log('shutdown received -> exit')
      gracefulExit(0)
      break
    /* v2：**没有独立 kind**，新字段全部随 state 载荷进来（见 setState） */
    default:
      log('WARN unknown kind=' + JSON.stringify(kind) + ' ignored')
  }
}
function applyConfigMessage (msg) {
  /* 自愈：宿主回发的 config 现在已带上 includeSubagents（宿主已改）；即便某天又不带，
     这里也每次顺带重读磁盘顶层对齐勾选态（消息里带该键时以消息为准，见下方分支）。 */
  try {
    if (msg.includeSubagents === undefined && !(msg.window && msg.window.includeSubagents !== undefined)) {
      const disk = readDiskConfig()
      if (disk && typeof disk.includeSubagents === 'boolean') setIncludeSubagents(disk.includeSubagents, 'config 顺带重读磁盘')
    }
  } catch (e) { log('config 重读磁盘失败: ' + (e && e.message)) }
  const patch = {}
  if (msg.scale !== undefined) patch.scale = nearest(msg.scale, SCALES, cfg.scale)
  if (msg.opacity !== undefined) patch.opacity = nearest(msg.opacity, OPACITIES, cfg.opacity)
  if (msg.alwaysOnTop !== undefined) patch.alwaysOnTop = !!msg.alwaysOnTop
  if (msg.clickThrough !== undefined) patch.clickThrough = !!msg.clickThrough
  /* includeSubagents：只更新内存标志（不并入窗口配置，也不落盘） */
  if (msg.includeSubagents !== undefined || (msg.window && msg.window.includeSubagents !== undefined)) {
    const v = msg.includeSubagents !== undefined ? msg.includeSubagents : msg.window.includeSubagents
    if (typeof v === 'boolean') setIncludeSubagents(v, 'host config')
    else log('config: includeSubagents 必须是布尔值，已忽略 ' + JSON.stringify(v))
  }
  if (msg.fps !== undefined) {
    const f = cleanFps(msg.fps)
    if (f) patch.fps = f
    else log('config: 非法 fps 值被忽略 ' + JSON.stringify(msg.fps))
  }
  /* ⚠️ profile 单独变化时**必须重算 fps**：cleanWindow 里 w.fps 一直存在（旧值），
     所以只给 profile 的话旧的 fps 会一直赢 —— 这是"改了档位但帧率没变"的根因。 */
  {
    /* ⚠️ 两种包裹形态都要认（宿主可能发扁平的 profile，也可能发 window.profile）——
       探针实测：只认 msg.profile 时 {window:{profile:'eco'}} 下 cfg.fps 不会变。 */
    const profIn = msg.profile !== undefined ? msg.profile : (msg.window ? msg.window.profile : undefined)
    const fpsIn = msg.fps !== undefined ? msg.fps : (msg.window ? msg.window.fps : undefined)
    if (profIn !== undefined && fpsIn === undefined && PROFILES.indexOf(profIn) >= 0) {
      patch.profile = profIn
      patch.fps = PROFILE_TO_FPS[profIn]
      log('config: profile=' + profIn + ' 且未给 fps → fps 派生为 ' + patch.fps)
    }
  }
  /* 窗口键：profile / panelAlpha / hoverPlate / hoverRows / hoverBar / panelDetail */
  for (const [k, list] of [['profile', PROFILES], ['hoverPlate', HOVER_PLATES], ['hoverRows', HOVER_ROWS], ['hoverBar', HOVER_BARS], ['panelDetail', PANEL_DETAILS]]) {
    const v = msg[k] !== undefined ? msg[k] : (msg.window ? msg.window[k] : undefined)
    if (v === undefined) continue
    if (list.indexOf(v) >= 0) patch[k] = v
    else log('config: 非法 ' + k + ' 值被忽略 ' + JSON.stringify(v))
  }
  {
    const a = msg.panelAlpha !== undefined ? msg.panelAlpha : (msg.window ? msg.window.panelAlpha : undefined)
    if (a !== undefined) {
      const n = numberOr(a, cfg.panelAlpha, 0.5, 1.0)
      if (n !== cfg.panelAlpha) patch.panelAlpha = n
    }
  }
  if (msg.position && Number.isFinite(Number(msg.position.x)) && Number.isFinite(Number(msg.position.y))) {
    patch.position = { x: Math.round(Number(msg.position.x)), y: Math.round(Number(msg.position.y)) }
  }
  if (!Object.keys(patch).length) { log('config: no known field, ignored'); return }
  log('config <- ' + JSON.stringify(patch))
  applyWindowConfig(Object.assign({}, cfg, patch), false)
}
function applyWindowConfig (next, persist) {
  const prev = cfg
  cfg = cleanWindow(Object.assign({}, cfg, next))
  /* 诊断（用户要求实测值，不许看代码推）：证明 profile/fps 到底变成了什么 */
  log('config apply: next.fps=' + JSON.stringify(next && next.fps) + ' next.profile=' + JSON.stringify(next && next.profile) +
    ' -> cfg.fps=' + JSON.stringify(cfg.fps) + ' cfg.profile=' + JSON.stringify(cfg.profile))
  if (persist) saveWindowPatch({ scale: cfg.scale, opacity: cfg.opacity, alwaysOnTop: cfg.alwaysOnTop, clickThrough: cfg.clickThrough, position: cfg.position, fps: cfg.fps, profile: cfg.profile, panelAlpha: cfg.panelAlpha, hoverPlate: cfg.hoverPlate, hoverRows: cfg.hoverRows, hoverBar: cfg.hoverBar, panelDetail: cfg.panelDetail })

  if (cfg.scale !== prev.scale && win && !win.isDestroyed()) {
    const b = win.getBounds()
    const centerX = b.x + geo.cx, centerY = b.y + geo.cy       /* 缩放时保住圆心 */
    geo = computeGeo(cfg.scale, panelOpen)                     /* 面板开着就按开着算 */
    const np = clampToDisplay(centerX - geo.cx, centerY - geo.cy, geo.w, geo.h)
    win.setBounds({ x: np.x, y: np.y, width: geo.w, height: geo.h })
    if (panelOpen) sendToRenderer(panelMsg(true))              /* 让渲染层跟上新几何 */
    log('scale -> ' + cfg.scale + ' bounds=' + JSON.stringify(win.getBounds()))
  }
  if (win && !win.isDestroyed()) {
    /* 透明度只走渲染层 body opacity（避免 Windows 分层窗口与 setOpacity 叠加成 opacity²） */
    try { win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver') } catch { /* ignore */ }
  }
  sendToRenderer({ kind: 'metrics', svgSize: geo.svgSize, pad: geo.pad, opacity: cfg.opacity, scale: cfg.scale })
  sendToRenderer(panelMsg(panelOpen))   /* 面板几何（含 --icon-win）每次都给渲染层一份 */
  const fpsNow = resolveFps(cfg.fps)
  sendToRenderer({ kind: 'fps', value: fpsNow })
  /* 任务 B：悬浮层三行文字的开合（'off' 默认 = 删掉）。渲染层不认 window 配置对象那条死代码路径
     （`v2ApplyWindow` 从未被调用过，宿主的 hoverPlate 就是这么"到不了"的），
     所以这里用一条与 fps 同族的**显式**消息，确保它真的到得了渲染层。 */
  sendToRenderer({ kind: 'hover-rows', value: cfg.hoverRows })
  /* 任务 C：悬浮层那根横向计划进度条的开合（'off' 默认 = 去掉）。与上面同族、同样显式下发。 */
  sendToRenderer({ kind: 'hover-bar', value: cfg.hoverBar })
  if (JSON.stringify(fpsNow) !== JSON.stringify(prevFps)) { log('fps -> ' + JSON.stringify(fpsNow)); prevFps = fpsNow }
  applyClickThrough()
}

let stdinBuf = ''
function handleLine (line) {
  if (!line.trim()) return                                       /* 空行：忽略，不记日志 */
  ipcStats.lines++
  let msg
  try { msg = JSON.parse(line) } catch (e) {
    ipcStats.bad++
    log('WARN unparsable line ignored (' + e.message + '): ' + line.slice(0, 200))
    return                                                       /* 坏 JSON：记日志 + 忽略，绝不崩 */
  }
  try { handleMessage(msg) } catch (e) {
    log('WARN handler threw, ignored: ' + (e && e.stack ? e.stack : e))
  }
  resetSilenceTimer()
}
function feedChunk (chunk) {
  stdinBuf += chunk
  let idx
  while ((idx = stdinBuf.indexOf('\n')) >= 0) {
    handleLine(stdinBuf.slice(0, idx).replace(/\r$/, ''))
    stdinBuf = stdinBuf.slice(idx + 1)
  }
}

/* Windows 实测三个坑（都真跑过，见 test/probe-stdin.js）：
 *   1. Electron 主进程的 process.stdin 在「父进程管道」下会立刻 end（假 EOF）—— 不能用；
 *   2. 直接 fs.readSync(0) / fs.createReadStream(fd:0) 能读到数据，但它在 libuv 线程池里挂着一个
 *      未完成的读，process.exit() 之后进程**不会退出**（退出码也拿不到 0）；
 *   3. 把 fd 0 包成 libuv 流 new net.Socket({fd:0}) —— 能读、且能干净退出（实测 exit=0，无残留进程）。
 * 所以主路径用 3。 */
let stdinSock = null
function startStdin () {
  try {
    const net = require('node:net')
    stdinSock = new net.Socket({ fd: 0, readable: true, writable: false })
    stdinSock.setEncoding('utf8')
    stdinSock.on('data', feedChunk)
    stdinSock.on('end', () => { log('stdin EOF -> parent gone, exit'); gracefulExit(0) })
    stdinSock.on('close', () => { if (!exiting) { log('stdin closed -> exit'); gracefulExit(0) } })
    stdinSock.on('error', (e) => log('WARN stdin error: ' + e.message))
    log('stdin attached via net.Socket(fd 0) (windowTimeoutMs=' + OPT.windowTimeoutMs + ')')
    return
  } catch (e) { log('WARN net.Socket(fd0) unavailable (' + e.message + '), falling back to process.stdin') }
  /* 直接双击/命令行启动时 stdin 可能是控制台或文件（不是管道）：这种情况没有宿主通道，
     不能把 EOF 当成"父进程死了"，否则一启动就自杀。 */
  let isPipe = false
  try { isPipe = fs.fstatSync(0).isFIFO() } catch { isPipe = false }
  if (!isPipe) {
    log('stdin is not a pipe (直接启动，无宿主通道)；不挂 EOF 退出，等待看门狗兜底')
    return
  }
  try {
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', feedChunk)
    process.stdin.on('end', () => { log('stdin EOF -> parent gone, exit'); gracefulExit(0) })
    process.stdin.on('error', (e) => log('WARN stdin error: ' + e.message))
    process.stdin.resume()
    log('stdin attached via process.stdin (windowTimeoutMs=' + OPT.windowTimeoutMs + ')')
  } catch (e) { log('WARN stdin attach failed: ' + e.message) }
}

/* ------------------------------------------------------------------ 右键菜单 */
function applySetting (key, value) {
  /* includeSubagents 是插件级配置，持久化权在宿主（顶层键）：
     窗口侧只改内存标志 + 发 setting 回传，**不写自己的 config.json**。 */
  if (key === 'includeSubagents') {
    setIncludeSubagents(value === true, 'menu')
    out('setting', { key: 'includeSubagents', value: value === true })
    log('setting -> host includeSubagents=' + (value === true))
    return
  }
  const patch = {}
  patch[key] = value
  const before = JSON.stringify(cfg)
  applyWindowConfig(Object.assign({}, cfg, patch), true)
  if (JSON.stringify(cfg) === before) return
  /* SPEC 第 5 节：菜单改设置回传宿主持久化。
     key 用宿主白名单里的命名：window.scale / window.opacity / window.alwaysOnTop /
     window.clickThrough / window.position / window.fps（宿主按点号路径合并落盘）。
   例外：includeSubagents 是**插件级**配置（不是窗口偏好），所以用扁平键发（与宿主 SETTABLE_TOP_LEVEL_KEYS 对齐）。 */
  /* 插件级配置用扁平键（宿主 SETTABLE_TOP_LEVEL_KEYS = ['includeSubagents']）；其余窗口偏好用 window.* */
  const wireKey = TOP_LEVEL_SETTING_KEYS[key] || ('window.' + key)
  /* 根治：includeSubagents 的**唯一合法出口是菜单点击**（applySetting 里已单独处理并留痕）。
     通用路径曾把窗口内存里的初始 false 推给宿主 ⇒ 把宿主侧的 true 翻回 false（用户症状）。
     这里显式排除它，并留痕（这条路径原来完全静默）。 */
  /* 根治：includeSubagents 只允许由**菜单点击**那条出口发出（applySetting 里已单独处理）。
     通用路径曾可能把它推给宿主（把宿主侧的 true 翻回 false）。这里**只过滤这一条**：
     用条件发送而不是 return —— 免得把同一函数后面的逻辑（清除错误 / drag-end / 位置落盘）一起跳过。 */
  if (key === 'includeSubagents') { log('setting 抑制：includeSubagents 只允许菜单点击发出，通用路径不推') }
  else out('setting', { key: wireKey, value })
  log('setting -> host ' + wireKey + '=' + JSON.stringify(value))
}
/* ------------------------------------------------------------------ 清除错误状态（"人处理了"的出口）
   语义：用户点了图标 / 选了菜单 = 他去看这个问题了 = 视为已处理。
   ⚠️ 键是**扁平**的 `work-icon.clearError`（宿主在配置白名单之前拦截，不落盘、不改 config.json）。
   ⚠️ 窗口侧**不做任何本地清除**：发完就等宿主回发的 state 驱动显示（单一真相源）。 */
function requestClearError (why) {
  out('setting', { key: 'work-icon.clearError', value: true })
  log('clearError -> host（' + why + '；本地不清，等宿主 state）')
}
/* 旧的 onActivate（单击 = 聚焦 DSH）已按用户决定移除 —— 单击不再触发任何聚焦，见 onIconClick()。 */
/* 菜单模板**单独一个函数**：showMenu 用它弹菜单，测试钩子也用它（--test-open-settings 直接取模板里那一项的
   click 来调 —— 走的就是用户点菜单时那条路，不是另开旁路）。 */
function buildMenuTemplate () {
  return [
    { label: '尺寸', enabled: false },
    ...SCALES.map((s) => ({ label: '  ' + s + ' px', type: 'radio', checked: cfg.scale === s, click: () => applySetting('scale', s) })),
    { type: 'separator' },
    { label: '透明度', enabled: false },
    ...OPACITIES.map((o) => ({ label: '  ' + o + '%', type: 'radio', checked: cfg.opacity === o, click: () => applySetting('opacity', o) })),
    { type: 'separator' },
    { label: '流畅度', enabled: false },
    ...Object.keys(FPS_PRESETS).map((p) => ({
      label: '  ' + FPS_LABELS[p] + '（' + FPS_PRESETS[p].idle + '/' + FPS_PRESETS[p].working + ' fps）',
      type: 'radio',
      checked: cfg.fps === p,
      click: () => applySetting('fps', p)
    })),
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: cfg.alwaysOnTop, click: (i) => applySetting('alwaysOnTop', i.checked) },
    { label: '鼠标穿透（圆外）', type: 'checkbox', checked: cfg.clickThrough, click: (i) => applySetting('clickThrough', i.checked) },
    { label: '跟随子代理', type: 'checkbox', checked: includeSubagents, click: (i) => applySetting('includeSubagents', i.checked) },
    { type: 'separator' },
    /* 任务 F：打开**独立的**配色设置窗口（普通窗口）。它只改窗口侧主题（theme.json），
       不碰宿主的 config.json，也不改图标窗口的几何/置顶/穿透。 */
    { label: '配色设置…', click: () => openSettingsWindow() },
    { type: 'separator' },
    /* 平时置灰（不藏起来，避免菜单高度跳变）；只有真正处于 ERROR 时才可点 */
    { label: '清除错误状态', enabled: curState === 'ERROR', click: () => requestClearError('menu') },
    { type: 'separator' },
    { label: '退出', click: () => { out('closed', { reason: 'menu-exit' }); gracefulExit(0) } }
  ]
}
function showMenu () {
  if (!win || win.isDestroyed()) return
  const wasFocusable = win.isFocusable()
  try { win.setFocusable(true) } catch { /* ignore */ }
  const tpl = buildMenuTemplate()
  const menu = Menu.buildFromTemplate(tpl)
  menu.popup({
    window: win,
    callback: () => {
      try { win.setFocusable(wasFocusable) } catch { /* ignore */ }
      log('menu closed, focusable restored=' + wasFocusable)
    }
  })
  log('menu popped items=' + tpl.filter((i) => i.label && i.type !== 'separator').length)
}

/* ------------------------------------------------------------------ 点击：**已取消"聚焦 DSH"**
   用户 2026-09-12 决定：在可拖动元素上，单击本身就是有歧义的（点击 vs 拖动起点），
   所以单击**什么都不做**（完整地留给拖动），开关大面板改用**双击**。
   这里保留的唯一动作是 ERROR 态的"人处理了"确认（用户点图标 = 他去看这个问题了）。
   注：focus-dsh.ps1 与 focusDsh() 已一并移除，脚本文件保留在磁盘上但不再被调用。 */
function onIconClick () {
  log('click on icon（单击：不聚焦、不切面板 —— 单击保留给拖动）')
  if (curState === 'ERROR') requestClearError('click on ERROR icon')
}

/* 注：原 focusDsh()（调 focus-dsh.ps1 激活 DSH 窗口）已按用户决定移除；
   focus-dsh.ps1 文件保留在磁盘上但**不再被任何代码调用**。 */

/* ------------------------------------------------------------------ IPC */
ipcMain.on('log', (_e, m) => {
  const s = String(m)
  if (s.includes('mousedown')) rendererDowns++
  log('renderer: ' + s)
})
ipcMain.on('fps', (_e, n, avg, drv) => { frames += n; log(`fps=${Number(avg).toFixed(1)} rAF=${n} drvUpdates=${drv == null ? 'n/a' : drv} state=${curState}`) })
ipcMain.on('painted', () => {
  log('first_paint_ms=' + (Date.now() - PROC_T0) + ' hwnd=' + hwndHex())
  if (OPT.emitHwnd) out('debug', { hwnd: hwndHex() })
  /* 渲染层就绪后补发一次几何 + 帧率：启动时那次下发发生在页面加载完成之前会丢，
     补发同时覆盖「宿主 config 早于页面加载」的情况，保证最终一定生效。 */
  sendToRenderer({ kind: 'metrics', svgSize: geo.svgSize, pad: geo.pad, opacity: cfg.opacity, scale: cfg.scale })
  sendToRenderer(panelMsg(panelOpen))   /* 面板几何（含 --icon-win）每次都给渲染层一份 */
  /* 窗口侧主题（theme.json）在渲染层就绪后再下发一次：启动那一次可能早于页面加载完成。
     与窗口几何/帧率那条补发同理，**不落盘**（why='startup' 只推送）。 */
  sendTheme('startup')
  const fpsAtReady = resolveFps(cfg.fps)
  sendToRenderer({ kind: 'fps', value: fpsAtReady })
  /* 任务 B：渲染层就绪后再发一次（applyWindowConfig 可能早于渲染层挂上监听器而丢失） */
  sendToRenderer({ kind: 'hover-rows', value: cfg.hoverRows })
  /* 任务 C：同上，补发一次横向计划进度条开关 */
  sendToRenderer({ kind: 'hover-bar', value: cfg.hoverBar })
  /* 渲染层就绪后重发 test-hover：初次发送可能早于渲染层挂上监听器而丢失 */
  if (OPT.testHover) { sendToRenderer({ kind: 'test-hover', on: String(OPT.testHover) === 'on' }); log('test-hover 重发（renderer ready）') }
  /* 测试/截图/隐藏模式：让渲染层开启错误通道（生产不带这些参数 ⇒ 不可达） */
  if (SHOT || OPT.hidden || OPT.testScript) { sendToRenderer({ kind: 'test-mode', on: true, shotPayload: !!OPT.shotPayload, burst: OPT.shotBurst || null }); log('test-mode -> 渲染层错误通道（shotPayload=' + !!OPT.shotPayload + '）') }
  /* 截图专用：渲染层就绪后喂真实载荷（只走已有的 state/text 转发路径，不新增协议 kind） */
  if (OPT.shotPayload) {
    try {
      const pl = JSON.parse(fs.readFileSync(OPT.shotPayload, 'utf8'))
      const st = Object.assign({ protocolVersion: 2, kind: 'state' }, pl.state || {})
      sendToRenderer(st)
      log('shot-payload 已喂 state（keys=' + Object.keys(st).join(',') + '）')
      if (pl.text) { sendToRenderer(Object.assign({ kind: 'text' }, pl.text)); log('shot-payload 已喂 text') }
    } catch (e) { log('WARN shot-payload 读取失败: ' + e.message) }
  }
  log('renderer ready -> fps ' + JSON.stringify(fpsAtReady))
  if (SHOT) setTimeout(captureShot, OPT.settleMs)
  if (OPT.transTest) setTimeout(() => runTransTest(String(OPT.transTest)), 600)
})
ipcMain.on('drag-by', (_e, dx, dy) => {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const np = clampToDisplay(b.x + dx, b.y + dy, b.width, b.height)
  dragByCount++
  if (dragByCount <= 4) log(`drag-by ${dx},${dy} -> (${np.x},${np.y})`)
  win.setPosition(np.x, np.y)
})
ipcMain.on('drag-end', () => {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  saveWindowPatch({ position: { x: b.x, y: b.y } })
  out('setting', { key: 'window.position', value: { x: b.x, y: b.y } })   /* 同步给宿主，避免被宿主回写覆盖 */
  log('drag-end -> position (' + b.x + ',' + b.y + ')')
})
ipcMain.on('activate', onIconClick)
ipcMain.on('toggle-panel', () => setPanel(!panelOpen, 'double-click'))
ipcMain.on('menu', () => showMenu())
/* 渲染进程把**面板可见矩形的真实布局**（#plate.getBoundingClientRect()，窗口局部 CSS px）报上来。
   命中区用它而不是用窗口矩形 —— 两者的差别正是"面板周围的透明角会不会开始吃鼠标"。
   窗口/面板尺寸一改（缩放、几何变化）渲染层会重报；收起时主进程自己清空，不等这一条。 */
ipcMain.on('panel-hitrect', (_e, r) => {
  const n = normRect(r)
  if (!n) { log('WARN panel-hitrect 载荷非法: ' + JSON.stringify(r)); return }
  panelHitRect = n
  log('panel hitrect <- dom ' + JSON.stringify({ left: Math.round(n.left), top: Math.round(n.top), right: Math.round(n.right), bottom: Math.round(n.bottom) }))
})
  /* 渲染进程把"树的行带"报上来（窗口内 CSS px），主进程据此做行命中 */
  ipcMain.on('tree-rows', (_e, rows) => {
    if (!Array.isArray(rows)) { resetRows('非法载荷'); return }
    treeRows = rows
      .filter((r) => r && typeof r.id === 'string' && Number.isFinite(Number(r.y0)) && Number.isFinite(Number(r.y1)))
      .map((r) => ({ id: r.id, y0: Number(r.y0), y1: Number(r.y1) }))
    log('tree rows <- ' + treeRows.length + ' 行' + (treeRows.length ? '：' + treeRows.map((r) => r.id).join(',') : ''))
  })

/* ------------------------------------------------------------------ 300ms 交叉淡入取证：切换途中抓帧 */
async function runTransTest (dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const shot = async (name) => {
      const img = await win.capturePage()
      const f = path.join(dir, name + '.png')
      fs.writeFileSync(f, img.toPNG())
      process.stdout.write('TRANS ' + name + ' ' + img.getSize().width + 'x' + img.getSize().height + ' ' + f + '\n')
      log('trans-shot ' + name + ' -> ' + f)
    }
    sendToRenderer({ kind: 'state', state: 'IDLE' })
    await sleep(700); await shot('a-idle')
    sendToRenderer({ kind: 'state', state: 'WORKING' })
    await sleep(80); await shot('b-mid080')
    await sleep(120); await shot('c-mid200')
    await sleep(300); await shot('d-work500')
    sendToRenderer({ kind: 'state', state: 'ERROR' })
    await sleep(120); await shot('e-err120')
    await sleep(300); await shot('f-err420')
  } catch (e) { log('WARN trans-test failed: ' + e.message) } finally { gracefulExit(0) }
}

function hwndHex () {
  try {
    const h = win.getNativeWindowHandle()
    if (typeof h.readBigUInt64LE === 'function') return '0x' + h.readBigUInt64LE(0).toString(16)
    return '0x' + h.toString('hex')
  } catch { return 'n/a' }
}

/* ------------------------------------------------------------------ 抓图（隐藏窗口离屏渲染，不弹窗）
   --out 是目录时：把 --shot-states 里每个状态各抓一张；--out 以 .png 结尾时只抓 --state 一张。 */
async function captureShot () {
  const dst = OPT.out ? path.resolve(String(OPT.out)) : path.join(HERE, 'test', 'out', 'shot.png')
  const single = /\.png$/i.test(dst)
  const list = single
    ? [OPT.state]
    : String(arg('shot-states', STATES.join(','))).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  try {
    if (!single) fs.mkdirSync(dst, { recursive: true })
    for (const st of list) {
      sendToRenderer({ kind: 'state', state: st })
      await sleep(single ? OPT.settleMs : Math.max(260, OPT.settleMs))
      const img = await win.capturePage()
      const sz = img.getSize()
      const file = single ? dst : path.join(dst, `shot-${st}-${OPT.shot}-${OPT.bg}.png`)
      fs.writeFileSync(file, img.toPNG())
      log(`captured ${st} ${sz.width}x${sz.height} empty=${img.isEmpty()} -> ${file}`)
      process.stdout.write('SHOT ' + st + ' ' + sz.width + 'x' + sz.height + ' ' + file + '\n')
    }
  } catch (e) {
    log('WARN capturePage failed: ' + e.message)
    process.stdout.write('SHOT-FAIL ' + e.message + '\n')
  } finally { gracefulExit(0) }
}

/* ------------------------------------------------------------------ 退出 */
let exiting = false
function gracefulExit (code) {
  if (exiting) return
  exiting = true
  log('exit code=' + code + ' uptime_ms=' + (Date.now() - PROC_T0) + ' stdin_lines=' + ipcStats.lines +
      ' bad_lines=' + ipcStats.bad + ' kinds=' + JSON.stringify(ipcStats.kinds) +
      ' state_switches=' + ipcStats.stateSwitches + ' rAF_frames=' + frames)
  if (silenceTimer) clearTimeout(silenceTimer)
  if (mouseTimer) clearInterval(mouseTimer)
  if (successTimer) clearTimeout(successTimer)
  /* 先摘掉 stdin 监听再退，避免收尾途中又触发新的退出路径 */
  try { if (stdinSock) { stdinSock.removeAllListeners(); stdinSock.destroy() } } catch { /* ignore */ }
  /* SPEC 第 10 节：真窗口不得在用户屏幕上多留一秒 —— 先 hide（立刻从屏幕消失）再 destroy，
     最后才 exit；这样即使 destroy/exit 卡住，画面也已经清掉了。 */
  try { if (probeWin && !probeWin.isDestroyed()) probeWin.hide() } catch { /* ignore */ }
  try { if (win && !win.isDestroyed()) win.hide() } catch { /* ignore */ }
  try { if (topTimer) clearInterval(topTimer) } catch { /* ignore */ }
  log('windows hidden, destroying')
  try { if (probeWin && !probeWin.isDestroyed()) probeWin.destroy() } catch { /* ignore */ }
  try { if (win && !win.isDestroyed()) win.destroy() } catch { /* ignore */ }
  try { app.exit(code) } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 300)
}

/* ------------------------------------------------------------------ 启动 */
/* 内存/CPU：GPU 合成进程是内存大头之一。默认保留硬件加速（视觉优先），
   以下开关用于 SPEC 第 8 节第 4 款的性能实验（见 README 性能章节）。 */
if (FLAG('no-gpu')) app.disableHardwareAcceleration()
if (FLAG('no-gpu-compositing')) app.commandLine.appendSwitch('disable-gpu-compositing')
if (FLAG('single-process')) { app.commandLine.appendSwitch('single-process'); app.commandLine.appendSwitch('no-zygote') }
if (arg('js-flags', null)) app.commandLine.appendSwitch('js-flags', String(arg('js-flags', '')))
if (arg('renderer-flags', null)) app.commandLine.appendSwitch('renderer-cmd-prefix', String(arg('renderer-flags', '')))
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

/* ------------------------------------------------------------------ 实例隔离（生产事故 2026-09-12 的加固）
   把 Electron 的 userData 钉在 `HOME/userdata`：
     · 生产：%USERPROFILE%\.dsh\work-icon\userdata —— 与 `%APPDATA%\Electron`、`dsh-ark-core-*`
       等其它 Electron 应用彻底分开，各用各的 profile / 单实例命名空间；
     · 测试：harness 会给每个用例传独立 `--home <临时目录>`，于是 userData 天然隔离，
       而且这个路径会出现在**子进程命令行**里（Chromium 会把 --user-data-dir 传给 GPU/渲染/工具进程），
       成为"只杀自己这一轮"的可靠标记。
   注意：本运行时**没有** requestSingleInstanceLock —— 多实例共存是允许的（生产一个、测试一个互不干扰）。 */
try {
  app.setPath('userData', path.join(HOME, 'userdata'))
} catch (e) { log('WARN setPath(userData) failed: ' + e.message) }

/* 离屏取证的时间轴开关（--test-timeline）——**必须定义在 app.whenReady().then(() => {…}) 之外**。
   踩过的坑（2026-09-13）：`app.whenReady().then(...)` 的回调一直开到本文件 1331 行才闭合，
   而 TEST_MARKERS 那一段写在回调**内部** ⇒ 把 HAS_TIMELINE 定义在 1154 行附近时，
   它其实落在回调的闭包里，`runExstyleProbe`（模块顶层函数）根本看不见它：
   运行时报 `ReferenceError: HAS_TIMELINE is not defined`，被 unhandledRejection 吞掉，
   **exstyle 取证段整段静默消失**（而 `node --check` 是绿的 —— 语法检查对这类"作用域错位"完全无效）。 */
const HAS_TIMELINE = argv.includes('--test-timeline')
/* 退出归属：默认由取证入口自己 gracefulExit，但以下情形退出权归时间轴（它跑完再退）——
   否则会出现"取证段比时间轴更早退出 ⇒ 时间轴的点一个都没跑、整轮证据空转"（实测过）。 */
let NO_AUTO_EXIT = HAS_TIMELINE

app.whenReady().then(() => {
  log(`electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} pid=${process.pid}`)
  log(`home=${HOME} log=${LOG_PATH} argv=${JSON.stringify(argv)}`)
  const d = screen.getPrimaryDisplay()
  log(`screens=${screen.getAllDisplays().length} primary=${d.size.width}x${d.size.height} scaleFactor=${d.scaleFactor} workArea=${JSON.stringify(d.workArea)}`)
  geo = SHOT ? shotGeo(Number(OPT.shot)) : computeGeo(cfg.scale)
  /* 启动时从 config.json **顶层**读一次 includeSubagents（宿主写的才是真值）；没有就 false */
  try {
    const disk = readDiskConfig()
    includeSubagents = disk.includeSubagents === true
    log('includeSubagents 启动值 = ' + includeSubagents + '（来自 config.json 顶层，缺失即 false）')
  } catch (e) { log('WARN 读顶层 includeSubagents 失败: ' + e.message) }

/* ============================ 会话生命周期：生产 vs 测试 ============================
   生产会话（宿主 spawn `args=['runtime/electron']`，argv=[]）**必须长活** —— 一直活到
   `shutdown` 消息或父进程 stdin EOF，绝不自行退出。

   血的教训（2026-09-12 生产事故）：上一版用"没传 --exit-after 就当测试会话"来兜底，
   于是生产的空参数启动被加了 20 秒自杀定时器，图标亮 20 秒就消失，且按 SPEC §10.3
   宿主不会重启它 → 图标永久消失。
   **判断"是不是测试"只能靠显式测试标记，绝不靠"有没有参数"。** */
const TEST_MARKERS = [
  'hidden', 'shot', 'shot-states', 'dwm-phase', 'wfp-probe', 'exstyle-probe', 'hit-test',
  'trans-test', 'test-drag', 'test-setting', 'fps-log', 'metrics-interval', 'emit-hwnd',
  'print-plan', 'grab-at', 'settle-ms', 'out', 'bg', 'spin', 'hide', 'label', 'probe',
  'idle-linear', 'renderer-flags', 'no-config', 'no-gpu', 'no-gpu-compositing',
  'single-process', 'js-flags', 'exit-after', 'fps', 'fps-json', 'test-timeline',
  'test-open-settings', 'test-theme-drive'
]
const testMarker = TEST_MARKERS.find((f) => FLAG(f) || arg(f, null) !== null)
const IS_TEST_SESSION = !!testMarker || FLAG('test-session')
/* SPEC 第 10 节第 5 条：必须真窗口的验证单次 ≤ 20 秒。只对**测试会话**生效。 */
const SHOWN_SESSION = !FLAG('hidden') && !SHOT
let exitAfterSec = OPT.exitAfter
let exitReason = OPT.exitAfter > 0 ? 'explicit --exit-after' : 'none'
if (SHOWN_SESSION && exitAfterSec > 20) {
  log('WARN --exit-after=' + exitAfterSec + 's 超过真窗口单次 20 秒上限，已钳制为 20s（SPEC 第 10 节第 5 条）')
  exitAfterSec = 20
  exitReason = 'clamped to 20s'
}
if (SHOWN_SESSION && IS_TEST_SESSION && !(exitAfterSec > 0)) {
  log('WARN 测试会话（标记：' + (testMarker || 'test-session') + '）未指定 --exit-after，加 20 秒兜底退出')
  exitAfterSec = 20
  exitReason = 'test-session fallback'
}
if (!IS_TEST_SESSION && exitAfterSec > 0) {
  log('WARN 生产会话指定了 --exit-after=' + exitAfterSec + 's：这会让图标自行消失，确认这是你要的吗')
}
if (exitAfterSec > 0) setTimeout(() => gracefulExit(0), exitAfterSec * 1000)
else if (exitReason === 'none') log('lifecycle: 生产会话，无自动退出定时器（活到 shutdown 或 stdin EOF）')

/* --test-timeline <ms,spec;ms,spec;…>：离屏取证的时间轴脚本（panel-hit.mjs 用）。
   与 --test-script 的分别：那个是宿主持有的渲染层钩子文件，这个是**本轮取证自己造**的时间轴；
   串行执行 + 结束才退出 ⇒ 不会像"两个取证入口同时 gracefulExit"那样把证据丢空。
   ⚠️ 定义在启动块之前（曾经写在后面 ⇒ 启动时报 "TEST_TIMELINE is not defined"，整轮证据为空）。 */
/* --test-timeline "ms,spec|ms,spec|…"：离屏取证的时间轴脚本（panel-hit.mjs 用）。
   · 分隔符：**步与步用 `|`**，步内用**第一个逗号**分开"绝对毫秒"和"探针 spec"——
     spec 里还会再出现逗号（屏幕坐标），所以必须 split(',', 2)，不能用 `;` 当步分隔符
     （实测踩过一次：9 步全被过滤成 0 步，整轮取证空转）。
   · 探针 spec 只认两种：`x,y`（屏幕坐标）或 `x,y,索引`。
   · 时间轴只负责**探测**；渲染层的鼠标脚本（开/关面板）走 --test-script，两者在同一个进程里共存。
   · 由模块顶层的 HAS_TIMELINE 判定（不在函数体里引用该 const：曾因作用域够不着报
     "TEST_TIMELINE is not defined"，把 exstyle 段整个打断）。 */
if (HAS_TIMELINE) {
  const specs = String(arg('test-timeline', '')).split('|').map((s) => s.trim()).filter(Boolean)
  log('TIMELINE 注册 ' + specs.length + ' 步：' + specs.join(' ').slice(0, 200))
  for (const item of specs) {
    const cut = item.indexOf(',')
    const ms = Math.max(0, Number(cut < 0 ? item : item.slice(0, cut)) || 0)
    const rest = cut < 0 ? '' : item.slice(cut + 1)
    /* 探针写法：
         `ms,x,y`        —— **窗口局部坐标**（0,0 = 窗口左上角；与 CSS px / 命中矩形同一坐标系）
         `ms,@x,y`       —— 屏幕绝对坐标（需要外部先知道窗口位置时用）
       窗口位置带位置记忆（config.json）⇒ 绝对坐标在不同轮次会漂，所以取证一律用局部坐标。 */
    const abs = rest.startsWith('@')
    const xy = (abs ? rest.slice(1) : rest).split(',').map(Number)
    setTimeout(() => {
      let r = null
      const b = win && !win.isDestroyed() ? win.getBounds() : null
      const px = xy.length >= 2 && xy.every(Number.isFinite) && b ? (abs ? xy[0] : b.x + xy[0]) : NaN
      const py = xy.length >= 2 && xy.every(Number.isFinite) && b ? (abs ? xy[1] : b.y + xy[1]) : NaN
      try { if (Number.isFinite(px) && Number.isFinite(py)) r = insideIcon(px, py) } catch (e) { log('WARN test-timeline 命中失败: ' + e.message) }
      out('debug', {
        phase: 'hit-test',
        at: ms,
        spec: item,
        local: xy.length >= 2 ? { x: xy[0], y: xy[1] } : null,
        absolute: abs,
        point: Number.isFinite(px) ? { x: px, y: py, dx: Math.round(px - (b.x + geo.cx)), dy: Math.round(py - (b.y + geo.cy)) } : null,
        inside: r ? r.inside : null,
        inCircle: r ? r.inCircle : null,
        inPanel: r ? r.inPanel : null,
        panelOpen: !!panelOpen,
        bounds: b ? { x: b.x, y: b.y } : null,
        rect: r ? r.rect : null
      })
    }, ms)
  }
  const last = specs.reduce((a, s) => { const c = s.indexOf(','); return Math.max(a, Number(c < 0 ? s : s.slice(0, c)) || 0) }, 0)
  setTimeout(() => gracefulExit(0), last + 900)
}

/* 干跑：只打印解析出的启动计划后立刻退出，**不创建窗口、不显示任何东西**。
   用环境变量触发是为了让 argv 保持与生产完全一致（argv=[]）也能取证。 */
const PLAN_DUMP = FLAG('print-plan') || process.env.DSH_WORK_ICON_PRINT_PLAN === '1'
if (PLAN_DUMP) {
  const plan = {
    phase: 'plan', argv: argv, isTestSession: IS_TEST_SESSION, testMarker: testMarker || null,
    shownSession: SHOWN_SESSION, hidden: !!OPT.hidden, shot: !!SHOT,
    exitAfterSec: exitAfterSec, exitReason: exitReason,
    autoExitTimer: exitAfterSec > 0, windowTimeoutMs: OPT.windowTimeoutMs,
    includeSubagents: includeSubagents === true, panelOpen: panelOpen, panelAlpha: cfg.panelAlpha, fps: cfg,
  profile: cfg.profile, hoverPlate: cfg.hoverPlate, hoverRows: cfg.hoverRows, hoverBar: cfg.hoverBar, panelDetail: cfg.panelDetail,
  windowKeys: WINDOW_KEYS, capabilities: Object.assign({}, caps).fps
  }
  log('PLAN ' + JSON.stringify(plan))
  out('debug', plan)
  gracefulExit(0)
  return
}

  buildWindow()
  applyClickThrough()

  if (!SHOT) {
    startStdin()
    resetSilenceTimer()
    /* SPEC 第 5 节：窗口已创建，可以开始发状态。
   同时**声明能力**（窗口→宿主）：宿主据此决定 state 载荷里要不要带 v2 字段；
   **不声明就退化成 v1 逐字节行为**，所以这里只列真的会渲染的三个。 */
out('ready', { pid: process.pid, capabilities: DECLARED_CAPABILITIES })
log('ready capabilities=' + JSON.stringify(DECLARED_CAPABILITIES) + '（窗口声明；不声明则宿主按 v1 逐字节发）')
    log('ready -> host pid=' + process.pid)
    if (OPT.state && normalizeState(OPT.state)) setState(OPT.state, null, 'initial')
    setTimeout(() => { if (OPT.emitHwnd) out('debug', { hwnd: hwndHex(), bounds: win.getBounds(), geo }) }, 1200)
  } else {
    /* 抓图模式兜底：渲染层若崩溃就永远等不到 painted，这里硬超时退出，绝不挂住调用方 */
    setTimeout(() => {
      log('WARN shot timeout (renderer never reported painted), exiting')
      process.stdout.write('SHOT-FAIL renderer never painted\n')
      gracefulExit(3)
    }, Math.max(8000, OPT.settleMs + 8000))
  }

  if (OPT.fpsLog) log('fps logging enabled')

  if (OPT.metricsInterval > 0) {
    setInterval(() => log('metrics ' + metricsSummary()), OPT.metricsInterval * 1000)
  }
  setTimeout(() => log('t+2s ' + metricsSummary()), 2000)

  if (OPT.dwmPhase > 0) runDwmPhase(OPT.dwmPhase * 1000)
  if (FLAG('wfp-probe')) runWfpProbe()              /* 真窗口命中取证（需事先获准显示窗口） */
  if (FLAG('exstyle-probe')) runExstyleProbe()      /* 纯离屏穿透取证：exstyle + 命中几何，不显示窗口、不碰光标 */
  if (arg('hit-test', '')) runHitTest(arg('hit-test', ''))
  /* ---- 测试钩子：只走与产品路径完全相同的函数，不另开旁路 ---- */
  if (OPT.testSetting) {
    setTimeout(() => {
      const [k, v] = String(OPT.testSetting).split('=')
      let val = v
      if (/^-?\d+$/.test(v)) val = Number(v)
      else if (v === 'true' || v === 'false') val = v === 'true'
      else { try { val = JSON.parse(v) } catch { /* 当字符串 */ } }
      log('test-setting ' + k + '=' + JSON.stringify(val))
      applySetting(k, val)
    }, 1200)
  }
  if (OPT.testDrag) {
    setTimeout(() => {
      const [dx, dy] = String(OPT.testDrag).split(',').map(Number)
      log('test-drag ' + dx + ',' + dy + ' from ' + JSON.stringify(win.getBounds()))
      ipcMain.emit('drag-by', null, dx, dy)     /* 与渲染层真实拖动同一分支 */
      setTimeout(() => ipcMain.emit('drag-end', null), 200)
    }, 1200)
  }
  /* --test-activate <n>：老钩子，直接调 onIconClick（等价于"单击"，不做别的） */
  if (OPT.testActivate) {
    const n = Math.max(1, Number(OPT.testActivate) || 1)
    let i = 0
    const tick = () => { i++; log('test-activate #' + i + '/' + n); onIconClick(); if (i < n) setTimeout(tick, 500) }
    setTimeout(tick, 1200)
  }
  /* --test-mouse：把一段"鼠标脚本"灌进渲染层，走**同一套** hDown/hMove/hUp 判定（不合成真实输入） */
  if (OPT.testMouse) {
    setTimeout(() => { log('test-mouse ' + JSON.stringify(OPT.testMouse)); sendToRenderer({ kind: 'test-mouse', spec: OPT.testMouse }) }, 1200)
  }
  if (OPT.testHover) {
    setTimeout(() => { log('test-hover ' + OPT.testHover); sendToRenderer({ kind: 'test-hover', on: String(OPT.testHover) === 'on' }) }, 1200)
  }
  /* ---- 任务 F 的两个测试钩子（都走产品路径，不另开旁路；**不做任何真实输入合成**）----
     ① --test-open-settings：从 buildMenuTemplate() 里取出「配色设置…」那一项，调用**它自己的 click**
        —— 与用户点菜单时同一个函数对象，不是另写一份"打开设置窗口"的调用。
     ② --test-theme-drive：在设置窗口自己的页面上改滑块并派发 input 事件（= 用户拖滑块那条 DOM 路径），
        走完 settings.html → settings-preload → ipcMain('theme:set') → 图标窗口 CSS 变量的全链。 */
  if (OPT.testOpenSettings) {
    setTimeout(() => {
      const item = buildMenuTemplate().find((i) => i.label === '配色设置…')
      log('test-open-settings menu-item=' + (item ? 'found' : 'MISSING'))
      if (item && typeof item.click === 'function') item.click()
    }, 800)
  }
  if (OPT.testThemeDrive) {
    const steps = String(OPT.testThemeDrive).split(';').map((s) => s.trim()).filter(Boolean)
    log('test-theme-drive steps=' + steps.length)
    const js = (code) => {
      if (!settingsWin || settingsWin.isDestroyed()) { log('WARN settings drive：设置窗口不存在'); return }
      settingsWin.webContents.executeJavaScript(code, true)
        .then((v) => log('settings drive -> ' + JSON.stringify(v)))
        .catch((e) => log('WARN settings drive 失败: ' + (e && e.message ? e.message : String(e))))
    }
    for (const step of steps) {
      const [msRaw, act, id, val] = step.split(':')
      const ms = Math.max(0, Number(msRaw) || 0)
      setTimeout(() => {
        log('test-theme-drive ' + step)
        if (act === 'set') {
          js('(function(){var e=document.getElementById(' + JSON.stringify(String(id)) + ');' +
            'if(!e)return{err:"no element"};e.value=' + JSON.stringify(String(val)) +
            ';e.dispatchEvent(new Event("input",{bubbles:true}));return{id:e.id,value:e.value}})()')
        } else if (act === 'dump') js('window.__ui ? window.__ui() : {err:"no __ui"}')
        else if (act === 'reset') js('(function(){var b=document.getElementById("reset");if(b)b.click();return"reset-clicked"})()')
        else if (act === 'iconstate') js('window.__icon ? window.__icon() : {err:"no __icon"}')
      }, ms)
    }
  }
  /* --test-script <file>：按时间轴灌一系列"鼠标脚本 / 悬停"到渲染层。
     用文件而不是新增 stdio 消息类型：**协议是冻结的**（SPEC §5），未知 kind 会被丢弃；测试钩子不该动协议。 */
  if (OPT.testScript) {
    try {
      /* 参数既可以是**文件路径**，也可以是内联 JSON（离屏取证在 argv 里直接带脚本，
         这样"渲染层鼠标脚本"与"主进程命中探针"能落在同一个进程里）。 */
      const rawText = String(OPT.testScript)
      const steps = JSON.parse(rawText.trim().startsWith('[') ? rawText : fs.readFileSync(rawText, 'utf8'))
      log('test-script steps=' + steps.length)
      for (const st of steps) {
        setTimeout(() => {
          if (st.mouse) { log('test-script mouse ' + st.mouse); sendToRenderer({ kind: 'test-mouse', spec: st.mouse }) }
          if (st.hover !== undefined) { log('test-script hover ' + st.hover); sendToRenderer({ kind: 'test-hover', on: !!st.hover }) }
        }, Math.max(0, Number(st.at) || 0))
      }
    } catch (e) { log('WARN test-script 读取失败: ' + e.message) }
  }
})

function metricsSummary () {
  let mem = 0, cpu = 0
  const parts = []
  try {
    for (const p of app.getAppMetrics()) {
      const kb = p.memory ? p.memory.workingSetSize : 0
      mem += kb
      const c = p.cpu ? p.cpu.percentCPUUsage : 0
      cpu += c
      parts.push(`${p.type}=${(kb / 1024).toFixed(1)}MB/${c.toFixed(1)}%`)
    }
  } catch (e) { return 'metrics unavailable: ' + e.message }
  return `procs=${parts.length} total_mem=${(mem / 1024).toFixed(1)}MB cpu_sum=${cpu.toFixed(1)}% [${parts.join(' ')}]`
}

/* ------------------------------------------------------------------ 真窗口会话（只做只读取证，不做任何输入合成）
   SPEC 第 10 节红线：禁止 SetCursorPos / mouse_event / SendInput 等一切真实输入合成。本运行时的
   产品路径与全部测试都不含任何输入合成；真实鼠标的端到端验证由人在场时手工做。
   这里只做：把窗口显示在屏幕角落 ≤20 秒 → 读 exstyle / 前台窗口（只读查询）→ 立刻关闭。 */
async function runDwmPhase (ms) {
  /* SPEC 第 10 节第 5 条：真窗口一律放屏幕右下角。--dwm-pos 只在测试内部用来把窗口摆到光标下做命中取证。 */
  const dp = String(arg('dwm-pos', '')).split(',').map(Number)
  if (dp.length === 2 && dp.every(Number.isFinite)) {
    win.setPosition(Math.round(dp[0]), Math.round(dp[1]))
    log('DWM-PHASE forced position (explicit) -> (' + dp[0] + ',' + dp[1] + ')')
  } else {
    const corner = defaultPosition(geo.w, geo.h)
    win.setPosition(corner.x, corner.y)
    log('DWM-PHASE forced position (bottom-right corner) -> (' + corner.x + ',' + corner.y + ')')
  }
  const b0 = win.getBounds()
  log('DWM-PHASE begin ms=' + ms + ' bounds=' + JSON.stringify(b0) + ' hwnd=' + hwndHex())
  out('debug', { phase: 'dwm-begin', bounds: b0, hwnd: hwndHex(), geo })

  await sleep(1200)
  const st = await winStateOf()
  log('DWM-WINSTATE ' + st)
  out('debug', { phase: 'win-state', state: st, hwnd: hwndHex(), bounds: win.getBounds() })

  /* 透明角落：命中测试不该指向本窗口（这条在 wfp.mjs 里做完整取证，这里只顺带记一笔） */
  const corner = { x: b0.x + b0.width - 6, y: b0.y + b0.height - 6 }
  const cornerHit = String(await windowFromPoint(corner.x, corner.y))
  log('DWM corner WindowFromPoint -> ' + cornerHit)
  out('debug', { phase: 'corner-hit', point: corner, result: cornerHit, isIcon: cornerHit.toLowerCase().includes(String(hwndHex()).toLowerCase()) })

  setTimeout(() => { log('DWM-PHASE end, closing'); gracefulExit(0) }, Math.max(600, ms - 1200))
}
/* 只读查询：exstyle 各项 + 当前前台窗口是谁（用于证明"不抢焦点"） */
function hwndDec () {
  try { return String(win.getNativeWindowHandle().readBigInt64LE()) } catch { return '0' }
}
async function winStateOf () {
  const ps1 = path.join(HERE, 'win-state.ps1')
  if (!fs.existsSync(ps1)) return 'win-state.ps1 missing'
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy',
    'Bypass', '-WindowStyle', 'Hidden', '-File', ps1, '-Hwnd', hwndDec()], { windowsHide: true, timeout: 8000 },
  (err, stdout) => res(String(stdout || '').trim() || ('rc=' + (err ? err.code : 0)))))
}
function sleep (ms) { return new Promise((r) => setTimeout(r, ms)) }
/* ------------------------------------------------------------------ WindowFromPoint 取证（不依赖光标）
   WindowFromPoint 就是系统用来决定"点击该送给谁"的那个命中测试，且它会**跳过带 WS_EX_TRANSPARENT 的窗口** ——
   所以它是"透明区域是否吃鼠标"最直接的客观证据，且完全不需要移动光标（本机实测光标会被别的进程抢走，
   真实鼠标自动化不可复现）。PowerShell 子进程的坐标空间需要先标定（见下）。 */
async function runWfpProbe () {
  const sf = screen.getPrimaryDisplay().scaleFactor || 1
  /* 关键：先停掉 32ms 的光标命中轮询，否则刚置好的 ignore 状态会在几十毫秒内被自动判定改回去，
     取证就不可复现了（本机光标还会被别的进程抢，自动判定本身也不稳）。 */
  if (mouseTimer) { clearInterval(mouseTimer); mouseTimer = null; log('WFP: mouse watch paused for determinism') }
  await sleep(900)
  const b = win.getBounds()
  const C = { x: b.x + geo.cx, y: b.y + geo.cy }
  const corner = { x: b.x + geo.w - 6, y: b.y + geo.h - 6 }
  const mine = String(hwndHex()).toLowerCase()
  const isMine = (s) => String(s).toLowerCase().includes(mine)

  out('debug', { phase: 'wfp-begin', bounds: b, geo, hwnd: hwndHex(), scaleFactor: sf, center: C, corner })

  /* 1) 标定 PowerShell 的坐标空间：先关掉穿透（否则命中测试会跳过本窗口，永远查不到自己），
        再分别用 DIP 与 DIP×scaleFactor 各查一次，命中自己的那个就是取证空间 */
  setIgnore(false)
  await sleep(400)
  const a = String(await windowFromPoint(C.x, C.y))
  const b2 = String(await windowFromPoint(Math.round(C.x * sf), Math.round(C.y * sf)))
  const space = isMine(a) ? 1 : (isMine(b2) ? sf : 0)
  log(`WFP-CALIB DIP(${C.x},${C.y}) -> ${a}`)
  log(`WFP-CALIB xSF(${Math.round(C.x * sf)},${Math.round(C.y * sf)}) -> ${b2}`)
  log('WFP-CALIB 判定: 取证坐标空间 = ' + (space === 1 ? 'DIP(逻辑)' : (space === sf ? '物理(×' + sf + ')' : '未能判定')))
  out('debug', { phase: 'wfp-calib', atDip: a, atPhysical: b2, space, hwnd: hwndHex() })

  const S = space || 1
  const probe = async (tag, x, y) => {
    const p = { x: Math.round(x * S), y: Math.round(y * S) }
    const r = String(await windowFromPoint(p.x, p.y))
    const mine2 = isMine(r)
    log(`WFP ${tag} point=(${p.x},${p.y}) -> ${r} isIcon=${mine2}`)
    out('debug', { phase: 'wfp', tag, point: p, result: r, isIcon: mine2, hwnd: hwndHex() })
    return mine2
  }
  /* 2) ignore=false（拦截）：圆心命中应当是自己 */
  const centerIntercept = await probe('center-ignore-off', C.x, C.y)
  const exOff = await exstyleOf()
  /* 3) ignore=true（穿透）：圆心与圆外都应当不再是自己 */
  setIgnore(true)
  await sleep(350)
  const centerThrough = await probe('center-ignore-on', C.x, C.y)
  const cornerThrough = await probe('corner-ignore-on', corner.x, corner.y)
  const exOn = await exstyleOf()
  out('debug', {
    phase: 'wfp-summary', centerIntercept, centerThrough, cornerThrough, exstyleIgnoreOff: exOff, exstyleIgnoreOn: exOn
  })
  log(`WFP-SUMMARY 圆心(ignore=off)命中自己=${centerIntercept} 圆心(ignore=on)命中自己=${centerThrough} 圆外(ignore=on)命中自己=${cornerThrough}`)
  log('WFP-EXSTYLE ignore=off -> ' + exOff)
  log('WFP-EXSTYLE ignore=on  -> ' + exOn)
  gracefulExit(0)
}
async function exstyleOf () {
  const ps1 = path.join(HERE, 'win-exstyle.ps1')
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy',
    'Bypass', '-WindowStyle', 'Hidden', '-File', ps1, '-Hwnd', hwndHex()], { windowsHide: true, timeout: 8000 },
  (err, stdout) => res(String(stdout || '').trim() || ('rc=' + (err ? err.code : 0)))))
}

/* ------------------------------------------------------------------ 离屏穿透取证（不显示窗口、不碰光标）
   SPEC 第 10 节：禁止真实输入合成，也不拿真鼠标去点。所以分两段取证：
     ① exstyle 段：显式切换 setIgnoreMouseEvents，读回 WS_EX_TRANSPARENT / WS_EX_LAYERED ——
        这是"透明区域不吃鼠标"的系统级开关，**隐藏窗口也能读**，不需要把窗口显示出来；
     ② 命中几何段：把一组相对图标中心的偏移喂给 insideIcon()（与实时监看**同一段代码**），
        断言"圆内拦截 / 圆外穿透"的分界正好落在 r = 直径/2（而不是方形窗口）。 */
async function runExstyleProbe (keepAlive) {
  /* 退出归属：有 --exstyle-probe 的会话**默认自己退出**，但三种情况下退出权归别人 ——
     ① 与 --hit-test 合跑（runHitTest 统一退出）；② 与 --test-timeline 合跑（时间轴跑完再退）。
     ⚠️ 2026-09-13 修：此前 --exstyle-probe 无条件 gracefulExit(0)，实测**比时间轴还早退出**
        （uptime 2.4s vs 时间轴最后一步 ~2.8s）⇒ 时间轴的点一个都没跑，整轮取证空转。 */
  const ownExit = !keepAlive && !NO_AUTO_EXIT
  if (mouseTimer) { clearInterval(mouseTimer); mouseTimer = null; log('EXSTYLE-PROBE: mouse watch paused for determinism') }
  await sleep(ownExit ? 700 : 120)
  setIgnore(false)
  await sleep(keepAlive ? 80 : 450)
  const off = await exstyleOf()
  setIgnore(true)
  await sleep(keepAlive ? 80 : 450)
  const on = await exstyleOf()
  log('EXSTYLE-PROBE ignore=off -> ' + off)
  log('EXSTYLE-PROBE ignore=on  -> ' + on)
  const b = win.getBounds()
  const cx = b.x + geo.cx, cy = b.y + geo.cy
  const steps = []
  for (const f of [0, 0.25, 0.5, 0.75, 0.95, 0.99, 1.0, 1.01, 1.05, 1.25, 1.5]) {
    const o = geo.hitR * f
    const r = insideIcon(Math.round(cx + o), cy)
    steps.push({ f, d: +o.toFixed(2), inside: r.inside, inCircle: r.inCircle })
  }
  for (const [dx, dy] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    const r0 = Math.SQRT2 * 0.7
    const r = insideIcon(Math.round(cx + geo.hitR * dx), Math.round(cy + geo.hitR * dy))
    steps.push({ f: +r0.toFixed(3), d: +(geo.hitR * r0).toFixed(2), inside: r.inside, inCircle: r.inCircle })
  }
  /* 面板打开时，再补一组"面板内/面板外"的点：面板矩形必须是**真实布局**算出来的那块，
     不是整个窗口矩形（否则透明角也会开始吃鼠标）。 */
  const GP = hitTestPoints()
  if (GP.rect) {
    const dot = (dx, dy, name) => { const r = insideIcon(Math.round(b.x + dx), Math.round(b.y + dy)); steps.push({ name, d: null, inside: r.inside, inCircle: r.inCircle, inPanel: r.inPanel }) }
    dot(geo.cx, geo.cy + geo.hitR + 5, 'gap:iconPanel')        /* 图标下沿之下 5px（窗口坐标系：y 从窗口顶算起；必须落在"图标下沿~面板上沿"那段透明空隙里） */
    dot(geo.cx, GP.rect.top + 6, 'panel:top')
    dot(geo.cx, (GP.rect.top + GP.rect.bottom) / 2, 'panel:mid')
    dot(geo.cx, GP.rect.bottom - 6, 'panel:bottom')
    dot(GP.rect.right - 6, (GP.rect.top + GP.rect.bottom) / 2, 'panel:scrollbar')
    dot(geo.cx, GP.rect.top - 8, 'outside:abovePanel')
    dot(GP.rect.left + 2, GP.rect.top - 8, 'outside:aboveLeftCorner')
  }
  log('EXSTYLE-PROBE hit-geometry ' + steps.map((s) => (s.name ? s.name + '=' : s.f + 'x=') + (s.inside ? 'IN' : 'out') + (s.inPanel ? '/panel' : '')).join(' '))
  out('debug', { phase: 'exstyle', ignoreOff: off, ignoreOn: on, hidden: !!OPT.hidden, bounds: b, geo })
  out('debug', { phase: 'hit-geometry', hitR: geo.hitR, scale: geo.scale, steps })
  if (!ownExit) { await sleep(60); return }   /* 退出权归 runHitTest / --test-timeline */
  gracefulExit(0)
}

async function windowFromPoint (x, y) {  const ps1 = path.join(HERE, 'win-probe.ps1')
  if (!fs.existsSync(ps1)) return 'n/a'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle',
      'Hidden', '-File', ps1, '-X', String(x), '-Y', String(y)], { windowsHide: true, timeout: 8000 },
    (err, stdout) => resolve(String(stdout || '').trim() || ('rc=' + (err ? err.code : 0))))
  })
}


/* 离屏命中几何自测：--hit-test "dx,dy;dx,dy"（相对图标中心的偏移），走的是 insideIcon 同一段代码。
   2026-09-13 扩展：支持**具名点** name:token，token 可以是窗口局部坐标 x,y，
   也可以是具名几何（top/mid/bottom/scrollbar/left/right = 面板矩形；iconPanel/abovePanel/
   belowPanel/leftOfPanel = 透明处；r70/r105 = 距图标中心 0.7R / 1.05R 的半径点）。
   具名点是**取证探针**，不是判据复刻：判据本身仍然是 insideIcon()，这里只负责"把点喂进去"。 */
function hitTestPoints () {
  const b = win.getBounds()
  const C = { x: b.x + geo.cx, y: b.y + geo.cy }
  const rect = panelHitRects()[0] || null
  const hitR = geo.hitR
  const R = (t) => { const r = hitR * t; return { x: Math.round(C.x + r), y: Math.round(C.y) } }
  const named = {
    circleCenter: { x: C.x, y: C.y },
    'r70': R(0.7),
    'r105': R(1.05),
    'iconPanel': rect ? { x: Math.round(b.x + geo.cx), y: Math.round(b.y + geo.hitR + 20) } : null,
    'abovePanel': rect ? { x: Math.round(b.x + geo.cx), y: Math.round(b.y + rect.top - 8) } : null,
    'belowPanel': null,
    'leftOfPanel': rect ? { x: Math.round(b.x + rect.left - 8), y: Math.round(b.y + (rect.top + rect.bottom) / 2) } : null
  }
  if (rect) {
    /* 面板内：顶部 / 中部 / 底部 / 右侧滚动条那一列 / 右下角 */
    named.top = { x: Math.round(b.x + (rect.left + rect.right) / 2), y: Math.round(b.y + rect.top + 6) }
    named.mid = { x: Math.round(b.x + (rect.left + rect.right) / 2), y: Math.round(b.y + (rect.top + rect.bottom) / 2) }
    named.bottom = { x: Math.round(b.x + (rect.left + rect.right) / 2), y: Math.round(b.y + rect.bottom - 6) }
    named.scrollbar = { x: Math.round(b.x + rect.right - 6), y: Math.round(b.y + (rect.top + rect.bottom) / 2) }
    named.right = { x: Math.round(b.x + rect.right - 2), y: Math.round(b.y + (rect.top + rect.bottom) / 2) }
    named.left = { x: Math.round(b.x + rect.left + 2), y: Math.round(b.y + (rect.top + rect.bottom) / 2) }
    /* 面板**外侧**的透明处（窗口内、面板矩形外）——展开时窗口恰是 440×525，所以用窗口底边之上/之外的负空间 */
    named.belowPanel = { x: Math.round(b.x + rect.left + 4), y: Math.round(b.y + Math.min(geo.h - 1, rect.bottom + 3)) }
  }
  return { bounds: b, C, rect, hitR, named }
}
async function runHitTest (spec) {
  const spec0 = String(spec)
  if (spec0 === '1' || spec0 === 'all') { await runExstyleProbe(); return }
  /* 与 --exstyle-probe 合并成**一次**取证：先取 exstyle 段（它会暂停鼠标轮询），再取具名命中点，最后统一退出。
     ⚠️ 2026-09-13 修：此前 --hit-test 与 --exstyle-probe 同时给会各跑各的、互相抢着 gracefulExit，
        实测两边证据都被丢空（exit=4294967295、stdout 只剩 ready、points=[]）。 */
  if (mouseTimer) { clearInterval(mouseTimer); mouseTimer = null }
  if (FLAG('exstyle-probe')) await runExstyleProbe(true)
  const probe = hitTestProbe(spec0)
  log('HIT-TEST ' + probe.logLine)
  out('debug', probe.json)
  gracefulExit(0)
}
/* 把一组点喂给 insideIcon()（与 40ms 实时监看**同一段代码**），返回留痕用的两份表示 */
function hitTestProbe (spec) {
  const G = hitTestPoints()
  const pts = []
  for (const raw of String(spec).split(';')) {
    const s = raw.trim()
    if (!s) continue
    let name = s, p = null
    if (s.indexOf(':') >= 0) {
      const i = s.indexOf(':')
      name = s.slice(0, i)
      const tok = s.slice(i + 1)
      if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(tok)) {
        const xy = tok.split(',').map(Number)
        p = { x: Math.round(G.bounds.x + xy[0]), y: Math.round(G.bounds.y + xy[1]) }
      } else {
        p = G.named[tok] || null
        if (!p) { log('WARN hit-test 未知具名点: ' + s); name = s }
      }
    } else {
      const dxdy = s.split(',').map(Number)
      if (dxdy.length === 2 && dxdy.every(Number.isFinite)) p = { x: Math.round(G.C.x + dxdy[0]), y: Math.round(G.C.y + dxdy[1]) }
    }
    if (!p) continue
    const r = insideIcon(p.x, p.y)
    pts.push({ name, x: p.x, y: p.y, dx: Math.round(p.x - G.C.x), dy: Math.round(p.y - G.C.y), d: Math.round(r.d), inside: r.inside, inCircle: r.inCircle, inPanel: r.inPanel })
  }
  const json = {
    phase: 'hit-test',
    hitR: G.hitR,
    cx: G.C.x,
    cy: G.C.y,
    win: { x: G.bounds.x, y: G.bounds.y, w: geo.w, h: geo.h, panelOpen: !!panelOpen },
    icon: { cx: geo.cx, cy: geo.cy, hitR: geo.hitR },
    panel: G.rect
      ? { used: { left: G.rect.left, top: G.rect.top, right: G.rect.right, bottom: G.rect.bottom }, source: G.rect.source,
          measured: panelHitRect ? { left: panelHitRect.left, top: panelHitRect.top, right: panelHitRect.right, bottom: panelHitRect.bottom } : null }
      : null,
    points: pts
  }
  const rr = G.rect ? [G.rect.left, G.rect.top, G.rect.right, G.rect.bottom].map(Math.round).join(',') + '@' + G.rect.source : 'none'
  const logLine = 'panelOpen=' + !!panelOpen + ' rect=' + rr + ' :: ' +
    pts.map((p) => `${p.name}(${p.dx},${p.dy})=${p.inside ? 'IN' : 'out'}${p.inPanel ? '/panel' : ''}`).join(' ')
  return { json, logLine }
}

app.on('window-all-closed', () => { log('all windows closed'); if (!SHOT) gracefulExit(0) })
app.on('before-quit', () => { exiting = true })
process.on('uncaughtException', (e) => { log('FATAL uncaught: ' + (e && e.stack ? e.stack : e)) })
process.on('unhandledRejection', (e) => { log('WARN unhandledRejection: ' + (e && e.stack ? e.stack : e)) })

/* ------------------------------------------------------------------ 导出
   跨侧绊线测试从这里机器提取窗口侧认的全部键，与宿主 SHARED_WINDOW_KEYS 逐键比对。 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULTS: DEFAULTS, WINDOW_KEYS: WINDOW_KEYS, cleanWindow: cleanWindow, PROFILES: PROFILES, PANEL_DETAILS: PANEL_DETAILS, HOVER_PLATES: HOVER_PLATES, HOVER_ROWS: HOVER_ROWS, HOVER_BARS: HOVER_BARS, PROFILE_TO_FPS: PROFILE_TO_FPS, DECLARED_CAPABILITIES: DECLARED_CAPABILITIES, V2_STATE_FIELDS: V2_STATE_FIELDS }
}
