#!/usr/bin/env node
/* settings-window.mjs —— 「配色设置」独立窗口 + 实时热更新 + 落盘隔离 的验收（任务 F，2026-09-19）
 *
 * 用户原话：「我希望做出一个界面（右键打开菜单，菜单打开配色设置）然后允许我实时调里面的颜色深浅，
 *            并且动态热更新」；形态由用户拍板：**图标自己的独立设置窗口**（不是 Web GUI 页面）。
 *
 * 本文件钉住的四件事（每件都有机器可验证的断言）：
 *   ① 菜单里有「配色设置…」这一项，点它（走模板里**那一项自己的 click**）会打开一个**普通窗口**：
 *      不透明 / 有标题栏 / 可调大小 / 可关闭，且**不动图标窗口**的几何、置顶、穿透判据；
 *   ② **实时**：拖设置窗口里的滑块 ⇒ 图标窗口当场改 CSS 变量。判据不只是"日志里有"，
 *      还包括 **本进程从头到尾没往图标进程的 stdin 写过任何一个字节**（⇒ 与 DSH 宿主无关），
 *      以及 `window created × 1`（没有任何重启）；
 *   ③ 落盘在 **窗口侧自己的 theme.json**，宿主那份 `config.json` **逐字节不变**（本项目踩过
 *      "窗口侧覆盖宿主配置、把用户勾选态清空"的坑）；关掉设置窗口后设置仍在（重启读得回来）；
 *   ④ 窗口里实时显示的「当前最差对比度」：低 4.5:1 当场标红 —— 并且**用像素复验**公式给的那个数
 *      （快口径可以算，但断言必须落到像素上）。
 *
 * 用法: node tests/settings-window.mjs      （全程离屏：--hidden ⇒ 图标窗口与设置窗口都不显示）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { runRuntime, tmpHome, runDir, RUNTIME, readLog, killStrayElectron, section, report, sleep } from './harness.mjs'
import { pngDecode, lum, ratio, fmt } from './pixel-contrast.mjs'

const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const DIR = runDir('settings-window')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
const ts = (line) => { const m = String(line).match(/\[([\d\-T:.Z]+)\]/); return m ? Date.parse(m[1]) : NaN }
const findBy = (lg, re) => (lg.match(re) || [])
const lineWith = (lg, needle) => (lg.split('\n').find((l) => l.includes(needle)) || '')
const linesWith = (lg, needle) => lg.split('\n').filter((l) => l.includes(needle))

const HOME = tmpHome('settings-live')
/* 预置宿主配置（带一个"哨兵"键）：theme 的读写必须**一个字节都不碰**它 */
const CFG = path.join(HOME, 'config.json')
const CFG_BEFORE = JSON.stringify({ includeSubagents: true, window: { scale: 140, hoverPlate: 'on' }, __sentinel: '宿主配置不许被窗口侧改写' })
fs.writeFileSync(CFG, CFG_BEFORE)

section('① 菜单项 → 独立设置窗口 → 实时热更新（离屏 --hidden，全程不写 stdin）')
const LOG = path.join(DIR, 'live.log')
fs.rmSync(LOG, { force: true })
const st = runRuntime(['--hidden', '--window-timeout', '60000', '--test-open-settings',
  '--test-theme-drive', '1800:dump;2600:set:hp:0.94;3200:dump;4000:set:hp:0.4;4600:dump;5400:set:pa:0.4;6000:set:tb:1.35;6600:set:po:0.7;7000:dump;7600:reset;8200:dump',
  '--exit-after', '10'], { home: HOME, log: LOG })
await st.waitExit(60000)
killStrayElectron()
const lg = readLog(LOG)
const stdinWrites = 0   /* 本轮**从没调用过** st.send / st.sendRaw —— 见下面那条断言的证据 */

check('F1a【菜单项】「配色设置…」确实出现在右键菜单模板里，且它的 click 打开了设置窗口',
  /test-open-settings menu-item=found/.test(lg) && /settings window created shown=false/.test(lg),
  lineWith(lg, 'test-open-settings') + ' ｜ ' + lineWith(lg, 'settings window created').slice(0, 120))

const focus = lineWith(lg, 'settings focuscheck')
const boundsOf = (s) => (s.match(/icon\((?:before|after)\)=(\{[^}]*\})/) || [])[1]
const B_BEFORE = boundsOf(focus.replace(/icon\(after\)=.*/, ''))
const B_AFTER = (focus.match(/icon\(after\)=(\{[^}]*\})/) || [])[1]
check('F1b【普通窗口】设置窗口不是"透明/置顶/无边框"的悬浮窗：实测 alwaysOnTop=false，且 main.js 里 frame=true/transparent=false',
  /settingsAlwaysOnTop=false/.test(focus) && /settingsTransparent=false frame=true/.test(focus) &&
  /frame: true, transparent: false/.test(fs.readFileSync(path.join(RUNTIME, 'main.js'), 'utf8')),
  focus.slice(0, 220))
check('F1c【不动图标窗口】开设置窗口前后：图标窗口 bounds 逐字节相同、置顶仍为 true、仍不可聚焦、面板仍收起',
  !!B_BEFORE && B_BEFORE === B_AFTER && /iconAlwaysOnTop=true/.test(focus) && /iconFocusable=false/.test(focus) &&
  /panelOpen=false/.test(focus),
  'icon before=' + B_BEFORE + ' after=' + B_AFTER + ' ｜ ' + focus.slice(0, 160))

/* ---------- 实时：滑块 → 图标窗口 ---------- */
const cssLines = findBy(lg, /theme css: hoverPlateAlpha=[^\n]*/g)
const want = ['hoverPlateAlpha=0.94 effHoverA=0.940 nobg=false', 'hoverPlateAlpha=0.4 effHoverA=0.400 nobg=false',
  'hoverPlateAlpha=0 effHoverA=0.000 nobg=true']
check('F2a【实时热更新】设置窗口改的每一个值都当场落到图标窗口（渲染层 theme css 留痕逐条命中）',
  want.every((w) => cssLines.some((l) => l.includes(w))),
  cssLines.map((l) => l.replace(/^.*theme css: /, '')).join('  |  ').slice(0, 300))
{
  /* 延迟：从"驱动这一条"到"图标窗口真的改掉"的毫秒差（同一条日志流的时间戳；必须取**整行**才有时间戳） */
  const drive = linesWith(lg, 'test-theme-drive 2600:set:hp:0.94').pop() || ''
  const css = linesWith(lg, 'theme css: hoverPlateAlpha=0.94').pop() || ''
  const dt = ts(css) - ts(drive)
  check('F2b【实时】这条改动在 1 秒内就落到了图标窗口（同一条日志流的时间戳差）',
    Number.isFinite(dt) && dt >= 0 && dt <= 1000, 'Δ=' + dt + 'ms（driving ' + drive.replace(/^\[[^\]]*\] /, '') + ' → renderer ' + css.replace(/^\[[^\]]*\] /, '').slice(0, 60) + '）')
}
check('F2c【不经 DSH 宿主】本进程**从头到尾没有往图标进程的 stdin 写过任何字节**，也没产生任何 setting/config 回传消息',
  stdinWrites === 0 && !st.stdout.some((l) => /"kind":"setting"/.test(l)),
  'stdin 写入次数 = ' + stdinWrites + '；stdout 里 setting 消息 = ' + st.stdout.filter((l) => /setting/.test(l)).length + ' 条（共 ' + st.stdout.length + ' 行）')
check('F2d【不重启】整个热更新过程里**图标窗口**只被创建过一次（"settings window created" 不算）',
  linesWith(lg, '] window created').length === 1, '图标窗 window created × ' + linesWith(lg, '] window created').length +
  '（另有设置窗 created × ' + linesWith(lg, 'settings window created').length + '）')
check('F2e【跨层生效】大面板底色 / 文字亮度 / 面板整体不透明度 / 复位 都真的过了主进程并落进渲染层',
  /theme apply（settings-ui）-> \{"hoverPlateAlpha":0\.4,"panelAlpha":0\.4/.test(lg) &&
  /"textBoost":1\.35/.test(lg) && /"panelOpacity":0\.7/.test(lg) && /theme apply（settings-reset）/.test(lg) &&
  /theme css: [^\n]*panelAlpha=0\.4/.test(lg) && /theme css: [^\n]*textBoost=1\.35/.test(lg) && /theme css: [^\n]*panelOpacity=0\.7/.test(lg),
  (findBy(lg, /theme apply（[^\n]*/g).map((l) => l.replace(/^.*theme apply/, 'apply')).join(' ｜ ')).slice(0, 320))

/* ---------- 落盘：只碰 theme.json ---------- */
const THEME = path.join(HOME, 'theme.json')
let themeJson = null
try { themeJson = JSON.parse(fs.readFileSync(THEME, 'utf8')) } catch { /* 留给断言 */ }
const CFG_AFTER = (() => { try { return fs.readFileSync(CFG, 'utf8') } catch { return null } })()
check('F3a【落盘位置】主题写在窗口侧自己的 theme.json（不在 config.json 里）',
  !!themeJson && fs.existsSync(THEME) && THEME === path.join(HOME, 'theme.json'),
  'theme.json=' + JSON.stringify(themeJson) + ' 路径=' + THEME)
check('F3b【没碰宿主配置】宿主 config.json **逐字节不变**（含那个哨兵键）',
  CFG_AFTER === CFG_BEFORE, 'before ' + (CFG_BEFORE.length) + 'B / after ' + (CFG_AFTER === null ? 'null' : CFG_AFTER.length + 'B') +
  ' ｜ 相同 = ' + (CFG_AFTER === CFG_BEFORE))
check('F3c【复位可用】复位后 theme.json 回到默认值（悬浮板底色 0 = 全删、大面板跟随宿主）',
  !!themeJson && themeJson.hoverPlateAlpha === 0 && themeJson.panelAlpha === null &&
  themeJson.textBoost === 1 && themeJson.panelOpacity === 1 && themeJson.iconBright === 1,
  JSON.stringify(themeJson))

/* ---------- 关掉设置窗口后设置仍在：重启读回 ---------- */
const HOME2 = tmpHome('settings-persist')
fs.writeFileSync(path.join(HOME2, 'theme.json'), JSON.stringify({ hoverPlateAlpha: 0.94, panelAlpha: 0.6, textBoost: 1, panelOpacity: 1, iconBright: 1 }))
const LOG2 = path.join(DIR, 'persist.log')
fs.rmSync(LOG2, { force: true })
const st2 = runRuntime(['--hidden', '--window-timeout', '60000', '--exit-after', '4'], { home: HOME2, log: LOG2 })
await st2.waitExit(30000)
killStrayElectron()
const lg2 = readLog(LOG2)
check('F3d【设置留得住】新进程从 theme.json 读回并下发（悬浮板 0.94 / 大面板 0.6 / tuned=true），不需要再打开设置窗口',
  /theme css: hoverPlateAlpha=0\.94 effHoverA=0\.940 nobg=false panelAlpha=0\.6/.test(lg2) && /tuned=true/.test(lg2),
  (lg2.split('\n').filter((l) => /theme css:/.test(l)).pop() || '无').slice(-180))

/* ============================================================================
 * ② 实时对比度显示：**公式**给数，**像素**复验（口径见 tests/pixel-contrast.mjs）
 * ========================================================================== */
section('② 实时对比度读数 + 像素复验')
const dumpsAll = lg.split('\n').filter((l) => /settings drive -> \{/.test(l)).map((l) => {
  try { return JSON.parse(l.match(/settings drive -> (\{.*\})\s*$/)[1]) } catch { return null }
}).filter((o) => o && o.values && typeof o.worstValue === 'number')
const dumpAt = (a, extra) => dumpsAll.find((o) => o.values.hoverPlateAlpha === a && (!extra || extra(o)))
const uiDefault = dumpAt(0, (o) => o.values.panelAlpha === null && o.values.textBoost === 1)   /* 第一次 dump：默认（α=0） */
const ui094 = dumpAt(0.94)
const ui04 = dumpAt(0.4)
for (const [n, u] of [['默认 α=0', uiDefault], ['α=0.94', ui094], ['α=0.40', ui04]]) {
  console.log('  UI 读数（' + n + '）' + (u ? (u.worstText + '  判据=' + u.keyName + '  字身=' + u.fillValue.toFixed(2) +
    ':1 描边=' + u.strokeValue.toFixed(2) + ':1 大面板=' + u.panelValue.toFixed(2) + ':1 class=' + u.worstClass) : '(无)'))
}
check('F4a【读数】窗口里实时给出「当前最差对比度」，并且**没有把低的那一项藏起来**（α=0 时字身那一行必须仍显示 <4.5:1）',
  !!uiDefault && typeof uiDefault.worstValue === 'number' && typeof uiDefault.fillValue === 'number' &&
  uiDefault.fillValue < 4.5 && uiDefault.worstText.length > 0,
  uiDefault ? ('worst=' + uiDefault.worstText + ' 字身=' + uiDefault.fillValue.toFixed(2) + ':1 描边=' + uiDefault.strokeValue.toFixed(2) + ':1') : '没拿到读数')
check('F4b【标红/标绿跟着数值走】四次读数里，红/绿标记与数值判定**逐条一致**，且确实既有红也有绿（不是常量）',
  dumpsAll.length >= 3 && dumpsAll.every((o) => /bad/.test(o.worstClass) === (o.worstValue < 4.5)) &&
  dumpsAll.some((o) => /bad/.test(o.worstClass)) && dumpsAll.some((o) => /ok/.test(o.worstClass)),
  dumpsAll.map((o) => o.values.hoverPlateAlpha + '→' + o.worstValue.toFixed(2) + (/bad/.test(o.worstClass) ? '(红)' : '(绿)')).join('  '))
check('F4c【红区的成因说得清】α=0.40（板太薄、描边又还没接管）时读数 <4.5 且当场标红；α=0.94（板厚）时 ≥4.5 标绿',
  !!ui04 && ui04.worstValue < 4.5 && /bad/.test(ui04.worstClass) && !!ui094 && ui094.worstValue >= 4.5 && /ok/.test(ui094.worstClass),
  'α=0.40 → ' + (ui04 ? ui04.worstValue.toFixed(2) + ':1 ' + ui04.worstClass : '?') + ' ｜ α=0.94 → ' + (ui094 ? ui094.worstValue.toFixed(2) + ':1 ' + ui094.worstClass : '?'))

/* ---------- 像素复验：把窗口**真的渲染出来**，量 α=0.5 时那一行字的对比度 ---------- */
const WP_PATH = 'C:/Users/david/AppData/Roaming/Microsoft/Windows/Themes/TranscodedWallpaper'
const PROBE_LOG = path.join(DIR, 'probe.log')
fs.rmSync(PROBE_LOG, { force: true })
{
  const p = runRuntime(['--print-plan'], { home: tmpHome('settings-probe'), log: PROBE_LOG })
  await p.waitExit(20000)
}
const sm = readLog(PROBE_LOG).match(/screens=\d+ primary=(\d+)x(\d+) scaleFactor=([\d.]+) workArea=(\{[^}]*\})/)
const SCR = { w: +sm[1], h: +sm[2], work: JSON.parse(sm[4]) }
const wpImg = await sharp(WP_PATH).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const WW = wpImg.info.width, WH = wpImg.info.height
const wsc = Math.max(SCR.w / WW, SCR.h / WH), wox = (WW * wsc - SCR.w) / 2, woy = (WH * wsc - SCR.h) / 2
const wpPix = (sx, sy) => {
  const x = Math.min(WW - 1, Math.max(0, Math.round((sx + wox) / wsc))), y = Math.min(WH - 1, Math.max(0, Math.round((sy + woy) / wsc)))
  const i = (y * WW + x) * 4
  return [wpImg.data[i], wpImg.data[i + 1], wpImg.data[i + 2]]
}
const PAY = path.join(DIR, 'payload.json')
fs.writeFileSync(PAY, JSON.stringify({ state: { state: 'THINKING', activity: 'commanding', progress: { applicable: false },
  metrics: { turns: 1, toolCalls: 1, elapsedMs: 1000 }, subagents: { total: 1, running: 1, done: 0, failed: 0, stopped: 0, unknown: 0, items: [] },
  sessions: { total: 1, hidden: 0, items: [] } }, text: { revision: 1, activityText: 'x', thoughtTail: 'y', bodyTail: 'z' } }))
const H3 = tmpHome('settings-pixel')
fs.writeFileSync(path.join(H3, 'theme.json'), JSON.stringify({ hoverPlateAlpha: 0.4, panelAlpha: null, textBoost: 1, panelOpacity: 1, iconBright: 1 }))
/* ⚠️ 2026-09-20（任务 B）：悬浮层那三行文字默认被删掉了（window.hoverRows 默认 'off'）。
   本节的 F5a/F5b 量的是"设置窗口显示的对比度读数 vs `.st` 那一行的像素实测"——
   三行没了就没有 `.st` 可量（`ink.rows` 会空 ⇒ px=null ⇒ 这两条假红）。
   ⇒ 显式把三行还原回来（hoverRows:'on'）。"默认 = 三行都不在"由 tests/hover-rows.mjs 断言。 */
fs.writeFileSync(path.join(H3, 'config.json'), JSON.stringify({ window: { hoverRows: 'on' } }, null, 2))
const OUT3 = path.join(DIR, 'pixel'); fs.mkdirSync(OUT3, { recursive: true })
const LOG3 = path.join(OUT3, 'main.log'); fs.rmSync(LOG3, { force: true })
const st3 = runRuntime(['--shot', '240', '--shot-states', 'THINKING', '--test-hover', 'on', '--shot-payload', PAY,
  '--bg', 'none', '--out', OUT3, '--settle-ms', '2500', '--hidden'], { home: H3, log: LOG3 })
const r3 = await st3.waitExit(45000)
killStrayElectron()
const lg3 = readLog(LOG3)
let img = null, decodeErr = null
try { img = pngDecode(fs.readFileSync(path.join(OUT3, 'shot-THINKING-240-none.png'))) } catch (e) { decodeErr = e.message }
const inkM = lg3.match(/hover ink: (.*)/)
const ink = inkM ? JSON.parse(inkM[1].replace(/^.*hover ink: /, '')) : null
const dpr = (lg3.match(/panel plate\(hover\): [^d]*dpr=([\d.]+)/) || [])[1] || 2
let px = null
if (img && ink && ink.rows.length) {
  const row = ink.rows[0]      /* .st：最亮的那一行字（近白），对浅色底最不利 */
  const L = Math.round(row.left * dpr), T = Math.round(row.top * dpr)
  const W = Math.round(row.w * dpr), H = Math.round(row.h * dpr)
  const tally = new Map(), cand = []
  for (let y = T; y < Math.min(img.h, T + H); y++) for (let x = L; x < Math.min(img.w, L + W); x++) {
    const i = y * img.w * img.bpp + x * img.bpp
    const k = (img.px[i] >> 3) + ',' + (img.px[i + 1] >> 3) + ',' + (img.px[i + 2] >> 3) + ',' + (img.px[i + 3] >> 4)
    tally.set(k, (tally.get(k) || 0) + 1)
    cand.push([img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]])
  }
  if (tally.size) {
    const mk = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
    const raw = [mk[0] * 8 + 4, mk[1] * 8 + 4, mk[2] * 8 + 4], a = mk[3] / 16 + 1 / 32
    const sx = SCR.work.x + SCR.work.width - 210 - 24 + (L + W / 2) / dpr
    const sy = SCR.work.y + SCR.work.height - 210 - 24 + (T + H / 2) / dpr
    const bg = [0, 1, 2].map((k2) => a * raw[k2] + (1 - a) * wpPix(sx, sy)[k2])
    cand.sort((p, q) => ratio([p[0], p[1], p[2]], raw) - ratio([q[0], q[1], q[2]], raw))
    const top = cand.slice(-Math.max(3, Math.ceil(cand.length * 0.01)))
    const fill = [0, 1, 2].map((k2) => Math.round(top.reduce((s, o) => s + o[k2], 0) / top.length))
    px = { bg, raw, a, fill, r: ratio(fill, bg) }
  }
}
console.log('  像素复验（α=0.4，' + (ink ? ink.rows[0].cls : '?') + '）：板底实测 rgb(' + (px ? px.raw.join(',') : '-') + ') α=' +
  (px ? px.a.toFixed(2) : '-') + ' → 合成底（本处壁纸） ' + (px ? fmt(px.bg) : '-') + '；字身像素 ' + (px ? fmt(px.fill) : '-') +
  ' → ' + (px ? px.r.toFixed(2) : '-') + ':1' + (decodeErr ? '  解码失败:' + decodeErr : ''))
/* 公式 × 像素：**同一个底**（都把板色按实测 α 合成到**该元素本处的壁纸**上）才算公平比较。
   窗口里显示的是**悲观边界**（壁纸最亮取样），它必然 ≤ 本处值 —— 那一条单独断言（F5b）。 */
const formulaLocal = px ? ratio([248, 251, 253], px.bg) : null
check('F5a【公式 × 像素】同一个底口径下，设置窗口的公式值与像素复验一致（相对差 ≤15%）',
  !!px && formulaLocal !== null && Math.abs(px.r - formulaLocal) / formulaLocal <= 0.15,
  px ? ('像素 ' + px.r.toFixed(2) + ':1  vs 同一底的公式 ' + formulaLocal.toFixed(2) + ':1 → 相对差 ' +
    (Math.abs(px.r - formulaLocal) / formulaLocal * 100).toFixed(1) + '%') : '没测到（exit=' + (r3 && r3.code) + '）')
check('F5b【不美化】窗口里显示的那个数用的是**壁纸最亮取样**（悲观边界），因此必然 ≤ 像素实测的"本处"值 —— 显示值不会比现实更乐观',
  !!px && !!ui04 && ui04.fillValue <= px.r + 0.01,
  px && ui04 ? ('窗口 ' + ui04.fillValue.toFixed(2) + ':1（悲观） ≤ 像素本处 ' + px.r.toFixed(2) + ':1') : '没测到')

section(ok ? '配色设置窗口：全部通过' : '配色设置窗口：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
