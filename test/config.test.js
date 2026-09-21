import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_CONFIG,
  DROPPED_WINDOW_KEYS,
  ELECTRON_CANDIDATES,
  HOVER_BAR_VALUES,
  HOVER_PLATE_VALUES,
  HOVER_ROWS_VALUES,
  LEGACY_WINDOW_TIMEOUT_MS,
  PACKAGE_ROOT,
  PANEL_DETAIL_VALUES,
  PROFILE_VALUES,
  SETTABLE_TOP_LEVEL_KEYS,
  SETTABLE_WINDOW_KEYS,
  SHARED_WINDOW_KEYS,
  applySetting,
  configMessagePayload,
  configPath,
  deepMerge,
  defaults,
  loadConfig,
  resetSaveLogLimiter,
  resolveHelperLaunch,
  saveConfig,
  sanitizeConfig,
} from '../src/config.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-work-icon-cfg-'))
}

/**
 * 去掉注释再解析。窗口侧的 DEFAULTS 把注释写在**逗号之后**
 * （`panelAlpha: X,   /* window.panelAlpha *\/`），不先剥掉就会把下一项吞进注释里，
 * 提取器会静默漏键 —— 这正是"空断言"的典型来源。
 */
function stripComments(source) {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/\/\/[^\n]*/gmu, ' ')
}

/** 从 `const DEFAULTS = { a: 1, b: 2 }` 这种对象字面量里抠出键名。 */
function keysOfObjectLiteral(body) {
  return stripComments(body)
    .split(',')
    .map((part) => part.split(':')[0].trim())
    .filter((key) => /^[A-Za-z_$][\w$]*$/u.test(key))
}

/** 从窗口侧 main.js 的 cleanWindow() 返回值里抠出 window 键名（审计锚点）。 */
function keysOfCleanWindow(source) {
  const start = source.indexOf('function cleanWindow (')
  if (start < 0) return []
  const body = source.slice(start, source.indexOf('\n}', start))
  return [...stripComments(body).matchAll(/^\s{4}([A-Za-z_$][\w$]*):/gmu)].map((match) => match[1])
}

/** 解析一个字面量（数字/字符串/布尔/null），或去查文件里的 `const NAME = <字面量>`。 */
function literalOf(expression, constants) {
  const text = String(expression ?? '').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '').trim()
  if (text.length === 0) return undefined
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text)
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1)
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  return constants.get(text)
}

/** 抽出窗口侧文件里的顶层常量字面量（`const DEFAULT_RATIO = 1.5` 这类）。 */
function constantsOf(source) {
  const constants = new Map()
  for (const match of source.matchAll(/^const ([A-Z][A-Z0-9_]*) = ([^\n]+)$/gmu)) {
    // 两轮足够解析 `const A = B` 这种一层间接
    const value = literalOf(match[2], constants)
    if (value !== undefined) constants.set(match[1], value)
  }
  return constants
}

/**
 * 从窗口侧 main.js 抠出 `DEFAULTS` 的**键与值**（值是字面量或能解出一层常量间接）。
 * 这是"默认值一致性"断言的锚点 —— 两边默认值飘了，测试必须能抓住。
 */
function windowDefaults(source) {
  const constants = constantsOf(source)
  const body = /const DEFAULTS = \{([\s\S]*?)\n\}/u.exec(source)?.[1]
  if (body === undefined) return {}
  const out = {}
  // 先剥注释再按逗号切：否则"逗号后的注释"会把下一项吞掉（提取器静默漏键）
  for (const part of stripComments(body).split(',')) {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+?)\s*$/u.exec(part)
    if (!match) continue
    const value = literalOf(match[2], constants)
    if (value !== undefined) out[match[1]] = value
  }
  return out
}

/** 抽窗口侧的枚举数组字面量（`const PROFILES = ['eco', ...]`）。 */
function windowArray(source, name) {
  const match = new RegExp(`^const ${name} = \\[([^\\]]*)\\]`, 'mu').exec(source)
  if (match === null) return undefined
  const constants = constantsOf(source)
  return match[1].split(',').map((item) => literalOf(item, constants)).filter((value) => value !== undefined)
}

test('默认值：默认不启动、心跳 5s、直径 140、运行时自动解析、🚫 不自动重启', () => {
  const config = defaults()
  assert.equal(config.enabled, false, '默认必须是关闭的，避免用户装完就被弹窗')
  assert.equal(config.pulseIntervalMs, 5000)
  // 静默阈值 15s → 60s（2026-09-13 由窗口侧/用户拍板）：宿主被长时间占用时
  // 会连着 15s+ 一条消息都发不出去（见 bridge 的静默告警与事件循环探针），
  // 15s 阈值会让图标频繁闪成"等待宿主数据"；60s = 容忍 12 次心跳丢失。
  // 旧配置里写死的 15000 由 LEGACY_WINDOW_TIMEOUT_MS 迁移成新默认（下面有用例）。
  assert.equal(config.windowTimeoutMs, 60000)
  assert.equal(LEGACY_WINDOW_TIMEOUT_MS, 15000, '旧默认值常量要与迁移分支一致')
  assert.equal(config.window.scale, 140)
  assert.equal(config.window.opacity, 100)
  assert.equal(config.window.alwaysOnTop, true)
  assert.equal(config.window.clickThrough, true)
  assert.equal(config.window.position, null)
  // 运行时：command 空 = 自动解析插件内的 Electron；args = 传 runtime/electron 目录
  assert.equal(config.helper.command, '')
  assert.deepEqual(config.helper.args, ['runtime/electron'])
  // 🚫 SPEC §10.3 红线：进程消失=人为终止，绝不自动重启
  assert.equal(config.helper.restartOnCrash, false)
  assert.equal(config.helper.maxRestarts, 0)
  // 每次返回新对象，调用方随便改
  config.window.scale = 96
  assert.equal(defaults().window.scale, 140)
  assert.equal(DEFAULT_CONFIG.window.scale, 140)
})

test('resolveHelperLaunch：默认自动解析包内 Electron；显式 command 是逃生口；都没有则安静失败', () => {
  const autoPath = ELECTRON_CANDIDATES[0]
  // 自动解析命中
  const auto = resolveHelperLaunch({}, { exists: (p) => p === autoPath })
  assert.equal(auto.ok, true)
  assert.equal(auto.source, 'auto')
  assert.equal(auto.command, autoPath)
  assert.deepEqual(auto.args, ['runtime/electron'])
  assert.equal(auto.cwd, PACKAGE_ROOT, 'cwd 必须是插件包根（含 runtime/ 与 src/ 的那层）')

  // 显式配置优先（换栈/换路径的逃生口），且完全照用户写的来
  const explicit = resolveHelperLaunch({
    helper: { command: 'C:\\other\\electron.exe', args: ['app'], cwd: 'D:\\x' },
  }, { exists: () => true })
  assert.equal(explicit.ok, true)
  assert.equal(explicit.source, 'config')
  assert.equal(explicit.command, 'C:\\other\\electron.exe')
  assert.deepEqual(explicit.args, ['app'])
  assert.equal(explicit.cwd, 'D:\\x')

  // 一个候选都没有 → ok:false，交给调用方安静降级
  const missing = resolveHelperLaunch({}, { exists: () => false })
  assert.equal(missing.ok, false)
  assert.equal(missing.command, '')
  assert.match(missing.reason, /未在包内找到 Electron/)

  // 候选列表可注入（测试用的假可执行文件）
  const fake = resolveHelperLaunch({}, { exists: (p) => p === 'X', candidates: ['X'] })
  assert.equal(fake.command, 'X')
  assert.equal(fake.ok, true)
})

test('真实环境自检：本机确实能解析到插件内的 Electron 可执行文件', () => {
  const launch = resolveHelperLaunch({})
  if (!launch.ok) {
    // 允许在没装 electron 的机器上跳过，但必须明确说出来
    console.log(`[skip] 本机未找到 Electron：${launch.reason}`)
    return
  }
  assert.equal(launch.ok, true)
  assert.ok(existsSync(launch.command), `解析到的路径必须真实存在：${launch.command}`)
  assert.deepEqual(launch.args, ['runtime/electron'])
  assert.equal(launch.cwd, PACKAGE_ROOT)
})

test('配置路径：%USERPROFILE%\\.dsh\\work-icon\\config.json', () => {
  const env = { USERPROFILE: 'C:\\Users\\david' }
  assert.equal(configPath({ env }), join('C:\\Users\\david', '.dsh', 'work-icon', 'config.json'))
  // 允许用 DSH_WORK_ICON_HOME 覆盖（测试/多开用）
  assert.equal(configPath({ env: { ...env, DSH_WORK_ICON_HOME: 'D:\\tmp\\wi' } }), join('D:\\tmp\\wi', 'config.json'))
})

test('配置文件不存在 → 默认值，且不抛异常', () => {
  const dir = tempDir()
  try {
    const config = loadConfig({ path: join(dir, 'nope.json') })
    assert.equal(config.enabled, false)
    assert.equal(config.window.scale, 140)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('配置文件损坏 → 回退默认值且不崩', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    const warnings = []

    writeFileSync(file, '{ this is not json', 'utf8')
    assert.doesNotThrow(() => loadConfig({ path: file, logger: { warn: (m) => warnings.push(m) } }))
    assert.deepEqual(loadConfig({ path: file }), defaults())
    assert.ok(warnings.some((line) => line.includes('合法 JSON')))

    // 顶层不是对象
    writeFileSync(file, '[1,2,3]', 'utf8')
    assert.deepEqual(loadConfig({ path: file }), defaults())

    writeFileSync(file, 'null', 'utf8')
    assert.deepEqual(loadConfig({ path: file }), defaults())

    // 空文件
    writeFileSync(file, '', 'utf8')
    assert.deepEqual(loadConfig({ path: file }), defaults())

    // 目录当文件读（EISDIR/EPERM）也不能崩
    const asDir = join(dir, 'dir.json')
    mkdirSync(asDir)
    assert.doesNotThrow(() => loadConfig({ path: asDir }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('合法配置文件与默认值深合并（部分覆盖不动其它字段）', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify({
      enabled: true,
      window: { scale: 200, position: { x: 10, y: 20 } },
      helper: { command: 'python3', args: ['runtime/helper.py', '--verbose'] },
      unknownField: 'should be dropped',
    }), 'utf8')

    const config = loadConfig({ path: file })
    assert.equal(config.enabled, true)
    assert.equal(config.window.scale, 200)
    assert.deepEqual(config.window.position, { x: 10, y: 20 })
    // 未被覆盖的字段保持默认
    assert.equal(config.window.opacity, 100)
    assert.equal(config.pulseIntervalMs, 5000)
    assert.equal(config.helper.command, 'python3')
    assert.deepEqual(config.helper.args, ['runtime/helper.py', '--verbose'])
    assert.equal('unknownField' in config, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sanitizeConfig：非法值被收敛，关键字段不会变成垃圾', () => {
  const config = sanitizeConfig({
    enabled: 'yes please',
    pollIntervalMs: 10,
    pulseIntervalMs: -5,
    includeSubagents: 0,
    helper: { command: '   ', args: [], maxRestarts: 999, env: { A: 1, B: null } },
    window: { scale: 137, opacity: 61, position: { x: 'a', y: 2 }, alwaysOnTop: 'false' },
  })
  assert.equal(config.enabled, false)
  assert.equal(config.pollIntervalMs, 100) // 被夹到下限
  assert.equal(config.pulseIntervalMs, 0) // 被夹到下限 = 关掉心跳
  assert.equal(config.includeSubagents, false)
  assert.equal(config.helper.command, '') // 空字符串 = 自动解析，保持空
  assert.deepEqual(config.helper.args, ['runtime/electron'])
  assert.equal(config.helper.maxRestarts, 50) // 被夹到上限
  assert.equal(config.helper.restartOnCrash, false) // 🚫 红线：不写就是关
  assert.deepEqual(config.helper.env, { A: '1' }) // null 被丢掉
  assert.equal(config.window.scale, 140) // 137 → 最近的 140 档
  assert.equal(config.window.opacity, 60) // 61 → 最近的 60 档
  assert.equal(config.window.position, null) // 非数字坐标作废
  assert.equal(config.window.alwaysOnTop, false)
})

test('deepMerge：递归合并对象，数组整体替换', () => {
  const merged = deepMerge({ a: 1, nested: { x: 1, y: 2 }, list: [1, 2] }, { nested: { y: 3 }, list: [9] })
  assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 3 }, list: [9] })
  // 不改原对象
  const base = { nested: { x: 1 } }
  deepMerge(base, { nested: { x: 2 } })
  assert.equal(base.nested.x, 1)
})

test('saveConfig：原子写（临时文件不残留）、能读回来、非法内容被收敛', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    const result = saveConfig({ enabled: true, window: { scale: 200 }, helper: { command: 'python3' } }, { path: file })
    assert.equal(result.ok, true)
    assert.ok(existsSync(file))

    const files = readdirSync(dir)
    assert.deepEqual(files, ['config.json'], `临时文件不该残留，实际：${files.join(', ')}`)
    assert.ok(readFileSync(file, 'utf8').endsWith('\n'))

    const reloaded = loadConfig({ path: file })
    assert.equal(reloaded.enabled, true)
    assert.equal(reloaded.window.scale, 200)
    assert.equal(reloaded.helper.command, 'python3')
    assert.equal(reloaded.pulseIntervalMs, 5000)

    // 目录不存在时会自建
    const nested = join(dir, 'deep', 'dir', 'config.json')
    assert.equal(saveConfig({ enabled: true }, { path: nested }).ok, true)
    assert.ok(existsSync(nested))

    // 写失败只返回 { ok:false }，不抛
    const failing = saveConfig({ enabled: true }, { path: file, fs: { writeFileSync: () => { throw new Error('EACCES') } } })
    assert.equal(failing.ok, false)
    assert.equal(failing.error.message, 'EACCES')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applySetting：窗口只能改 5 个 window.* 与唯一的顶层布尔键 includeSubagents', () => {
  const base = defaults()
  assert.equal(applySetting(base, 'scale', 200).window.scale, 200)
  assert.equal(applySetting(base, 'window.opacity', 60).window.opacity, 60)
  assert.equal(applySetting(base, 'alwaysOnTop', false).window.alwaysOnTop, false)
  assert.equal(applySetting(base, 'always_on_top', false).window.alwaysOnTop, false)
  assert.deepEqual(applySetting(base, 'position', { x: 5, y: 6 }).window.position, { x: 5, y: 6 })
  // 唯一的顶层键：子代理开关
  assert.equal(applySetting(base, 'includeSubagents', true).includeSubagents, true)
  assert.equal(applySetting(base, 'includeSubagents', false).includeSubagents, false)
  // 非法值照样被收敛：137 → 140
  assert.equal(applySetting(base, 'scale', 137).window.scale, 140)
  // 返回值是新对象，原配置不被改动
  assert.equal(base.window.scale, 140)
  assert.equal(applySetting(base, 'nonsense', 1), null)
  assert.equal(applySetting(base, '', 1), null)
  assert.equal(applySetting(base, 'window.nope', 1), null)
})

test('🚫 白名单安全：窗口不能改写其它顶层键（enabled / helper.* / pulseIntervalMs …）', () => {
  const base = { ...defaults(), enabled: true, helper: { command: 'keep-me' } }
  const rejected = [
    ['enabled', false],                 // 不能让窗口把插件关掉
    ['enabled', true],
    ['helper.command', 'evil.exe'],     // 不能让窗口换掉运行时
    ['helper', { command: 'evil.exe' }],
    ['helper.maxRestarts', 99],         // 也不能绕过红线打开自动重启
    ['helper.restartOnCrash', true],
    ['pulseIntervalMs', 1],
    ['pollIntervalMs', 1],
    ['windowTimeoutMs', 1],
    ['windowId', 'x'],
  ]
  for (const [key, value] of rejected) {
    assert.equal(applySetting(base, key, value), null, `必须拒绝：${key}`)
  }
  // 被拒绝的键不能以任何形式落到配置里
  const after = applySetting(base, 'helper.command', 'evil.exe')
  assert.equal(after, null)
  assert.equal(base.helper.command, 'keep-me')
  assert.equal(base.enabled, true)
})

test('includeSubagents 只认真布尔，字符串/数字不能把开关拨过去', () => {
  const base = defaults()
  assert.equal(applySetting(base, 'includeSubagents', 'true'), null)
  assert.equal(applySetting(base, 'includeSubagents', 1), null)
  assert.equal(applySetting(base, 'includeSubagents', 0), null)
  assert.equal(applySetting(base, 'includeSubagents', null), null)
  assert.equal(applySetting(base, 'includeSubagents', undefined), null)
  assert.equal(applySetting(base, 'includeSubagents', {}), null)
  assert.equal(applySetting(base, 'includeSubagents', true).includeSubagents, true)
  assert.equal(base.includeSubagents, false, '原配置不该被改动')
})

test('🚫 window.autostart 已废弃：白名单拒绝写入，旧配置里的残留被丢弃且不报错', () => {
  const base = defaults()
  assert.equal('autostart' in base.window, false, '配置模型里不该再有 autostart')
  assert.equal(applySetting(base, 'window.autostart', true), null)
  assert.equal(applySetting(base, 'autostart', true), null)
  assert.equal(applySetting(base, 'autoStart', true), null)
  // 旧配置文件里带着它 → 能正常加载，键被丢掉，其余字段照常生效
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify({
      enabled: true,
      window: { scale: 200, autostart: true },
    }), 'utf8')
    const loaded = loadConfig({ path: file })
    assert.equal(loaded.enabled, true)
    assert.equal(loaded.window.scale, 200)
    assert.equal('autostart' in loaded.window, false)
    // 再存回去也不会把它写回来
    assert.equal(saveConfig(loaded, { path: file }).ok, true)
    assert.equal('autostart' in JSON.parse(readFileSync(file, 'utf8')).window, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('错误红灯时长可配、有下限（不可能把"出口"配成永不），且窗口改不了它', () => {
  assert.equal(defaults().errorTtlMs, 20000, '轮级 ERROR 默认 20s')
  assert.equal(defaults().toolErrorTtlMs, 5000, '工具级闪烁默认 5s')
  assert.equal(defaults().staleStickyMs, 90000, '静默淘汰默认 90s')
  // 可调
  assert.equal(sanitizeConfig({ errorTtlMs: 30000 }).errorTtlMs, 30000)
  // 下限保护：0 / 负数只会被夹到下限，绝不会变成"永不过期"
  assert.equal(sanitizeConfig({ errorTtlMs: 0 }).errorTtlMs, 1000)
  assert.equal(sanitizeConfig({ errorTtlMs: -5 }).errorTtlMs, 1000)
  assert.equal(sanitizeConfig({ errorTtlMs: 1e9 }).errorTtlMs, 600000)
  assert.equal(sanitizeConfig({ errorTtlMs: 'abc' }).errorTtlMs, 20000, '垃圾值回默认')
  assert.equal(sanitizeConfig({ toolErrorTtlMs: 1 }).toolErrorTtlMs, 500)
  assert.equal(sanitizeConfig({ staleStickyMs: 1 }).staleStickyMs, 5000)
  // 只读键：窗口的 setting 通道拒绝它们（顶层白名单只有 includeSubagents）
  const base = defaults()
  assert.equal(applySetting(base, 'errorTtlMs', 1), null)
  assert.equal(applySetting(base, 'staleStickyMs', 1), null)
  assert.equal(applySetting(base, 'toolErrorTtlMs', 1), null)
})

test('🐛 复现并修好：手写的 window.ratio / window.fps 不再被宿主抹掉（load → save 全程保留）', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    // 用户（或窗口侧）手写进配置文件的窗口自有键
    writeFileSync(file, JSON.stringify({
      enabled: true,
      window: { scale: 200, ratio: 1.8, fps: 'smooth' },
    }), 'utf8')

    const loaded = loadConfig({ path: file })
    assert.equal(loaded.window.ratio, 1.8, 'load 必须读得出来（修复前是 undefined）')
    assert.equal(loaded.window.fps, 'smooth')
    assert.equal(loaded.window.scale, 200)

    assert.equal(saveConfig(loaded, { path: file }).ok, true)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(written.window.ratio, 1.8, 'save 必须原样写回（修复前这里会被 sanitizeConfig 丢掉）')
    assert.equal(written.window.fps, 'smooth')
    assert.equal(written.window.scale, 200)

    // 再走一遍完整回路，确认不会被逐次侵蚀
    const again = loadConfig({ path: file })
    saveConfig(again, { path: file })
    const third = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(third.window.ratio, 1.8)
    assert.equal(third.window.fps, 'smooth')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('window.ratio：默认 1.5、越界夹取、非数字拒绝', () => {
  assert.equal(defaults().window.ratio, 1.5, '默认必须是 1.5（对齐窗口侧 DEFAULT_RATIO）')
  // 文件通道：垃圾值回退默认（配置文件是人手改的，不该让插件起不来）
  assert.equal(sanitizeConfig({ window: { ratio: 9 } }).window.ratio, 2.5)
  assert.equal(sanitizeConfig({ window: { ratio: 0.1 } }).window.ratio, 1.0)
  assert.equal(sanitizeConfig({ window: { ratio: 1.8 } }).window.ratio, 1.8)
  assert.equal(sanitizeConfig({ window: { ratio: 'abc' } }).window.ratio, 1.5)
  // setting 通道：非数字**整体拒绝**，不做静默回退
  const base = defaults()
  assert.equal(applySetting(base, 'window.ratio', 2.2).window.ratio, 2.2)
  assert.equal(applySetting(base, 'window.ratio', 9).window.ratio, 2.5)
  assert.equal(applySetting(base, 'window.ratio', 0.1).window.ratio, 1.0)
  assert.equal(applySetting(base, 'ratio', 2).window.ratio, 2, '扁平写法也认')
  assert.equal(applySetting(base, 'window.ratio', 'abc'), null)
  assert.equal(applySetting(base, 'window.ratio', '1.8'), null, '数字字符串也不算数字')
  assert.equal(applySetting(base, 'window.ratio', null), null)
  assert.equal(applySetting(base, 'window.ratio', {}), null)
  assert.equal(base.window.ratio, 1.5, '原配置不被改动')
})

test('window.fps（审计查出的同类 bug）：保留 + 可被 setting 写入 + 垃圾值拒绝', () => {
  assert.equal(defaults().window.fps, 'standard')
  // 预设名原样保留（词汇表归窗口侧，宿主不校验它认不认）
  assert.equal(sanitizeConfig({ window: { fps: 'saver' } }).window.fps, 'saver')
  // 自定义对象只保留已知数值子键，并夹到 0–240
  assert.deepEqual(
    sanitizeConfig({ window: { fps: { power: 'custom', idle: 8, working: 999, junk: 1 } } }).window.fps,
    { power: 'custom', idle: 8, working: 240 },
  )
  assert.equal(sanitizeConfig({ window: { fps: 123 } }).window.fps, 'standard', '非法形状回退默认')
  // setting 通道
  const base = defaults()
  assert.equal(applySetting(base, 'window.fps', 'smooth').window.fps, 'smooth')
  assert.deepEqual(applySetting(base, 'window.fps', { idle: 4, working: 30 }).window.fps, { idle: 4, working: 30 })
  assert.equal(applySetting(base, 'window.fps', ''), null)
  assert.equal(applySetting(base, 'window.fps', 'x'.repeat(40)), null, '过长字符串拒绝')
  assert.equal(applySetting(base, 'window.fps', 7), null)
  assert.equal(applySetting(base, 'window.fps', []), null)
})

test('window.* setting 值类型严格校验：类型不对整体拒绝（不再静默回退默认值）', () => {
  const base = defaults()
  assert.equal(applySetting(base, 'window.scale', 'abc'), null)
  assert.equal(applySetting(base, 'window.scale', 140).window.scale, 140)
  assert.equal(applySetting(base, 'window.opacity', 'abc'), null)
  assert.equal(applySetting(base, 'window.alwaysOnTop', 'yes'), null)
  assert.equal(applySetting(base, 'window.alwaysOnTop', true).window.alwaysOnTop, true)
  assert.equal(applySetting(base, 'window.clickThrough', 1), null)
  assert.equal(applySetting(base, 'window.position', { x: 'a', y: 1 }), null)
  assert.equal(applySetting(base, 'window.position', { x: 1, y: 2 }).window.position.x, 1)
  // 被拒绝时原配置不变：一个坏 value 不能把已有的 position 清成 null
  const withPosition = applySetting(base, 'window.position', { x: 5, y: 6 })
  assert.equal(applySetting(withPosition, 'window.position', { x: 'a', y: 1 }), null)
  assert.deepEqual(withPosition.window.position, { x: 5, y: 6 })
})

test('跨侧契约（固化）：window 块共享键双向断言 + 窗口侧新增键的绊线', () => {
  // ① 常量本身就是契约
  assert.deepEqual(
    SHARED_WINDOW_KEYS.slice().sort(),
    ['alwaysOnTop', 'clickThrough', 'fps', 'hoverBar', 'hoverPlate', 'hoverRows', 'opacity', 'panelAlpha', 'panelDetail', 'position', 'profile', 'ratio', 'scale'],
  )
  assert.deepEqual(
    DROPPED_WINDOW_KEYS,
    [],
    '这里只放"双方已同意删除、但窗口侧可能还没删干净"的历史豁免键；autostart 两边都已删除，所以是空的',
  )
  // 宿主侧：模型里必须有每个共享键，且注入值后能被 sanitize 保留
  const probe = {
    scale: 200,
    opacity: 60,
    alwaysOnTop: false,
    clickThrough: false,
    position: { x: 1, y: 2 },
    ratio: 1.8,
    fps: 'smooth',
    panelAlpha: 0.9,
    profile: 'smooth',
    hoverPlate: 'off',
    hoverRows: 'on',
    hoverBar: 'on',
    panelDetail: 'columns',
  }
  const kept = sanitizeConfig({ window: probe }).window
  for (const key of SHARED_WINDOW_KEYS) {
    assert.ok(key in defaults().window, `宿主 window 默认值缺少共享键：${key}`)
    assert.deepEqual(kept[key], probe[key], `宿主的 sanitizeConfig 把 ${key} 改坏/丢了`)
  }

  // ② 锚点 A：窗口侧 main.js 的 DEFAULTS 与 cleanWindow 返回值 —— 机器可读、能绊住未来新增键
  //    （路径可用环境变量指到副本，便于做"模拟窗口侧新增键"的敏感性复核，不必改人家的文件）
  const mainPath = process.env.DSH_WORK_ICON_WINDOW_MAIN || join(PACKAGE_ROOT, 'runtime', 'electron', 'main.js')
  assert.ok(existsSync(mainPath), `审计锚点缺失（${mainPath}），窗口侧改了路径？`)
  const main = readFileSync(mainPath, 'utf8')
  const defaultsKeys = keysOfObjectLiteral(/const DEFAULTS = \{([^}]*)\}/u.exec(main)?.[1] ?? '')
  const cleanKeys = keysOfCleanWindow(main)
  const windowSideKeys = [...new Set([...defaultsKeys, ...cleanKeys])].sort()
  assert.ok(
    windowSideKeys.length >= 6,
    `审计锚点失效：只从窗口侧 main.js 提取到 ${windowSideKeys.length} 个 window 键（${windowSideKeys.join(',')}），请更新提取逻辑`,
  )

  // 检查 A（单向豁免）：窗口侧的每个键要么是共享键，要么在历史豁免表里。
  // 这一条只为给出**可操作**的失败提示；真正严格的是下面的双向相等。
  for (const key of windowSideKeys) {
    assert.ok(
      SHARED_WINDOW_KEYS.includes(key) || DROPPED_WINDOW_KEYS.includes(key),
      `窗口侧有 window.${key}，宿主共享键表里没有 —— 用户写进 config.json 的这个值会在宿主下一次保存时被抹掉，`
      + '请把该键加进 SHARED_WINDOW_KEYS 并让 window 模型保留它',
    )
  }

  // 检查 B（双向相等）：期望集**只**是 SHARED_WINDOW_KEYS。
  // 豁免表 DROPPED_WINDOW_KEYS 不进期望集 —— 它是"双方都不该再有的键"，
  // 放进来会让两边都删干净之后反而永远差一项（这正是上一版的 bug）。
  //   多一个 → 窗口侧新增了未纳入共享表的键（宿主会抹掉它的值）
  //   少一个 → 宿主保留了窗口侧已经不用的键（共享表该瘦身）
  assert.deepEqual(
    windowSideKeys,
    [...SHARED_WINDOW_KEYS].sort(),
    '窗口侧 window 键集合与宿主共享键表不一致：多一个 → 宿主会抹掉用户写的这个值；'
    + '少一个 → 宿主保留了没人用的键。请同步 SHARED_WINDOW_KEYS 与 window 模型',
  )

  // ③ 锚点 B：窗口侧 README 明确记录的键名（人工文档也要同步）
  //    注：window.fps 目前只在 main.js 里出现（README 只写了 --fps CLI），所以只断言文档确实写了的
  const readmePath = process.env.DSH_WORK_ICON_WINDOW_README || join(PACKAGE_ROOT, 'runtime', 'electron', 'README.md')
  assert.ok(existsSync(readmePath), `审计锚点缺失（${readmePath}）`)
  const readme = readFileSync(readmePath, 'utf8')
  for (const documented of ['window.scale', 'window.opacity', 'window.alwaysOnTop', 'window.clickThrough', 'window.position', 'window.ratio']) {
    assert.ok(readme.includes(documented), `窗口侧 README 应仍记录 ${documented}（文档与实现不同步了）`)
  }
})

test('跨侧契约：窗口侧 README 记录的 5 个 setting 名字全部被宿主接受', () => {
  // 来源：runtime/electron/README.md —— "key 用宿主白名单命名：
  // window.scale / window.opacity / window.alwaysOnTop / window.clickThrough / window.position"
  // （window.autostart 已按决定删除，不在这里凑数）
  const windowKeys = [
    ['window.scale', 200],
    ['window.opacity', 80],
    ['window.alwaysOnTop', false],
    ['window.clickThrough', false],
    ['window.position', { x: 12, y: 34 }],
  ]
  let config = defaults()
  for (const [key, value] of windowKeys) {
    const next = applySetting(config, key, value)
    assert.ok(next, `窗口侧会发的 key 必须被接受：${key}`)
    config = next
  }
  assert.equal(config.window.scale, 200)
  assert.equal(config.window.opacity, 80)
  assert.equal(config.window.alwaysOnTop, false)
  assert.equal(config.window.clickThrough, false)
  assert.deepEqual(config.window.position, { x: 12, y: 34 })
  assert.deepEqual(
    SETTABLE_WINDOW_KEYS.slice().sort(),
    ['alwaysOnTop', 'clickThrough', 'fps', 'hoverBar', 'hoverPlate', 'hoverRows', 'opacity', 'panelAlpha', 'panelDetail', 'position', 'profile', 'ratio', 'scale'],
  )
  assert.deepEqual(SETTABLE_TOP_LEVEL_KEYS, ['includeSubagents'])
  // 落盘时只改 window.*，宿主自己的字段必须原样保留（窗口侧 README 的要求）
  const merged = applySetting({ ...defaults(), enabled: true, helper: { command: 'keep-me' } }, 'window.scale', 96)
  assert.equal(merged.enabled, true)
  assert.equal(merged.helper.command, 'keep-me')
  assert.equal(merged.window.scale, 96)
})

test('🐛 旧配置迁移：写死的旧默认 windowTimeoutMs=15000 要跟着新默认走，不能把旧默认永久钉住', () => {
  // 用户配置文件里往往存着"当时写下的默认值"。默认值演进（15s → 60s）时，
  // 若把 15000 当作用户的显式选择，新默认就永远生效不了 ✗。
  assert.equal(LEGACY_WINDOW_TIMEOUT_MS, 15000)
  assert.equal(sanitizeConfig({ windowTimeoutMs: LEGACY_WINDOW_TIMEOUT_MS }).windowTimeoutMs, 60000, '旧默认应迁移成新默认')
  // 用户显式设的**别的**值必须保留（迁移只认那一个旧默认）
  assert.equal(sanitizeConfig({ windowTimeoutMs: 20000 }).windowTimeoutMs, 20000)
  assert.equal(sanitizeConfig({ windowTimeoutMs: 90000 }).windowTimeoutMs, 90000)
  // 越界仍夹取
  assert.equal(sanitizeConfig({ windowTimeoutMs: 1 }).windowTimeoutMs, 1000)
})

test('configMessagePayload：SPEC 冻结的 5 个窗口字段 + v2 的 includeSubagents', () => {
  const payload = configMessagePayload({ window: { scale: 96, opacity: 80, alwaysOnTop: true, clickThrough: false, position: { x: 1, y: 2 } } })
  // 冻结的 5 个一个不多不少（字段名与语义不许变）
  for (const key of ['alwaysOnTop', 'clickThrough', 'opacity', 'position', 'scale']) {
    assert.ok(key in payload, `冻结字段 ${key} 必须还在`)
  }
  // v2 追加：窗口的「跟随子代理」勾选态靠它同步（原来只在启动读一次 ⇒ 勾选态永远是旧的 ✗）
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['alwaysOnTop', 'clickThrough', 'includeSubagents', 'opacity', 'position', 'scale'],
  )
  assert.equal(payload.includeSubagents, false, '未设置时如实是 false')
  assert.equal(configMessagePayload({ includeSubagents: true }).includeSubagents, true)
  assert.equal(payload.scale, 96)
  assert.equal(payload.opacity, 80)
  assert.equal(payload.clickThrough, false)
  assert.deepEqual(payload.position, { x: 1, y: 2 })
})

// ── 配置落盘留痕 + "只写非默认键"的安全性 ────────────────────────────────────

test('🐛 落盘留痕：每次真写都记下"谁写的 / 旧值→新值"（用户的 includeSubagents 翻 false 就靠它定位）', () => {
  const dir = tempDir()
  try {
    resetSaveLogLimiter()
    const file = join(dir, 'config.json')
    const lines = []
    const withFollow = { ...defaults(), includeSubagents: true }
    const without = { ...defaults(), includeSubagents: false }

    assert.equal(saveConfig(withFollow, { path: file, origin: 'window-setting:includeSubagents=true', diag: (l) => lines.push(l) }).ok, true)
    assert.equal(lines.length, 1, '第一次写必须留痕')
    assert.match(lines[0], /origin=window-setting:includeSubagents=true/u)
    assert.match(lines[0], /落盘键=\[/u)

    // 真正的"翻值"：必须记成 旧 → 新，且**不被限流吞掉**
    // ⚠️ 翻回默认值时该键会被省略、不进落盘集 —— 所以差异必须按完整配置算，否则这里会静默成"无变化" ✗
    assert.equal(saveConfig(without, {
      path: file,
      origin: 'window-setting:includeSubagents=false',
      previous: withFollow,
      diag: (l) => lines.push(l),
    }).ok, true)
    assert.equal(lines.length, 2, '值变了必须记，不能被限流吞')
    assert.match(lines[1], /includeSubagents: true → false/u, `应写明旧值→新值，实际：${lines[1]}`)
    // 同时能看出"这个键因为等于默认值而没落盘"
    assert.equal(/落盘键=\[[^\]]*includeSubagents/u.test(lines[1]), false, '翻回默认值后它不该出现在落盘键里')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('落盘留痕：内容没变的重复写要限流（不刷屏）', () => {
  const dir = tempDir()
  try {
    resetSaveLogLimiter()
    const file = join(dir, 'config.json')
    const lines = []
    const config = { ...defaults(), includeSubagents: true, window: { ...defaults().window, scale: 200 } }
    let clock = 1_000_000
    const opts = { path: file, origin: 'window-setting:window.scale=200', diag: (l) => lines.push(l), now: () => clock }
    saveConfig(config, { ...opts, previous: config })
    saveConfig(config, { ...opts, previous: config }) // 同一时刻再写一次，内容没变
    assert.equal(lines.length, 1, '5 秒内的无变化写入应被限流')
    clock += 6000
    saveConfig(config, { ...opts, previous: config })
    assert.equal(lines.length, 2, '超过限流窗口后应再记一条')
    assert.match(lines[1], /无（内容与上一次相同）/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('🐛 "只写非默认键"不会把 includeSubagents 写坏：等于默认就省略，不等于默认就如实保留', () => {
  // 这段逻辑是 2026-09-13 09:49 落的，而"翻 false"发生在 09:17–10:08 ⇒ 时间上值得先怀疑。
  // 用证据说话：它**不可能**写出 `includeSubagents: false`（等于默认值 → 直接省略），
  // 所以"文件里明确是 false"这件事不能由它解释。
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    // ① 等于默认（false）→ 该键被省略，文件里**没有** includeSubagents
    saveConfig({ ...defaults(), includeSubagents: false }, { path: file })
    const written1 = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal('includeSubagents' in written1, false, '等于默认值的键不该被写进文件')

    // ② 不等于默认（true）→ 必须写进去，且读回来还是 true（不漏写）
    saveConfig({ ...defaults(), includeSubagents: true }, { path: file })
    const written2 = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(written2.includeSubagents, true)

    // ③ 真实往返：盘上是 true → load → save 之后仍然是 true（用户勾着的状态不会被自己抹掉）
    const loaded = loadConfig({ path: file })
    assert.equal(loaded.includeSubagents, true)
    saveConfig(loaded, { path: file })
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).includeSubagents, true)
    assert.equal(loadConfig({ path: file }).includeSubagents, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── 跨侧绊线：第 2/4/5 项（默认值一致性 + 枚举词汇表 + 非法值回落） ──────────

test('绊线（默认值一致性）：4 个新键的默认值必须与窗口侧 DEFAULTS 逐键相同', () => {
  const mainPath = process.env.DSH_WORK_ICON_WINDOW_MAIN || join(PACKAGE_ROOT, 'runtime', 'electron', 'main.js')
  const main = readFileSync(mainPath, 'utf8')
  const theirs = windowDefaults(main)
  const mine = defaults().window

  // 需求：panelAlpha=0.78、panelDetail='tree'、hoverPlate='on'（profile 默认 standard）
  assert.equal(mine.panelAlpha, 0.78)
  assert.equal(mine.panelDetail, 'tree')
  assert.equal(mine.hoverPlate, 'on')
  assert.equal(mine.profile, 'standard')

  // 窗口侧必须已经在 DEFAULTS 里声明这 4 个键（缺了就是还没落地）
  for (const key of ['panelAlpha', 'profile', 'hoverPlate', 'panelDetail']) {
    assert.ok(
      key in theirs,
      `窗口侧 DEFAULTS 里还没有 window.${key} —— 两端要同时落地；在它落地前绊线会一直红，这是设计如此`,
    )
  }
  // 逐键比对**值**（含旧键）：任一侧改了默认值都会红
  for (const key of SHARED_WINDOW_KEYS) {
    if (!(key in theirs)) continue
    assert.deepEqual(
      mine[key],
      theirs[key],
      `window.${key} 的默认值两端不一致：宿主 ${JSON.stringify(mine[key])} vs 窗口 ${JSON.stringify(theirs[key])}`,
    )
  }
  // 提取器自检：至少认得出 11 个键和 0.78 这种浮点（防止断言退化成空转）
  assert.equal(Object.keys(theirs).length >= SHARED_WINDOW_KEYS.length, true, '提取器应认出全部共享键')
  assert.equal(typeof theirs.panelAlpha, 'number')
})

test('绊线（枚举词汇表）：profile / hoverPlate / panelDetail 的取值集合两端一致', () => {
  const mainPath = process.env.DSH_WORK_ICON_WINDOW_MAIN || join(PACKAGE_ROOT, 'runtime', 'electron', 'main.js')
  const main = readFileSync(mainPath, 'utf8')
  const pairs = [
    ['PROFILES', PROFILE_VALUES],
    ['HOVER_PLATES', HOVER_PLATE_VALUES],
    ['HOVER_ROWS', HOVER_ROWS_VALUES],
    ['HOVER_BARS', HOVER_BAR_VALUES],
    ['PANEL_DETAILS', PANEL_DETAIL_VALUES],
  ]
  for (const [name, mine] of pairs) {
    const theirs = windowArray(main, name)
    assert.ok(theirs, `窗口侧应有枚举常量 ${name}（拿不到说明它改名了，请更新提取逻辑）`)
    assert.deepEqual(theirs, [...mine], `${name} 取值集合两端不一致：窗口 ${JSON.stringify(theirs)} vs 宿主 ${JSON.stringify([...mine])}`)
  }
})

test('🐛 非法值回落：profile / panelDetail / hoverPlate / panelAlpha 收到非法值一律回默认，不写进配置', () => {
  // 文件通道：回落到默认值（配置不能因为一个手滑就坏掉）
  assert.equal(sanitizeConfig({ window: { profile: 'warp' } }).window.profile, 'standard')
  assert.equal(sanitizeConfig({ window: { panelDetail: 'fancy' } }).window.panelDetail, 'tree')
  assert.equal(sanitizeConfig({ window: { hoverPlate: 'maybe' } }).window.hoverPlate, 'on')
  assert.equal(sanitizeConfig({ window: { panelAlpha: 'x' } }).window.panelAlpha, 0.78)
  assert.equal(sanitizeConfig({ window: { panelAlpha: 5 } }).window.panelAlpha, 1, '越界夹取')
  assert.equal(sanitizeConfig({ window: { panelAlpha: -1 } }).window.panelAlpha, 0)
  // 合法值照常保留（含大小写与空白）
  assert.equal(sanitizeConfig({ window: { profile: 'eco' } }).window.profile, 'eco')
  assert.equal(sanitizeConfig({ window: { profile: ' ECO ' } }).window.profile, 'eco')
  assert.equal(sanitizeConfig({ window: { hoverPlate: 'off' } }).window.hoverPlate, 'off')
  /* 任务 B（2026-09-20）：hoverRows 默认 'off'（悬浮层那三行文字不画）；非法值回落、合法值保留 */
  assert.equal(sanitizeConfig({ window: { hoverRows: 'maybe' } }).window.hoverRows, 'off')
  assert.equal(sanitizeConfig({ window: { hoverRows: 'on' } }).window.hoverRows, 'on')
  /* 任务 C（2026-09-21）：hoverBar 默认 'off'（悬浮层那根 150px 横向计划进度条不画） */
  assert.equal(sanitizeConfig({ window: { hoverBar: 'maybe' } }).window.hoverBar, 'off')
  assert.equal(sanitizeConfig({ window: { hoverBar: 'on' } }).window.hoverBar, 'on')
  assert.equal(sanitizeConfig({ window: { panelDetail: 'columns' } }).window.panelDetail, 'columns')
  assert.equal(sanitizeConfig({ window: { panelAlpha: 0.5 } }).window.panelAlpha, 0.5)

  // setting 通道：**整体拒绝**（不写进配置，也不静默回退）
  const base = defaults()
  assert.equal(applySetting(base, 'window.profile', 'warp'), null)
  assert.equal(applySetting(base, 'window.panelDetail', 'fancy'), null)
  assert.equal(applySetting(base, 'window.hoverPlate', 'maybe'), null)
  assert.equal(applySetting(base, 'window.panelAlpha', 1.5), null)
  assert.equal(applySetting(base, 'window.panelAlpha', 'x'), null)
  // 合法值：接受并规范化
  assert.equal(applySetting(base, 'window.profile', 'eco').window.profile, 'eco')
  assert.equal(applySetting(base, 'window.profile', 'ECO').window.profile, 'eco')
  assert.equal(applySetting(base, 'window.panelDetail', 'columns').window.panelDetail, 'columns')
  assert.equal(applySetting(base, 'window.hoverPlate', 'off').window.hoverPlate, 'off')
  assert.equal(applySetting(base, 'window.panelAlpha', 0.5).window.panelAlpha, 0.5)
  // 扁平/下划线别名也认
  assert.equal(applySetting(base, 'panelDetail', 'simple').window.panelDetail, 'simple')
  assert.equal(applySetting(base, 'profile', 'smooth').window.profile, 'smooth')
})

test('🐛 fps 兼容别名：旧配置只写 fps 时 profile 由它推导，旧键不被丢掉', () => {
  // 旧配置（只有 fps）→ profile 推导出来
  const legacy = sanitizeConfig({ window: { fps: 'saver' } }).window
  assert.equal(legacy.profile, 'eco', 'saver ↔ eco（旧词汇 → 新词汇）')
  assert.equal(legacy.fps, 'saver', '旧键原样保留')
  assert.equal(sanitizeConfig({ window: { fps: 'smooth' } }).window.profile, 'smooth')
  assert.equal(sanitizeConfig({ window: { fps: 'standard' } }).window.profile, 'standard')
  // 正名优先
  const both = sanitizeConfig({ window: { profile: 'eco', fps: 'smooth' } }).window
  assert.equal(both.profile, 'eco')
  assert.equal(both.fps, 'saver', 'fps 被镜像成正名的旧词汇，老窗口读到的仍是同一档')
  // 自定义对象：没有对应剖面名 → profile 保持默认，对象原样保留
  const custom = sanitizeConfig({ window: { fps: { idle: 8, working: 30 } } }).window
  assert.equal(custom.profile, 'standard')
  assert.deepEqual(custom.fps, { idle: 8, working: 30 })
  // 两边都非法 → 全部回默认
  const bad = sanitizeConfig({ window: { profile: 'warp', fps: 'nonsense' } }).window
  assert.equal(bad.profile, 'standard')
  assert.equal(bad.fps, 'standard')
  // 通过 setting 改 profile 时，fps 也跟着镜像（落盘后老窗口仍一致）
  const moved = applySetting(defaults(), 'window.profile', 'eco')
  assert.equal(moved.window.profile, 'eco')
  assert.equal(moved.window.fps, 'saver')
})

test('🐛 新键与旧键一起往返：load → save 全程保留（含 4 个新键与 fps 镜像）', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify({
      enabled: true,
      window: { scale: 200, panelAlpha: 0.9, panelDetail: 'columns', hoverPlate: 'off', profile: 'smooth' },
    }), 'utf8')
    const loaded = loadConfig({ path: file })
    assert.equal(loaded.window.panelAlpha, 0.9)
    assert.equal(loaded.window.panelDetail, 'columns')
    assert.equal(loaded.window.hoverPlate, 'off')
    assert.equal(loaded.window.profile, 'smooth')
    assert.equal(loaded.window.fps, 'smooth', 'fps 镜像')
    assert.equal(saveConfig(loaded, { path: file }).ok, true)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(written.window.panelAlpha, 0.9)
    assert.equal(written.window.panelDetail, 'columns')
    assert.equal(written.window.hoverPlate, 'off')
    assert.equal(written.window.profile, 'smooth')
    assert.equal(written.window.scale, 200)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
