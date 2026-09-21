#!/usr/bin/env node
/* hover-plate.mjs —— 图标下那块「悬浮信息板」（#v2hover）的底被**全删**之后的像素口径验收
 *                    任务 E，2026-09-19。用户原话：「把这个图2的黑框全删了」。
 *
 * 这块板显示的是：`THINKING · commanding` / `计划 ——（本宿主不适用）` / `进程 主 · 1 跑 · 共 1`
 * （= #v2hover 的 .st / .bl / .h3 三行）。"黑框"= 改动前 `#v2hover.plate` 那条
 * `background:rgba(11,22,36,.94); border:1px solid rgba(74,127,168,.85); border-radius:5px`。
 *
 * 本轮口径（一页写完，谁都别改口径不写注释）：
 *   ① **像素**，不是名义色（本项目第一次翻车就是只读 getComputedStyle）；
 *   ② 透明窗口的 capturePage **不叠桌面**（本测试开头用"同一帧带/不带 --hide hex=<壁纸> 逐像素一致"
 *      再做一次自证）⇒ 用户所见 = α·截图像素 + (1-α)·真实壁纸像素；
 *   ③ 壁纸取样按**屏幕坐标**映射（壁纸铺满屏幕；窗口在生产里默认钉在右下角，四个屏幕角位形全取一遍）；
 *   ④ 解码器先用**自造已知图往返**自证（maxErr 必须 = 0），再拿它去量产品像素。
 *
 * 三个被对比的状态（同一套像素口径）：
 *   A 改动前 · 有底      —— 老代码 + 默认（hoverPlate=on）：近黑薄板
 *   B 改动前 · 无底      —— 老代码 + 只有 .noplate 那版补偿（-webkit-text-stroke:2.2px）
 *                          （这就是用户之前投诉"看不清"的那一版；旧代码里 V2PLATE 恒为 'on'，
 *                            所以基线副本里做了一个**只改一个 token** 的机械反向还原 on→off）
 *   C 改动后 · 全删底    —— 新代码 + 默认（--hover-plate-a:0）：无底/无框/无圆角 + 3px 描边补偿
 *
 * 用法: node tests/hover-plate.mjs        （全程离屏：--hidden，不显示窗口、不合成任何输入）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { runRuntime, tmpHome, runDir, RUNTIME, HERE, ELECTRON, readLog, killStrayElectron, trackSpawn, section, report, sleep } from './harness.mjs'
import { pngDecode, lum, ratio, rgbOf, fmt, decoderSelfCheck } from './pixel-contrast.mjs'

const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const DIR = runDir('hover-plate')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
/* 改动前的运行时副本（"机械反向还原"出来的干净基线：本轮改动之前那一份 index.html/main.js）。
   它只用来产生"改动前"的像素，**不参与**任何断言之外的逻辑。
   本文件在**基线副本自己里面**跑（红因取证）时，副本里没有嵌套的 before-efg ⇒ 退回"我自己就是基线"。 */
const NESTED_BASE = path.resolve(RUNTIME, 'test', 'out', 'before-efg', 'electron')
const BASE = fs.existsSync(path.join(NESTED_BASE, 'index.html')) ? NESTED_BASE : RUNTIME
const HAS_BASE = fs.existsSync(path.join(BASE, 'index.html'))

section('① 解码器自证 + 壁纸取样')
/* ---------- 0. 解码器自证：自造已知图 → PNG → 解码 → 逐字节差必须 0 ---------- */
const self = await decoderSelfCheck(sharp, DIR, fs, path)
check('D1 PNG 解码器自证：自造已知 RGBA 图往返逐字节误差 = 0（量产品像素之前先证明尺子是准的）',
  self.maxErr === 0 && self.w === 96 && self.h === 64 && self.bpp === 4,
  '往返 ' + self.w + 'x' + self.h + ' bpp=' + self.bpp + ' maxErr=' + self.maxErr + '  （' + self.file + '）')

/* ---------- 屏幕尺寸：从运行时**自己的日志**读（不猜机器） ---------- */
const PROBE_LOG = path.join(DIR, 'probe.log')
fs.rmSync(PROBE_LOG, { force: true })
{
  const st = runRuntime(['--print-plan'], { home: tmpHome('hp-probe'), log: PROBE_LOG })
  await st.waitExit(20000)
}
const screenLine = (readLog(PROBE_LOG).match(/screens=\d+ primary=(\d+)x(\d+) scaleFactor=([\d.]+) workArea=(\{[^}]*\})/) || [])
const SCR = screenLine.length ? { w: Number(screenLine[1]), h: Number(screenLine[2]), dprScale: Number(screenLine[3]), work: JSON.parse(screenLine[4]) } : null
check('D2 拿到本机屏幕/工作区（壁纸按屏幕坐标映射，必须用实测值）', !!SCR,
  SCR ? ('primary=' + SCR.w + 'x' + SCR.h + ' scaleFactor=' + SCR.dprScale + ' workArea=' + JSON.stringify(SCR.work)) : '日志里没读到')
if (!SCR) { section('悬停板：有失败项'); process.exit(1) }

/* ---------- 真实壁纸（用户机器上那张；找不到就明确失败，不许退化成"内置深色样本"） ---------- */
const WP_PATH = 'C:/Users/david/AppData/Roaming/Microsoft/Windows/Themes/TranscodedWallpaper'
if (!fs.existsSync(WP_PATH)) { console.log('[FAIL] 找不到真实壁纸 ' + WP_PATH); process.exit(1) }
const wpImg = await sharp(WP_PATH).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const WW = wpImg.info.width, WH = wpImg.info.height
const wsc = Math.max(SCR.w / WW, SCR.h / WH), wox = (WW * wsc - SCR.w) / 2, woy = (WH * wsc - SCR.h) / 2
const wpPix = (sx, sy) => {
  const x = Math.min(WW - 1, Math.max(0, Math.round((sx + wox) / wsc)))
  const y = Math.min(WH - 1, Math.max(0, Math.round((sy + woy) / wsc)))
  const i = (y * WW + x) * 4
  return [wpImg.data[i], wpImg.data[i + 1], wpImg.data[i + 2]]
}
console.log('  壁纸文件 ' + WW + 'x' + WH + '  →  屏幕 ' + SCR.w + 'x' + SCR.h + '（cover scale=' + wsc.toFixed(3) + '）')

/* 悬浮板在窗口里的足迹（CSS px）：改动后实测 204x55（改动前 206x57 —— 边框归零每边少 1px）。
   窗口（图标窗）生产尺寸 = 210x210（scale=140）。这里把窗口摆到工作区的**四个角**，取最亮的一块当悲观边界。 */
const WIN = 210, PLATE_BOX = { w: 204, h: 56 }
const spots = [
  { x: SCR.work.x, y: SCR.work.y },
  { x: SCR.work.x + SCR.work.width - WIN, y: SCR.work.y },
  { x: SCR.work.x, y: SCR.work.y + SCR.work.height - WIN },
  { x: SCR.work.x + SCR.work.width - WIN, y: SCR.work.y + SCR.work.height - WIN }   /* ← 生产默认（右下角） */
]
let WP_WORST = [0, 0, 0], WP_WORST_AT = null, WP_BRIGHT_1PX = [0, 0, 0]
for (const s of spots) {
  for (let y = 0; y < PLATE_BOX.h; y += 2) for (let x = 0; x < PLATE_BOX.w; x += 2) {
    const c = wpPix(s.x + x, s.y + y)
    if (lum(c) > lum(WP_WORST)) { WP_WORST = c; WP_WORST_AT = { x: s.x + x, y: s.y + y } }
  }
}
/* 参考：全屏最亮的一个点（不用它当判据 —— 单个镜面高光不代表性；只打印出来作对照） */
for (let y = 0; y < SCR.h; y += 3) for (let x = 0; x < SCR.w; x += 3) {
  const c = wpPix(x, y)
  if (lum(c) > lum(WP_BRIGHT_1PX)) WP_BRIGHT_1PX = c
}
console.log('  悬浮板足迹(4 个屏幕角)最亮取样 = ' + fmt(WP_WORST) + ' 亮度 ' + lum(WP_WORST).toFixed(4) +
  ' @屏幕' + JSON.stringify(WP_WORST_AT) + '   参考：全屏最亮点 ' + fmt(WP_BRIGHT_1PX) + ' 亮度 ' + lum(WP_BRIGHT_1PX).toFixed(4))

/* ============================================================================
 * 渲染：三个状态各离屏抓一帧（--hidden；窗口从不显示；不合成任何输入）
 * ========================================================================== */
const now = Date.now()
const PAYLOAD = path.join(DIR, 'payload.json')
fs.writeFileSync(PAYLOAD, JSON.stringify({
  state: {
    state: 'THINKING', activity: 'commanding',
    progress: { applicable: false, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item' },
    metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
    subagents: { total: 1, running: 1, done: 0, failed: 0, stopped: 0, unknown: 0,
      items: [{ status: 'running', label: 'commanding', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 }] },
    sessions: { total: 1, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] }
  },
  text: { revision: 1, activityText: '正在写面板渲染', thoughtTail: '样板区不能再放假数字了', bodyTail: '好的' }
}))
/* 基线副本里那两处**纯机械**的还原（都只写进基线副本，绝不碰真树）：
   ① 「无底」那一轮：老代码的 V2PLATE 恒为 'on'（v2ApplyWindow 是死代码，宿主的 hoverPlate
      从来到不了渲染层 —— 本轮实测确认），所以只能把那个 token 机械地翻成 'off'，才能量到
      "改动前 · 无底（.noplate 2.2px 描边）"那一版；
   ② **只加仪器、不改视觉**：老代码没有 `hover ink` 这条留痕，把本轮新增的那个只读打印函数
      原样注入进去，两版才有**同一条**取证通道（注入的是纯读取 + BRIDGE.log，不碰任何样式/几何）。 */
const BASELINE_INK_FN =
  "function v2LogHoverInk (host) {\n" +
  "  try {\n" +
  "    var rows = []\n" +
  "    ;['.st', '.h3', '.bl'].forEach(function (sel) {\n" +
  "      var el = host.querySelector(sel)\n" +
  "      if (!el) return\n" +
  "      var r = el.getBoundingClientRect()\n" +
  "      var cs = window.getComputedStyle(el)\n" +
  "      rows.push({ cls: sel, text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),\n" +
  "        left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),\n" +
  "        color: cs.color, fontSize: parseFloat(cs.fontSize),\n" +
  "        strokeW: cs.webkitTextStrokeWidth || '', strokeC: cs.webkitTextStrokeColor || '', shadow: cs.textShadow })\n" +
  "    })\n" +
  "    var hv = document.getElementById('v2hover')\n" +
  "    var hvcs = hv ? window.getComputedStyle(hv) : null\n" +
  "    BRIDGE.log('hover ink: ' + JSON.stringify({ effPlateA: (String((document.getElementById('v2hover')||{}).className||'').indexOf('noplate') >= 0 ? 0 : 0.94), cls: hv ? String(hv.className) : '',\n" +
  "      plateBg: hvcs ? hvcs.backgroundColor : '', plateBorderW: hvcs ? hvcs.borderTopWidth : '',\n" +
  "      plateRadius: hvcs ? hvcs.borderTopLeftRadius : '', rows: rows }))\n" +
  "  } catch (e) { BRIDGE.log('hover ink ERR: ' + (e && e.message ? e.message : String(e))) }\n" +
  "}\n"
function baselineIndex (noplate) {
  const f = path.join(BASE, 'index.html')
  let src = fs.readFileSync(f, 'utf8')
  const before = src
  src = src.replace('function v2LogHoverInv () {', BASELINE_INK_FN + 'function v2LogHoverInv () {')
  src = src.replace("} catch (e) { BRIDGE.log('hover inv ERR: '", "v2LogHoverInk(host)\n  } catch (e) { BRIDGE.log('hover inv ERR: '")
  if (noplate) src = src.replace("var V2DETAIL = 'tree', V2PLATE = 'on'", "var V2DETAIL = 'tree', V2PLATE = 'off'")
  if (src === before) throw new Error('基线副本注入失败：锚点没找到，别拿一个没改的副本当基线')
  if (!/v2LogHoverInk\(host\)/.test(src)) throw new Error('基线副本注入失败：调用点没插进去')
  if (noplate && !/V2PLATE = 'off'/.test(src)) throw new Error('基线副本反向还原失败：V2PLATE 那一行没找到')
  return src
}

async function run (tag, { app, themeJson, configJson, extra = [], noplateBaseline, hoverOff }) {
  const home = tmpHome('hp-' + tag)
  if (themeJson !== undefined) fs.writeFileSync(path.join(home, 'theme.json'), JSON.stringify(themeJson, null, 2))
  if (configJson !== undefined) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(configJson, null, 2))
  const out = path.join(DIR, tag); fs.mkdirSync(out, { recursive: true })
  const log = path.join(out, 'main.log'); fs.rmSync(log, { force: true })
  const args = ['--shot', '240', '--shot-states', 'THINKING']
  if (!hoverOff) args.push('--test-hover', 'on')      /* 悬停关闭那一帧不加这个开关（图标状态仍由同一份 payload 驱动） */
  args.push('--shot-payload', PAYLOAD, '--bg', 'none', '--out', out, '--settle-ms', '2500',
    '--hidden', '--home', home, '--log', log, ...extra)
  let st
  if (!app) st = runRuntime(args, {})
  else {
    /* 基线副本：index.html 按需注入仪器 / 机械反向还原（都只落在 test/out 下的副本里） */
    const useDir = path.join(DIR, 'base-' + tag)
    fs.mkdirSync(useDir, { recursive: true })
    for (const f of ['main.js', 'index.html', 'preload.js', 'package.json']) fs.copyFileSync(path.join(BASE, f), path.join(useDir, f))
    fs.writeFileSync(path.join(useDir, 'index.html'), baselineIndex(!!noplateBaseline))
    const nm = path.join(useDir, 'node_modules')
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(RUNTIME, 'node_modules'), nm, 'junction')
    app = useDir
    const proc = spawn(ELECTRON, [app, ...args], { cwd: app, stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, env: Object.assign({}, process.env, { ELECTRON_DISABLE_WARNINGS: '1' }) })
    trackSpawn(proc.pid, home)
    const stdout = []
    proc.stdout.on('data', (b) => stdout.push(String(b)))
    const done = new Promise((r) => proc.on('exit', (code) => r({ code })))
    proc.stdin.end()
    st = { waitExit: (ms) => Promise.race([done, sleep(ms).then(() => null)]), stdout, kill: () => { try { proc.kill() } catch { /* ignore */ } } }
  }
  const r = await st.waitExit(45000)
  killStrayElectron()
  const lg = readLog(log)
  const png = path.join(out, 'shot-THINKING-240-none.png')
  let img = null, decodeErr = null
  try { img = pngDecode(fs.readFileSync(png)) } catch (e) { decodeErr = e && e.message ? e.message : String(e) }
  const ink = (lg.match(/hover ink: (.*)/g) || []).pop()
  const geoms = lg.match(/hover geom\(hover\)[^\n]*/g) || []
  const geom = geoms.filter((l) => /display=block/.test(l)).pop() || geoms.pop() || ''
  const lay = (lg.match(/panel layout\(hover\): [^\n]*/g) || []).pop() || ''
  /* ⚠️ `.match()` 带捕获组时 `.pop()` 拿到的是**最后一个捕获组**而不是整条匹配
     （这里曾经这么错过：dpr 变成 NaN ⇒ 采样循环一次都不跑 ⇒ 断言里出现"0 个采样"）。
     所以一律取 [0] 整条匹配。 */
  const pm = lg.match(/panel plate\((?:after-v2|hover)\): (\d+),(\d+),(\d+),(\d+) dpr=([\d.]+)/)
  const plate = pm ? pm[0] : ''
  return { tag, exit: r ? r.code : null, img, decodeErr, ink: ink ? JSON.parse(ink.replace(/^.*hover ink: /, '')) : null,
    geom, geoms, lay, plate, log, exists: fs.existsSync(png) }
}

section('② 三个状态各抓一帧（离屏 --hidden）')
const A = await run('A-before-plate', { app: BASE })
const B = await run('B-before-noplate', { app: BASE, noplateBaseline: true })
/* ⚠️ 2026-09-20（任务 B）：悬浮层那**三行文字默认被删掉**了（window.hoverRows 默认 'off'）。
   而本测试 ③④ 节量的正是"那三行文字在没有底的浅色壁纸上还剩多少对比度" —— 文字没了就没得量。
   ⇒ C/D 两帧**显式带上 hoverRows:'on'**（= 把三行原样还原回来那一档），本节既有断言才继续有意义。
     "默认 = 三行都不在"由 tests/hover-rows.mjs 专门断言（两个方向都起真实进程）。 */
const C = await run('C-after-delete', { themeJson: { hoverPlateAlpha: 0 }, configJson: { window: { hoverRows: 'on' } } })
const D = await run('D-after-094', { themeJson: { hoverPlateAlpha: 0.94 }, configJson: { window: { hoverRows: 'on' } } })
/* 同代码、**悬停关闭**的两帧：用来取"图标什么都没画"的像素集合（板底是否画东西只看这些格子） */
function runNoHover (tag, opts) {
  const o = Object.assign({}, opts)
  o.hoverOff = true
  return run(tag, o)
}
for (const r of [A, B, C, D]) {
  console.log('  ' + r.tag.padEnd(16) + ' exit=' + r.exit + ' png=' + (r.exists ? 'yes' : 'NO') +
    (r.decodeErr ? ' 解码失败:' + r.decodeErr : '') +
    '  板类=' + (r.ink ? r.ink.cls : '(无留痕)') + '  板底=' + (r.ink ? r.ink.plateBg : '-') +
    '  框=' + (r.ink ? r.ink.plateBorderW : '-') + '  圆角=' + (r.ink ? r.ink.plateRadius : '-') + '  ' + r.geom.slice(0, 60))
}
check('P0 四帧都真的渲染出了截图与留痕（0 帧 = 什么都没测，不许当通过）',
  [A, B, C, D].every((r) => r.exists && r.ink && r.ink.rows && r.ink.rows.length >= 3),
  [A, B, C, D].map((r) => r.tag + ':' + (r.ink && r.ink.rows ? r.ink.rows.length : 0) + '行').join('  '))
check('P1 目标确认：这块板就是用户截图里那三行（THINKING · commanding / 计划 ——（本宿主不适用）/ 进程 主 · 1 跑 · 共 1）',
  !!C.ink && /THINKING · commanding/.test(C.ink.rows[0].text) && /本宿主不适用/.test(C.ink.rows[2].text) && /进程 主 · 1 跑 · 共 1/.test(C.ink.rows[1].text),
  C.ink ? C.ink.rows.map((r) => r.cls + '=' + r.text).join(' | ') : '无留痕')

/* ============================================================================
 * 像素分析：一笔一像素地按实测 α 合成到真实壁纸上
 * ========================================================================== */
const dpr = C.plate ? Number(C.plate.split(' dpr=')[1]) : 2
const A0 = await runNoHover('A0-before-nohover', { app: BASE })
const C0 = await runNoHover('C0-after-nohover', { themeJson: { hoverPlateAlpha: 0 } })
const SIG = {
  A: plateSignature(A.img, A0.img, dpr, A.ink && A.ink.rows),
  C: plateSignature(C.img, C0.img, dpr, C.ink && C.ink.rows),
  D: plateSignature(D.img, A0.img, dpr, D.ink && D.ink.rows)
}
for (const k of ['A', 'C', 'D']) {
  const s = SIG[k]
  console.log('  板签名 ' + k + '（只看"图标没画东西"的格子，n=' + (s ? s.n : 0) + '）：不透明(α≥0.9) ' +
    (s ? (s.shareOpaque * 100).toFixed(1) + '%' : '-') + '  几乎空的(α<0.05) ' + (s ? (s.shareEmpty * 100).toFixed(1) + '%' : '-') +
    '  墨(α≥0.5) ' + (s ? (s.shareInk * 100).toFixed(1) + '%' : '-') + '  落在字盒子之外的墨 ' + (s ? s.inkOutside : '-') + ' 格')
}
const quant = (c) => c.map((v) => Math.round(v) >> 3).join(',')
/* 一行文字的**像素分解**（改动前/改动后同一套）：
   · 每个像素按**实测 α** 合成到它在屏幕上真正对应的那张壁纸像素上（透明窗口的截图不叠桌面）；
   · 底分两种情形，判据不同（混用会得出"有底时也说壁纸"的假数字）：
       ① 矩形里有相当比例的"无墨像素"（α<0.06）⇒ 板不在，底 = 壁纸；悲观边界取该矩形内最亮的 1% 壁纸像素；
       ② 全矩形都有墨/板（有底那一版，α≈0.94 铺满整块）⇒ 底 = 该矩形内 (rgb,α) 众数按 α 合成到壁纸，
          悲观边界合成到"本测试全程最亮的壁纸取样"。
   · 字身 = 墨像素里**最亮的 10%**；描边 = 墨像素里**最暗的 10%**（不用单点极值 —— 抗锯齿边缘会把它拖到 1.0）。 */
function analyze (run, row, dprX, effPlateA) {
  const img = run.img
  if (!img) return null
  const L = Math.round(row.left * dprX), T = Math.round(row.top * dprX)
  const W = Math.round(row.w * dprX), H = Math.round(row.h * dprX)
  const pad = Math.round(4 * dprX)                      /* 描边与阴影会画到盒子外面 */
  const x0 = Math.max(0, L - pad), y0 = Math.max(0, T - pad)
  const x1 = Math.min(img.w, L + W + pad), y1 = Math.min(img.h, T + H + pad)
  const ink = [], tally = new Map(), wpAll = []
  let sampled = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * img.w * img.bpp + x * img.bpp
    const a = img.px[i + 3] / 255
    /* 该设备像素对应的**屏幕坐标** → 真实壁纸像素。窗口取**生产默认落点**（工作区右下角内缩 24px，
       与 main.js 的 defaultPosition 一致）；全局悲观边界另用 WP_WORST（四个屏幕角位形里最亮的一块）。 */
    const sx = SCR.work.x + SCR.work.width - WIN - 24 + (x / dprX)
    const sy = SCR.work.y + SCR.work.height - WIN - 24 + (y / dprX)
    const wpc = wpPix(sx, sy)
    const raw = [img.px[i], img.px[i + 1], img.px[i + 2]]
    const seen = [0, 1, 2].map((k) => a * raw[k] + (1 - a) * wpc[k])
    tally.set(quant(raw) + '|' + Math.round(a * 15), (tally.get(quant(raw) + '|' + Math.round(a * 15)) || 0) + 1)
    wpAll.push(wpc)
    sampled++
    if (a < 0.06) continue                              /* 没有墨的像素 = 用户直接看到的底 */
    ink.push({ a, seen, L: lum(seen), rWp: ratio(seen, wpc) })
  }
  if (!ink.length) return null
  const noInkShare = (sampled - ink.length) / sampled
  /* 板在不在**由留痕说了算**（`hover ink` 里的 effPlateA），不靠"矩形里还有没有空像素"这种猜测：
     像 .h3 那种 9.5px 密排小字，描边+阴影会把整个矩形铺满，"几乎没有空像素"并不等于"有板"
     —— 上一版就是这么把无底的 .h3 判成"板色 α=0.53"的（实测抓到过）。 */
  const hasPlate = !(typeof effPlateA === 'number' && effPlateA <= 0.02)
  let bgLocal, bgWorst, bgSrc
  if (!hasPlate) {
    /* ① 没有板：底就是壁纸本身（众数 + 该矩形内最亮的 1% 当悲观边界） */
    const wt = new Map()
    for (const c of wpAll) wt.set(quant(c), (wt.get(quant(c)) || 0) + 1)
    const wm = [...wt.entries()].sort((p, q) => q[1] - p[1])[0][0].split(',').map((v) => Number(v) * 8 + 4)
    bgLocal = wm
    const sorted = wpAll.slice().sort((p, q) => lum(p) - lum(q))
    bgWorst = sorted[Math.max(0, Math.floor(sorted.length * 0.99))]
    bgSrc = '壁纸(无板)'
  } else {
    /* ② 有板：底 = (rgb,α) 众数合成到壁纸（与 panel-lightness 同口径） */
    const mk = [...tally.entries()].sort((p, q) => q[1] - p[1])[0][0].split('|')
    const rgb = mk[0].split(',').map((v) => Number(v) * 8 + 4), aMode = Number(mk[1]) / 15
    const wpC = wpAll[Math.floor(wpAll.length / 2)] || [128, 128, 128]
    bgLocal = [0, 1, 2].map((k) => aMode * rgb[k] + (1 - aMode) * wpC[k])
    bgWorst = [0, 1, 2].map((k) => aMode * rgb[k] + (1 - aMode) * WP_WORST[k])
    bgSrc = '板色 rgb(' + rgb.join(',') + ') α=' + aMode.toFixed(2)
  }
  ink.sort((p, q) => p.L - q.L)
  /* 取极值两侧的 **1%**（下限 3 个像素）：与 panel-lightness/v2 的"前 1%"同口径。
     取 10% 会把半透明的抗锯齿边缘一起吃进来 —— 实测 .h3（9.5px 细字）用 10% 时
     "最亮的 10%" 只到 rgb(74,93,105)，那是边缘而不是字身。 */
  const n1 = Math.max(3, Math.ceil(ink.length * 0.01))
  const mean = (arr) => [0, 1, 2].map((k) => Math.round(arr.reduce((s, o) => s + o.seen[k], 0) / arr.length))
  const dark = ink.slice(0, n1), light = ink.slice(-n1)
  const solid = ink.filter((o) => o.a >= 0.5)
  return {
    cls: row.cls, txt: row.text, size: row.fontSize, n: ink.length, sampled, noInkShare, bgSrc, bgLocal, bgWorst,
    strokeMean: mean(dark), fillMean: mean(light),
    rStrokeLocal: ratio(mean(dark), bgLocal), rStrokeWorst: ratio(mean(dark), bgWorst),
    rFillLocal: ratio(mean(light), bgLocal), rFillWorst: ratio(mean(light), bgWorst),
    cover45: solid.length ? solid.filter((o) => o.rWp >= 4.5).length / solid.length : 0
  }
}
/* 整块悬浮板足迹的像素统计（判"底到底还在不在"用这个，最稳）。
   ⚠️ 直接数"壁纸与足迹像素不同"是不行的：**足迹下面压着图标本体**（弧、粒子、辉光），
   那些像素本来就与壁纸不同 —— 上一版就是这么误判的（无底那版也报 80%）。
   所以先在同一份代码的"**悬停关闭**"那一帧上取"图标什么都没画"的像素集合 S（α≤0.02），
   再只看 S 在"悬停打开"那一帧里的 α：
     · 有底 ⇒ S 上几乎处处 α≈0.94（整块不透明的板糊在图标**之上**，z-index 40）；
     · 无底 ⇒ S 上 α≈0（板不画任何东西，只有字/描边那几个点会动，而它们本来就在 S 之外）。 */
function plateSignature (imgOn, imgOff, dprX, rows) {
  if (!imgOn || !imgOff || imgOn.w !== imgOff.w || imgOn.h !== imgOff.h) return null
  const xs = Math.round(204 * dprX), ys = Math.round(56 * dprX)
  /* 三行文字的盒子（设备像素），外扩 5 CSS px 容下 3px 描边与 4px 阴影 ——
     用来判"改动后剩下的墨迹**是否全部落在字上**"（也就是"板确实不画任何东西了"）。 */
  const boxes = (rows || []).map((r) => ({
    x0: (r.left - 5) * dprX, x1: (r.left + r.w + 5) * dprX,
    y0: (r.top - 5) * dprX, y1: (r.top + r.h + 5) * dprX
  }))
  let n = 0, opaque = 0, empty = 0, ink = 0, inkOutside = 0
  for (let y = 2; y < ys - 2; y++) for (let x = 2; x < xs - 2; x++) {
    const i = y * imgOn.w * imgOn.bpp + x * imgOn.bpp
    if (imgOff.px[i + 3] / 255 > 0.02) continue          /* 图标在这一格画了东西 ⇒ 不是"纯背景"格，排除 */
    const a = imgOn.px[i + 3] / 255
    n++
    if (a >= 0.9) opaque++
    if (a < 0.05) empty++
    if (a >= 0.5) {
      ink++
      if (!boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) inkOutside++
    }
  }
  if (!n) return null
  return { n, shareOpaque: opaque / n, shareEmpty: empty / n, shareInk: ink / n, inkOutside }
}
const RES = {}
for (const [tag, run] of [['A', A], ['B', B], ['C', C], ['D', D]]) {
  if (!run.ink) { RES[tag] = null; continue }
  RES[tag] = run.ink.rows.map((row) => analyze(run, row, dpr, run.ink.effPlateA)).filter(Boolean)
}
/* 好看的行：只关心"最差的那一行"（浅色壁纸下最亮字身最容易不达标） */
const of = (tag, sel) => (RES[tag] || []).filter((r) => !sel || r.cls === sel)
const worstOf = (tag, key) => of(tag).reduce((m, r) => (!m || r[key] < m[key] ? r : m), null)

section('③ 改动前 / 改动后 —— 同一套像素口径下的实测对比度')
for (const [tag, name] of [['A', '改动前 · 有底(hoverPlate=on)'], ['B', '改动前 · 无底(.noplate 2.2px 描边)'],
  ['C', '改动后 · 全删底(α=0 + 3px 描边)'], ['D', '改动后 · α=0.94(还原成改动前那一版)']]) {
  const rows = RES[tag]
  if (!rows || !rows.length) { console.log('  ' + name + '：没有可测行'); continue }
  console.log('  ' + name)
  for (const r of rows) {
    console.log('     ' + r.cls.padEnd(5) + r.txt.padEnd(26) +
      ' 底=' + fmt(r.bgLocal) + ' [' + r.bgSrc + ']' +
      '  字身 ' + fmt(r.fillMean) + ' → ' + r.rFillWorst.toFixed(2) + ':1(悲观边界) / ' + r.rFillLocal.toFixed(2) + ':1(本处底)' +
      '  描边 ' + fmt(r.strokeMean) + ' → ' + r.rStrokeWorst.toFixed(2) + ':1 / ' + r.rStrokeLocal.toFixed(2) + ':1' +
      '  墨像素≥4.5 占比 ' + (r.cover45 * 100).toFixed(0) + '%')
  }
}
const A_w = worstOf('A', 'rFillWorst'), B_s = worstOf('B', 'rStrokeWorst'), C_s = worstOf('C', 'rStrokeWorst')
const C_f = worstOf('C', 'rFillWorst')

section('④ 断言')
/* ---------- E1：改动前确实是一个"黑框" ---------- */
check('E1a【改动前·定性】默认态实测到一块**近黑薄板**：板区像素 (rgb,α) 众数 = 近黑 + α0.94、边框 1px',
  !!A.ink && /rgba\(11, 22, 36, 0\.9\d\)/.test(A.ink.plateBg) && parseFloat(A.ink.plateBorderW) >= 1,
  'A 板底=' + (A.ink && A.ink.plateBg) + ' 框=' + (A.ink && A.ink.plateBorderW))
check('E1b【改动前·像素】只在"图标没画东西"的格子上看：足迹里 **100%** 的格子 α≥0.9（= 一整块近乎不透明的黑板糊在那儿）',
  !!SIG.A && SIG.A.shareOpaque >= 0.95,
  SIG.A ? ('不透明 ' + (SIG.A.shareOpaque * 100).toFixed(1) + '%（n=' + SIG.A.n + '）') : 'n/a')
check('E1c【改动前·文字】有底时字身对底 ≥4.5:1（那层深底就是靠这个扛着可读性）',
  !!A_w && A_w.rFillWorst >= 4.5, A_w ? (A_w.cls + ' 字身 ' + A_w.rFillWorst.toFixed(2) + ':1 on ' + fmt(A_w.bgWorst)) : 'n/a')

/* ---------- E2：改动后 —— 底/框/圆角全为 0（留痕 + 像素双重） ---------- */
check('E2a【改动后·留痕】#v2hover 的板底 α=0、边框宽 0px、圆角 0px，且挂了补偿类 hp-nobg',
  !!C.ink && /rgba\(11, 22, 36, 0\)/.test(C.ink.plateBg) && parseFloat(C.ink.plateBorderW) === 0 &&
  parseFloat(C.ink.plateRadius) === 0 && /hp-nobg/.test(C.ink.cls) && C.ink.effPlateA === 0,
  '底=' + (C.ink && C.ink.plateBg) + ' 框=' + (C.ink && C.ink.plateBorderW) + ' 圆角=' + (C.ink && C.ink.plateRadius) +
  ' 类=' + (C.ink && C.ink.cls) + ' effPlateA=' + (C.ink && C.ink.effPlateA))
{
  /* 像素证据（最稳的一条）：在"图标没画东西"的格子上，板自己画了什么。
     同口径下改动前是"整块不透明"，改动后板必须什么都不画 —— 剩下的墨迹只允许落在那三行字上。 */
  /* ⚠️ 残留的少量"盒子外墨"是**图标自己**的：`--test-hover on` 会同时给 #stage 挂 .hot
     ⇒ `#zoom{transform:scale(1.06)}`，图标整体放大 1.06，边缘那几像素就跑到"悬停关闭帧"的空位上了
     （实测 74 格，全在右上角 x 194..399 / y 2..61 这片弧线上，跨 40% 的足迹宽度）。
     底要是在，这里会是**上万格**（改动前实测 6143 格且摊满整块）—— 两个数量级，判据仍然钉得住。 */
  check('E2b【改动后·像素】同口径下留下的**只有字**：不透明格子从 100% 掉到 ≤35%、≥30% 的格子彻底空掉，且字盒子之外的墨从 6143 格降到 ≤300 格（残量 = 图标 .hot 放大 1.06 的边缘，不是板）',
    !!SIG.C && SIG.C.shareOpaque <= 0.35 && SIG.C.shareEmpty >= 0.30 && SIG.C.inkOutside <= 300,
    SIG.C ? ('不透明 ' + (SIG.C.shareOpaque * 100).toFixed(1) + '%（改动前 ' + (SIG.A ? (SIG.A.shareOpaque * 100).toFixed(1) : '?') +
      '%）、空 ' + (SIG.C.shareEmpty * 100).toFixed(1) + '%、墨 ' + (SIG.C.shareInk * 100).toFixed(1) + '%（n=' + SIG.C.n + '）；字盒子之外的墨 ' +
      SIG.C.inkOutside + ' 格（改动前 ' + (SIG.A ? SIG.A.inkOutside : '?') + ' 格）') : 'n/a')
}
/* ---------- E3：α=0.94 必须**逐项还原**成改动前那一版（"可调"不是"换了个样子"） ---------- */
check('E3【可逆性】α=0.94 实测还原成改动前那一版：板底色/α/边框/几何与基线一致',
  !!D.ink && !!A.ink && D.ink.plateBg === A.ink.plateBg && D.ink.plateBorderW === A.ink.plateBorderW &&
  D.geom === A.geom && (RES.D && RES.A && RES.D[0] && RES.A[0] && Math.abs(RES.D[0].rFillWorst - RES.A[0].rFillWorst) <= 0.25),
  'α=.94: 底=' + (D.ink && D.ink.plateBg) + ' 框=' + (D.ink && D.ink.plateBorderW) + ' 几何=[' + D.geom.slice(0, 46) + ']' +
  ' vs 基线: 底=' + (A.ink && A.ink.plateBg) + ' 框=' + (A.ink && A.ink.plateBorderW) + ' 几何=[' + A.geom.slice(0, 46) + ']')

/* ---------- E4：文字补偿 —— 改动后必须**达标且不低于改动前** ---------- */
check('E4a【补偿·达标】全删底之后，描边对底的对比度 ≥4.5:1（最亮壁纸悲观边界，三行里最差的那一行）',
  !!C_s && C_s.rStrokeWorst >= 4.5,
  C_s ? ('最差行 ' + C_s.cls + ' ' + C_s.rStrokeWorst.toFixed(2) + ':1 on ' + fmt(WP_WORST)) : '没测到')
check('E4b【补偿·不倒退】改动后（3px 描边）的描边对比度 ≥ 改动前那一版（.noplate 2.2px 描边）的同口径值',
  !!C_s && !!B_s && C_s.rStrokeWorst >= B_s.rStrokeWorst - 0.01,
  '改动后 ' + (C_s ? C_s.rStrokeWorst.toFixed(2) : '?') + ':1  vs  改动前(2.2px) ' + (B_s ? B_s.rStrokeWorst.toFixed(2) : '?') + ':1')
/* ---------- E5：**如实记录**字身口径（不许只报描边、不许换个口径说达标） ---------- */
check('E5【如实】字身（字形内部填充）对浅色壁纸**达不到** 4.5:1 —— 全删底的物理上限就在这里，这条断言是把它钉成事实（不是在庆祝通过）',
  !!C_f && C_f.rFillWorst < 4.5,
  C_f ? ('最差行 ' + C_f.cls + ' 字身 ' + fmt(C_f.fillMean) + ' → ' + C_f.rFillWorst.toFixed(2) + ':1 on 最亮壁纸 ' + fmt(WP_WORST) +
    '；墨像素里达 4.5:1 的占比 ' + (C_f.cover45 * 100).toFixed(0) + '%（全部由描边贡献）') : '没测到')
console.log('  ★ 如实结论：改动后最差对比度 —— 【描边口径】' + (C_s ? C_s.rStrokeWorst.toFixed(2) : '?') +
  ':1（过 4.5:1）；【字身口径】' + (C_f ? C_f.rFillWorst.toFixed(2) : '?') +
  ':1（**过不了**）。有底时最差（A）' + (A_w ? A_w.rFillWorst.toFixed(2) : '?') + ':1；改动前的无底版（B）描边口径 ' + (B_s ? B_s.rStrokeWorst.toFixed(2) : '?') + ':1。')

/* ---------- E6：大面板的底**没被动** ---------- */
{
  const PANEL_RUN = await run('E-panel', { extra: ['--shot-panel'] })
  const SRC = fs.readFileSync(path.join(RUNTIME, 'index.html'), 'utf8')
  const plateRule = (SRC.match(/#plate\{[^}]*\}/) || [''])[0]
  const four = (plateRule.match(/rgba\(var\(--p[0-3]\)/g) || []).length
  let med = null, aMed = null
  const pm = PANEL_RUN.plate.match(/panel plate\((?:after-v2|hover)\): (\d+),(\d+),(\d+),(\d+) dpr=([\d.]+)/)
  if (PANEL_RUN.img && pm) {
    const d2 = Number(pm[5]) || 2
    const X0 = Math.round(Number(pm[1]) * d2) + 8, Y0 = Math.round(Number(pm[2]) * d2) + 8
    const X1 = Math.round((Number(pm[1]) + Number(pm[3])) * d2) - 8, Y1 = Math.round((Number(pm[2]) + Number(pm[4])) * d2) - 8
    const px = []
    for (let y = Y0; y < Y1; y += 7) for (let x = X0; x < X1; x += 7) {
      const i = (y * PANEL_RUN.img.w + x) * PANEL_RUN.img.bpp
      if (PANEL_RUN.img.px[i + 3] < 120) continue
      px.push([PANEL_RUN.img.px[i], PANEL_RUN.img.px[i + 1], PANEL_RUN.img.px[i + 2], PANEL_RUN.img.px[i + 3]])
    }
    if (px.length) {
      const s = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)]
      med = [s(0), s(1), s(2)]; aMed = s(3) / 255
    }
  }
  check('E6【大面板未动】展开的大面板底板仍是"深蓝四段渐变 + var(--panel-alpha)"，像素上 α≈0.78、色 ≈ plate-b 的深蓝（与本轮改动无关）',
    four === 4 && plateRule.includes('var(--panel-alpha') && !!med && Math.abs(aMed - 0.78) <= 0.06 &&
    med.every((v, k) => Math.abs(v - [36, 55, 80][k]) <= 14),
    '四段渐变命中 ' + four + '/4；实测板底 ' + (med ? fmt(med) : 'n/a') + ' α=' + (aMed === null ? 'n/a' : aMed.toFixed(3)) + '（期望 ≈ [36,55,80] α0.78）')
}
/* ---------- E7：几何断言跟着改（并写明为什么） ---------- */
check('E7【几何】悬浮板外框 206x57 → 204x55（改动前那 1px 边框归零 ⇒ 每边少 1px），且文本仍然零出界零重叠',
  A.geoms.some((l) => /hover=0,0,206x57 /.test(l)) && C.geoms.some((l) => /hover=0,0,204x55 /.test(l)) &&
  /outside=0 overlaps=0/.test(C.lay),
  '改动后 ' + (C.geoms.find((l) => /204x55/.test(l)) || '(无)').slice(0, 72) + ' ｜ ' + C.lay.slice(0, 44) +
  ' ｜ 改动前 ' + (A.geoms.find((l) => /206x57/.test(l)) || '(无)').slice(0, 72))

/* ---------- E8：常量防漂（壁纸取样 / 公式里的颜色常量） ---------- */
{
  const safeRead = (f) => { try { return fs.readFileSync(path.join(RUNTIME, f), 'utf8') } catch { return '' } }
  const MAIN = safeRead('main.js')
  const SET = safeRead('settings.html')      /* 设置窗口是任务 F 新增的文件：基线里根本没有 ⇒ 空串 */
  const mRgb = MAIN.match(/const WALLPAPER_WORST_RGB = \[(\d+), (\d+), (\d+)\]/)
  const mLum = MAIN.match(/const WALLPAPER_WORST_LUM = ([\d.]+)/)
  const drift = mRgb ? Math.max(...[0, 1, 2].map((k) => Math.abs(Number(mRgb[k + 1]) - WP_WORST[k]))) : 999
  const driftL = mLum ? Math.abs(Number(mLum[1]) - lum(WP_WORST)) : 999
  check('E8a【防漂】main.js 里给设置窗口用的"壁纸最亮取样"与本次像素实测一致（换壁纸/换取样口径必须重测，否则这条会红）',
    drift <= 6 && driftL <= 0.02,
    'main.js ' + (mRgb ? fmt([+mRgb[1], +mRgb[2], +mRgb[3]]) : '缺') + ' lum=' + (mLum ? mLum[1] : '缺') +
    '  vs 实测 ' + fmt(WP_WORST) + ' lum=' + lum(WP_WORST).toFixed(4) + '  最大通道差 ' + drift)
  const fillConst = SET.match(/var FILL_WORST = \[(\d+), (\d+), (\d+)\]/)
  const strokeConst = SET.match(/var STROKE = \[(\d+), (\d+), (\d+)\], STROKE_A = ([\d.]+)/)
  const liveFill = C.ink ? rgbOf(C.ink.rows[0].color) : null
  const liveStroke = C.ink ? rgbOf(C.ink.rows[0].strokeC) : null
  const liveStrokeA = C.ink ? Number((C.ink.rows[0].strokeC.match(/,\s*([\d.]+)\)$/) || [0, 0])[1]) : null
  check('E8b【防漂】settings.html 实时公式里的字身/描边常量与图标窗口**实际计算样式**逐通道一致',
    !!fillConst && !!strokeConst && !!liveFill && !!liveStroke &&
    [0, 1, 2].every((k) => Number(fillConst[k + 1]) === liveFill[k]) &&
    [0, 1, 2].every((k) => Number(strokeConst[k + 1]) === liveStroke[k]) &&
    Math.abs(Number(strokeConst[4]) - liveStrokeA) < 0.005,
    '公式 字身=' + (fillConst ? fmt([+fillConst[1], +fillConst[2], +fillConst[3]]) : '缺') + ' 描边=' +
    (strokeConst ? fmt([+strokeConst[1], +strokeConst[2], +strokeConst[3]]) + '@' + strokeConst[4] : '缺') +
    '  vs 实际 字身=' + (liveFill ? fmt(liveFill) : '缺') + ' 描边=' + (liveStroke ? fmt(liveStroke) : '缺') + '@' + liveStrokeA)
}

section(ok ? '悬浮板全删底：全部通过' : '悬浮板全删底：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
