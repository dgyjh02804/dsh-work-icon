#!/usr/bin/env node
/* panel-lightness.mjs —— 面板底板「深浅档」的**像素口径**验收（2026-09-19，用户要求「这个底更浅」）
 *
 * 为什么口径必须这么写（本项目翻过车的两处）：
 *   ① 只读 getComputedStyle().color 是**名义色** —— 上一轮 30/30 全绿而用户看不清，真因在层叠不在颜色；
 *   ② 透明窗口的 capturePage **不叠桌面**：实测底板像素是「预乘前的底板色 + alpha≈199/204」，
 *      所以「用户实际看到的底」必须自己按**实测 alpha** 合成到真实壁纸之上。
 *      光量截图里的底板色 = 只在自己的深色测试底上量，用户在浅色壁纸下根本不是这个数。
 *
 * 三层口径（逐层都从真实渲染像素来）：
 *   fg            = 该文字矩形内**笔画像素**（相对底板比值最高的前 1% 像素平均色）
 *   bg(幕上)      = 同一矩形内**众数色**（字形之间的底板）
 *   bg(用户所见)  = α·bg(幕上) + (1-α)·壁纸像素    ← α 取该像素的**实测 alpha 通道**
 *   判据          = WCAG(fg, bg(用户所见)) ≥ 4.5（小字）/ 3.0（≥18px）
 *
 * 自检（把"合成公式猜错"钉死）：同一档 + `--bg white`（页面内**不透明**白底）的 run，
 * 其像素必须等于「transparent run 的像素按实测 alpha 合成到 255」——逐像素最大通道差 ≤ 2。
 *
 * 用法: node tests/panel-lightness.mjs
 * 产物: <runId>/panel-lightness/*.png  +  稳定交付路径 test/out/plate-tiers/preview-*.png
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { runRuntime, tmpHome, runDir, OUT, RUNTIME, readLog, killStrayElectron, section, report, sleep } from './harness.mjs'
/* 像素口径的公共件（2026-09-19 抽出去给 hover-plate.mjs 共用；本文件里原来的同名实现**原样**搬了过去，
   一行都没改）。抽出去的理由见 pixel-contrast.mjs 顶部：口径必须只有一份，否则两块板会各自漂。 */
import { pngDecode, lin, lum, ratio, rgbOf, fmt, measure } from './pixel-contrast.mjs'

const DIR = runDir('panel-lightness')
const PREVIEW = path.join(OUT, 'plate-tiers')          /* 稳定交付路径：给用户挑图用，不随 runId 跑掉 */
fs.mkdirSync(PREVIEW, { recursive: true })

let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

/* ---------- 真实壁纸（用户机器上的那张；找不到就明确失败，不许退化成"内置深色样本"） ---------- */
const WP_PATH = 'C:/Users/david/AppData/Roaming/Microsoft/Windows/Themes/TranscodedWallpaper'
if (!fs.existsSync(WP_PATH)) { console.log('[FAIL] 找不到真实壁纸 ' + WP_PATH + '：浅色底下的判据无法成立'); process.exit(1) }

/* ---------- PNG 解码 / WCAG / 取色：全部来自 tests/pixel-contrast.mjs（本轮抽出的公共件） ---------- */

/* ---------- 壁纸在窗口内的采样（与 v2.mjs 逐字同口径：cover + center 映射到 440×525 窗口） ---------- */
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const wpImg = await sharp(WP_PATH).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const WW = wpImg.info.width, WH = wpImg.info.height
const WS = Math.max(440 / WW, 525 / WH), WX = (WW * WS - 440) / 2, WY = (WH * WS - 525) / 2
function wpAt (x, y) {
  const sx = Math.min(WW - 1, Math.max(0, Math.round((x + WX) / WS)))
  const sy = Math.min(WH - 1, Math.max(0, Math.round((y + WY) / WS)))
  const i = (sy * WW + sx) * 4
  return [wpImg.data[i], wpImg.data[i + 1], wpImg.data[i + 2]]
}
/* 面板区域 4×4 网格（x/y 是窗口 CSS px） */
const GRID = []
for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
  const x = Math.round((gx + 0.5) * 440 / 4), y = Math.round(185 + (gy + 0.5) * 340 / 4)
  GRID.push({ x, y, c: wpAt(x, y) })
}
GRID.sort((a, b) => lum(b.c) - lum(a.c))
const WP_BRIGHT = GRID[0].c
const nearestWp = (x, y) => GRID.reduce((best, g) => (Math.hypot(g.x - x, g.y - y) < Math.hypot(best.x - x, best.y - y) ? g : best), GRID[0]).c
console.log('壁纸(真实文件) 面板区 4×4 最亮 = ' + fmt(WP_BRIGHT) + '  最暗 = ' + fmt(GRID[GRID.length - 1].c))

/* ---------- 一档一次离屏渲染（--shot-panel，全离屏；--hide hex= 是既有的"取色探针"通道） ---------- */
const payload = (now) => ({
  protocolVersion: 2, kind: 'state', state: 'WORKING', activity: 'coding',
  progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item', planChange: { from: 6, to: 11, at: now } },
  metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
  subagents: { total: 5, running: 2, done: 2, failed: 0, stopped: 1, unknown: 0, items: [
    { status: 'running', label: 'reviewer', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 },
    { status: 'done', label: 'tester', depth: 1, parent: null, startedAt: now - 90000, endedAt: now - 18000, toolCalls: 40 },
    { status: 'running', label: '检索参考图', depth: 2, parent: 'reviewer', startedAt: now - 12000, toolCalls: 6 }] },
  sessions: { total: 3, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] },
  todos: { items: [
    { content: '面板字体对比度整族横扫', status: 'done', depth: 1 },
    { content: '底板深浅三档实测', status: 'in_progress', depth: 0 },
    { content: '写 after 表 + 截图', status: 'pending', depth: 0 },
    { content: '项 4', status: 'pending', depth: 0 }], more: 5 },
  cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 },
  context: { applicable: true, used: 1200, limit: 128000, ratio: 0.009375 },
  tokens: { input: 1000, output: 50, total: 1050, cacheRead: 200, cacheWrite: 0, reasoning: 0 }
})

const wpHex = Buffer.from(WP_PATH, 'utf8').toString('hex')
async function render (tag, bg) {
  const dir = runDir('panel-lightness', tag)
  const pf = path.join(dir, 'payload.json')
  fs.writeFileSync(pf, JSON.stringify({ state: (function () { const p = payload(Date.now()); delete p.kind; delete p.protocolVersion; return p })(),
    text: { revision: 1, activityText: '正在写面板渲染', thoughtTail: '样板区不能再放假数字了', bodyTail: '好的' } }))
  const log = path.join(dir, 'main.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--shot', '240', '--shot-panel', '--shot-states', 'WORKING', '--out', dir,
    '--shot-payload', pf, '--settle-ms', '3200', '--bg', bg, '--hide', 'hex=' + wpHex, '--hidden'],
    { home: tmpHome('light-' + tag), log })
  const r = await st.waitExit(60000)
  killStrayElectron()
  const lg = readLog(log)
  const png = path.join(dir, 'shot-WORKING-240-' + bg + '.png')
  const probe = (lg.match(/renderer: panel probe\(after-v2\) n=\d+ :: [^\n]*/) || []).pop()
    || (lg.match(/panel probe\(after-v2\) n=\d+ :: [^\n]*/) || []).pop() || ''
  const plateM = lg.match(/panel plate\(after-v2\): (\d+),(\d+),(\d+),(\d+) dpr=([\d.]+)/)
  const tierM = lg.match(/plate tier=(\w+) source=(platetier|css-default|arg)/)
  let rows = []
  if (probe) rows = probe.split(' :: ')[1].split(' ; ').filter(Boolean).map((s) => s.split('|'))
  let img = null
  try { img = pngDecode(fs.readFileSync(png)) } catch (e) { /* 留给断言报错 */ }
  return { tag, bg, exit: r ? r.code : null, png, exists: fs.existsSync(png), img, rows, plateM, tier: tierM ? tierM[1] : null,
    tierSource: tierM ? tierM[2] : null, log }
}

/* 单个元素矩形内的众数色 + 笔画像素：见 tests/pixel-contrast.mjs 的 measure()（与本文件原实现逐字相同） */

section('底板深浅四档（含现档基线）—— 离屏渲染 + 像素口径对比度')
const TAGS = [['plate-t0', '现档基线'], ['plate-a', '档 a 浅一档'], ['plate-b', '档 b 浅两档'], ['plate-c', '档 c 浅三档']]
const RUNS = {}
for (const [bg, name] of TAGS) {
  const r = await render(bg, bg)
  RUNS[bg] = r
  console.log('  ' + name.padEnd(10) + ' exit=' + r.exit + '  png=' + (r.exists ? 'yes' : 'NO') + '  探针元素=' + r.rows.length +
    '  渲染层可见档位=' + (r.tier || '(无 plate tier 留痕)'))
  await sleep(200)
}
/* 合成口径自检用：同一档 + 页面内不透明白底 */
const W = await render('plate-b-white', 'white')
RUNS.white = W
console.log('  合成自检 run（--bg white）exit=' + W.exit + '  png=' + (W.exists ? 'yes' : 'NO'))

check('每个档位都真的渲染出了截图与取色探针（0 个元素 = 什么都没测，不许当通过）',
  TAGS.every(([bg]) => RUNS[bg].exists && RUNS[bg].rows.length >= 12),
  TAGS.map(([bg, n]) => n + ':' + RUNS[bg].rows.length).join('  '))

/* ---------- 合成口径自检：白底 run 必须等于「transparent run 按实测 alpha 合成到 255」 ---------- */
/* ---------- 合成口径自检：白底 run 的**底**色必须等于「transparent run 按实测 alpha 合成到 255」 ----------
   ⚠️ 只比**众数色（底）**，不比逐像素：页面内有不透明底时 Chromium 会切到 **LCD 次像素抗锯齿**，
   字形边缘会带 RGB 彩边（实测 (179,222,251) 这种纯彩边），那不是合成模型能复现的（也不是我们要量的东西）。
   对比度判据吃的正是"底"，所以自检也必须落在底上。 */
{
  const a = RUNS['plate-b'], b = W
  const boxMode = (img, x0, y0, x1, y1) => {
    const t = new Map()
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * 4
      const k = img.px[i] + ',' + img.px[i + 1] + ',' + img.px[i + 2] + ',' + img.px[i + 3]   /* 自检用**精确键**，不吃量化误差 */
      t.set(k, (t.get(k) || 0) + 1)
    }
    if (!t.size) return null
    const v = [...t.entries()].sort((p, q) => q[1] - p[1])[0][0].split(',').map(Number)
    return { rgb: [v[0], v[1], v[2]], a: v[3] / 255 }
  }
  let maxd = -1, worst = null, boxes = 0
  if (a.img && b.img && a.img.w === b.img.w && a.plateM && b.plateM) {
    maxd = 0
    const pa = a.plateM, pb = b.plateM, dpr = Number(pa[5]) || 2
    const X0 = Math.round(Number(pa[1]) * dpr), Y0 = Math.round(Number(pa[2]) * dpr)
    const Wd = Math.round(Number(pa[3]) * dpr), Hd = Math.round(Number(pa[4]) * dpr)
    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
      const cx = X0 + Math.round((gx + 0.5) * Wd / 4), cy = Y0 + Math.round((gy + 0.5) * Hd / 4)
      if (cx + 12 >= b.img.w || cy + 12 >= b.img.h) continue
      const ma = boxMode(a.img, cx - 12, cy - 12, cx + 12, cy + 12)
      const mb = boxMode(b.img, cx - 12, cy - 12, cx + 12, cy + 12)
      if (!ma || !mb) continue
      boxes++
      for (let k = 0; k < 3; k++) {
        const pred = ma.a * ma.rgb[k] + (1 - ma.a) * 255
        const d = Math.abs(pred - mb.rgb[k])
        if (d > maxd) { maxd = d; worst = { cx, cy, k, tr: ma.rgb, ta: ma.a, pred, got: mb.rgb[k] } }
      }
    }
  }
  if (worst && maxd > 2) console.log('    [诊断] 最大偏差在 (' + worst.cx + ',' + worst.cy + ') 通道' + worst.k +
    '：transparent rgb(' + worst.tr.join(',') + ') α=' + worst.ta.toFixed(3) + ' → 预测 ' + worst.pred.toFixed(1) + '，白底 run 实测 ' + worst.got)
  check('W1 合成口径自检：白底 run 的底 == transparent run 的底按实测 alpha 合成到 255（16 个采样块，逐通道差 ≤2）',
    maxd >= 0 && maxd <= 2, '最大通道差 ' + (Number.isFinite(maxd) ? maxd.toFixed(2) : maxd) + '（' + boxes + ' 个采样块）')
}

/* ---------- 每档的实测底板亮度（用户所见：合成到最亮壁纸） ---------- */
function plateStats (r) {
  if (!r.img) return null
  const m = r.plateM
  if (!m) return null
  const dpr = Number(m[5]) || 2
  const X0 = Math.round(Number(m[1]) * dpr) + 8, Y0 = Math.round(Number(m[2]) * dpr) + 8
  const X1 = Math.round((Number(m[1]) + Number(m[3])) * dpr) - 8, Y1 = Math.round((Number(m[2]) + Number(m[4])) * dpr) - 8
  const px = []
  for (let y = Y0; y < Y1; y += 3) for (let x = X0; x < X1; x += 3) {
    const i = (y * r.img.w + x) * r.img.bpp
    if (r.img.px[i + 3] < 120) continue
    px.push([r.img.px[i], r.img.px[i + 1], r.img.px[i + 2], r.img.px[i + 3]])
  }
  if (!px.length) return null
  const sortK = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)]
  const med = [sortK(0), sortK(1), sortK(2)]
  const aMed = sortK(3) / 255
  const seen = med.map((v, k) => aMed * v + (1 - aMed) * WP_BRIGHT[k])
  return { med, aMed, seen, seenL: lum(seen), n: px.length }
}
const ST = {}
for (const [bg, n] of TAGS) ST[bg] = plateStats(RUNS[bg])
for (const [bg, n] of TAGS) {
  const s = ST[bg]
  console.log('  ' + n.padEnd(10) + (s ? ('底板幕上 rgb(' + s.med.map(Math.round).join(',') + ') α=' + s.aMed.toFixed(3) +
    '  → 用户所见(最亮壁纸下) ' + fmt(s.seen) + ' 亮度 ' + s.seenL.toFixed(4)) : '（无底板像素）'))
}
const def = RUNS['plate-b']
check('L1 渲染层把"当前生效档位"留痕到日志（供机器判定生产默认档）', !!def.tier,
  'plate tier=' + def.tier + ' source=' + def.tierSource)

/* ---------- 文字对比度：真实合成口径（每个元素用它自己位置的壁纸采样 + 最亮壁纸悲观边界） ---------- */
/* 可见性口径与 v2.mjs ⑥/⑨ 逐字一致：#v2panel 是**可滚动**容器，滚出可视区的行不算"用户所见"，
   否则量到的是被裁掉的行（rect 里只剩底板像素 ⇒ 会把"没量到字"误报成对比度不足）。 */
const TIER_ROWS = {}
const SKIPPED = {}
for (const [bg, n] of TAGS) {
  const r = RUNS[bg]
  if (!r.img || !r.plateM) { TIER_ROWS[bg] = null; continue }
  const dpr = Number(r.plateM[5]) || 2
  const vm = readLog(r.log).match(/v2 place: top=(\d+) maxH=(\d+)/)
  const box = vm ? { top: Number(vm[1]), bottom: Number(vm[1]) + Number(vm[2]) } : null
  const rows = [], skip = []
  for (const row of r.rows) {
    const top = Number(row[2]), bot = top + Number(row[4])
    if (box && top >= box.top && bot > box.bottom + 1) { skip.push((row[0] || '').slice(0, 12) + '(滚出可视区)'); continue }
    const m = measure(r.img, row, dpr)
    if (!m) { skip.push((row[0] || '').slice(0, 12) + '(取不到像素)'); continue }
    const wpLocal = nearestWp(m.cx, m.cy)
    const mk = (wp) => [0, 1, 2].map((k) => m.aMode / 255 * m.bg[k] + (1 - m.aMode / 255) * wp[k])
    const need = m.size >= 18 ? 3.0 : 4.5
    rows.push({ ...m, need, rLocal: ratio(m.fg, mk(wpLocal)), rWorst: ratio(m.fg, mk(WP_BRIGHT)), bgLocal: mk(wpLocal), bgWorst: mk(WP_BRIGHT) })
  }
  TIER_ROWS[bg] = rows
  SKIPPED[bg] = skip
}
for (const [bg, n] of TAGS) {
  const rows = TIER_ROWS[bg]
  if (!rows || !rows.length) { console.log('  ' + n + '：没有可测元素'); continue }
  const worst = rows.reduce((a, b) => (b.rWorst < a.rWorst ? b : a))
  const worstLocal = rows.reduce((a, b) => (b.rLocal < a.rLocal ? b : a))
  console.log('  ' + n.padEnd(10) + '元素 ' + rows.length + ' 个' + (SKIPPED[bg] && SKIPPED[bg].length ? '（跳过 ' + SKIPPED[bg].length + ' 个：' + SKIPPED[bg].join('、') + '）' : ''))
  console.log('             最差(最亮壁纸悲观边界) ' + worst.rWorst.toFixed(2) + ':1  ' + worst.txt + ' {' + worst.cls +
    '} fg ' + fmt(worst.fg) + ' on ' + fmt(worst.bgWorst) + '  名义 ' + fmt(worst.nom))
  console.log('             最差(按各自位置壁纸)     ' + worstLocal.rLocal.toFixed(2) + ':1  ' + worstLocal.txt + ' {' + worstLocal.cls + '}')
}

check('L2 四档底板实测亮度严格递增（t0 < a < b < c，相邻差 ≥0.006）—— "更浅"必须是像素上真的更浅',
  (() => {
    const v = TAGS.map(([bg]) => (ST[bg] ? ST[bg].seenL : NaN))
    for (let i = 1; i < v.length; i++) if (!(v[i] - v[i - 1] >= 0.006)) return false
    return v.every(Number.isFinite)
  })(),
  TAGS.map(([bg, n]) => n + ' ' + (ST[bg] ? ST[bg].seenL.toFixed(4) : 'n/a')).join('  '))

check('L3 生产默认档（渲染层留痕的那一档）的底板实测亮度落在 [0.09, 0.19]（比现档 0.065 明显更浅、又不发白）',
  (() => { const s = ST['plate-' + String(def.tier || 'x')]; return !!s && s.seenL >= 0.09 && s.seenL <= 0.19 })(),
  (function () { const s = ST['plate-' + String(def.tier || 'x')]; return s ? ('档 ' + def.tier + ' 亮度 ' + s.seenL.toFixed(4)) : '无数据' })())

for (const [bg, n] of TAGS) {
  const rows = TIER_ROWS[bg]
  const bad = rows ? rows.filter((r) => r.rWorst < r.need) : []
  check('L4 ' + n + '：全部文字在"真实合成(最亮壁纸)"口径下达标（0 个元素同样算失败）',
    !!rows && rows.length >= 12 && bad.length === 0,
    bad.length ? (bad.length + ' 处 → ' + bad.slice(0, 5).map((r) => r.txt + ' ' + r.rWorst.toFixed(2) + ':1(需' + r.need + ')').join(' | '))
      : ((rows ? rows.length : 0) + ' 个元素全过，最低 ' + (rows && rows.length ? rows.reduce((a, b) => Math.min(a, b.rWorst), Infinity).toFixed(2) : 'n/a') + ':1'))
}
/* 文字笔画像素必须是不透明的 —— 否则"fg 用名义色"这件事本身就不成立 */
{
  const all = TAGS.flatMap(([bg]) => TIER_ROWS[bg] || [])
  const lowA = all.filter((r) => r.fgA < 250)
  check('L5 文字笔画像素实测 alpha ≥250（文字本身不被底板 α 压暗，fg 才等于名义色）',
    all.length >= 30 && lowA.length === 0, lowA.length ? (lowA.length + ' 处 → ' + lowA.slice(0, 4).map((r) => r.txt + ' a=' + r.fgA).join(' | ')) : (all.length + ' 个元素采样全 ≥250'))
}
/* 分区色：图形档不动 + 文字档仍达标且互相可区分 */
{
  const src = fs.readFileSync(path.join(RUNTIME, 'index.html'), 'utf8')
  const styleBlocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, ''))
  const all = src.toLowerCase()
  /* 图形档的 5 个原值散落在两处来源：CSS 规则（圆点/刻度/竖条）与 JS 里的内联 SVG 描边 / PC 常量。
     所以这里是**整文件**扫描（比只扫样式块更严）。 */
  const graphics = [['青', '#56d9c8'], ['金', '#ffc266'], ['淡蓝', '#6fb6ff'], ['紫', '#b79cff'], ['冷灰', '#9fb0c4']]
  const missing = graphics.filter(([n, h]) => !all.includes(h))
  check('L6 五个分区色的**图形档**一个都没被改动（圆点/刻度/竖条/描边仍用原值）',
    missing.length === 0, missing.length ? ('缺失：' + missing.map((x) => x[0] + x[1]).join(',')) : '青#56d9c8 金#ffc266 淡蓝#6fb6ff 紫#b79cff 冷灰#9fb0c4 全部在位')
  /* 防退化：旧的暗色值不许以**任何**形式回来。
     扫描范围 = 样式块里**承载文字的两类声明**：`color:#…` 与档位调色板 `--x:#…`
     （几何描边 `stroke="#…"` 与图形色 `border:… #…` 是图形档，不在文字判据内 —— 与 v2.mjs 的口径一致）。 */
  const FORBIDDEN = ['#92aac0', '#9db6cc', '#8fa8bd', '#a8bdd2', '#a8c4dc', '#a3b4c6', '#a8bccf',
    '#9db3c6', '#b9cada', '#cfdcea', '#c3d6e6', '#c9dbeb', '#b9cfe2', '#cdd9e6']
  const decls = styleBlocks.join('\n').match(/(?:^|[;{\s])(?:color\s*:|--[a-zA-Z0-9-]+\s*:)\s*(#[0-9a-fA-F]{3,8})/g) || []
  const declVals = decls.map((s) => (s.match(/(#[0-9a-fA-F]{3,8})$/) || [''])[0].toLowerCase())
  const hit = FORBIDDEN.filter((h) => declVals.indexOf(h) >= 0)
  check('L6b 旧的暗色值 0 命中（扫 color: 声明与档位调色板变量；几何描边不算文字档）',
    hit.length === 0, hit.length ? hit.join(',') : '0 命中 / 共禁 ' + FORBIDDEN.length + ' 个（扫描 ' + declVals.length + ' 条声明）')
  const rows = TIER_ROWS['plate-' + String(def.tier || 'x')] || []
  const zone = rows.filter((r) => r.cls === '.sl' || r.cls === '.mv')
  const distinct = zone.length >= 2 && (function () {
    for (let i = 0; i < zone.length; i++) for (let j = i + 1; j < zone.length; j++) {
      const d = Math.abs(zone[i].nom[0] - zone[j].nom[0]) + Math.abs(zone[i].nom[1] - zone[j].nom[1]) + Math.abs(zone[i].nom[2] - zone[j].nom[2])
      if (d > 0 && d < 25) return false
    }
    return true
  })()
  check('L7 分区色**文字档**仍互相可区分（任意两个分区色文字的 RGB 曼哈顿距离 ≥25，或本就不同色）',
    distinct, zone.length >= 2 ? zone.map((r) => r.cls + fmt(r.nom) + ' ' + r.rWorst.toFixed(2) + ':1').join(' | ') : '没测到分区色文字元素')
}
check('L8 α 仍由主进程下发（#plate 用 var(--panel-alpha)，没有把透明度写死进底档）',
  (() => { const s = fs.readFileSync(path.join(RUNTIME, 'index.html'), 'utf8'); const r = (s.match(/#plate\{[^}]*/) || [''])[0]; return r.includes('var(--panel-alpha') })(),
  '见 #plate 的 background 声明')

/* ---------- 交付图：把每档预览合成出来（真实壁纸 + 面板像素按实测 alpha 合成） ---------- */
const PREVIEWS = []
for (const [bg, n] of TAGS) {
  const r = RUNS[bg]
  if (!r.img) continue
  const buf = Buffer.alloc(r.img.w * r.img.h * 4)
  for (let y = 0; y < r.img.h; y++) for (let x = 0; x < r.img.w; x++) {
    const i = (y * r.img.w + x) * 4
    const al = r.img.px[i + 3] / 255
    const wp = wpAt(x / 2, y / 2)
    for (let k = 0; k < 3; k++) buf[i + k] = Math.round(al * r.img.px[i + k] + (1 - al) * wp[k])
    buf[i + 3] = 255
  }
  const f = path.join(PREVIEW, 'preview-' + bg.replace('plate-', '') + '.png')
  await sharp(buf, { raw: { width: r.img.w, height: r.img.h, channels: 4 } }).png().toFile(f)
  PREVIEWS.push({ name: n, file: f, w: r.img.w, h: r.img.h })
  console.log('  预览已合成: ' + f + '  ' + r.img.w + 'x' + r.img.h)
}
if (PREVIEWS.length === TAGS.length) {
  const gap = 18, lab = 34
  const CW = PREVIEWS[0].w, TH = PREVIEWS[0].h + lab
  const H = PREVIEWS.length * TH + gap * (PREVIEWS.length + 1)
  const parts = PREVIEWS.map((p, i) => {
    const y = gap + i * (TH + gap)
    const b64 = fs.readFileSync(p.file).toString('base64')
    return '<text x="24" y="' + (y + 22) + '" font-family="Consolas,monospace" font-size="20" fill="#e8f0fa">' +
      p.name + '</text><image x="0" y="' + (y + lab) + '" width="' + CW + '" height="' + p.h + '" href="data:image/png;base64,' + b64 + '"/>'
  }).join('')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + CW + '" height="' + H + '">' +
    '<rect width="100%" height="100%" fill="#0d1726"/>' + parts + '</svg>'
  const cmp = path.join(PREVIEW, 'preview-compare.png')
  await sharp(Buffer.from(svg)).png().toFile(cmp)
  console.log('  四档对比图: ' + cmp + '  ' + CW + 'x' + H)
}

section(ok ? '底板深浅：全部通过' : '底板深浅：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
