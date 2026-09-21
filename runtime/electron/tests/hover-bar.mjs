#!/usr/bin/env node
/* hover-bar.mjs —— 悬浮层（#v2hover）里那根 **150px 横向计划进度条**（`.v2bullet > .bs`）被去掉
 *                   任务 C，2026-09-21。
 *
 * 用户原话（附截图）：「我这个左上角的任务条也不要了，有环形的这样是多此一举」
 *   —— 图标本体的圆环已经在显示进度（右侧一道青色弧），它**上方**再压一根横的青色条，是重复。
 *
 * ★ 只去掉**这一根横条**（其余一律不碰）：
 *     · 环形的进度弧**保留**（那是他认可的东西，也正是"多此一举"的对照物）；
 *     · `#lab` / `#lab2` 两行青色中文**保留**（独立 div，根本不在这块悬浮层里）；
 *     · `.r1 > .dot`（行首小圆点）与 `.h3 > .warnv2`（「▲ 计划 6→11」）**照旧保留** —— 用户没点名它们。
 *
 * ★ 可回退：`window.hoverBar`（'off' = 默认，不画；'on' = 整根原样回来）。
 *   与 `window.hoverRows` 是**两个独立开关**：那个管三行**文字**，这个管这一根**条**。两者互不覆盖。
 *
 * ★ 两路独立取证（都起真实进程、全程离屏 --hidden，不显示窗口、不移动光标、不合成任何输入）：
 *    ① **DOM 留痕** —— `hover rows` 里的 `hoverBar` / `bullet` / `bs` / `dot` / `warnv2` 计数；
 *    ② **像素差分** —— 同一套 `--shot` 参数下抓两帧，唯一差别就是这根条 ⇒ 差出来的矩形必须
 *       正好落在 `.v2bullet` 的盒子上（宽 150×scaleX、高 6、色 #56d9c8）且落在悬浮板矩形之内。
 *
 * ★ 尺子自证（两条，都先证明"尺子自己是准的"再量产品）：
 *    S1 差分器：拿**自造**的两张已知图跑一遍，必须原样框出我改动的那块矩形；
 *    S2 正向对照：`hoverBar='on'` 那一帧必须**数得出** `.bs`（若留痕/差分器坏了永远报 0，这里会红
 *       ⇒ 默认帧的"没有条"就不可能是假否定）。另加一帧同载荷重跑，证明跨进程确定性成立（差分法可用）。
 *
 * 用法: node tests/hover-bar.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { runRuntime, tmpHome, runDir, readLog, killStrayElectron, section, report, sleep } from './harness.mjs'

const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const DIR = runDir('hover-bar')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

/* 载荷：**两个会话** ⇒ 环的进度由"多对话总进度"决定（恒 0.5），于是两帧的环**完全一样**；
   而 `.v2bullet` 由 progress.applicable/done/total 决定 ⇒ 横条有无不影响环。差分才干净。 */
const now = Date.now()
const PAYLOAD = path.join(DIR, 'payload.json')
fs.writeFileSync(PAYLOAD, JSON.stringify({
  state: {
    state: 'WORKING', activity: 'commanding',
    progress: { applicable: true, done: 5, total: 6, unit: 'leaf', inProgress: 2, mode: 'item',
      planChange: { from: 6, to: 11, at: now } },
    metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
    subagents: { total: 1, running: 1, done: 0, failed: 0, stopped: 0, unknown: 0,
      items: [{ status: 'running', label: 'commanding', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 }] },
    sessions: { total: 2, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.5 }, { id: 'b', title: '子代理', progress: 0.5 }] }
  }
}))

/* ============================================================================
 * S1 尺子自证：差分器先拿**自造的两张已知图**跑一遍
 * ========================================================================== */
function diffBox (A, B, yLimit) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0
  for (let y = 0; y < Math.min(yLimit, A.H); y++) for (let x = 0; x < A.W; x++) {
    const i = (y * A.W + x) * A.bpp
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]))
    const da = Math.abs(A.data[i + 3] - B.data[i + 3])
    if (d > 12 || da > 12) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  return n ? { x0, x1, y0, y1, n } : null
}
section('① 尺子自证（差分器 + 解码器）')
{
  const W = 240, H = 240
  const mk = (bar) => {
    const b = Buffer.alloc(W * H * 4, 0)
    for (let y = 8; y <= 14; y++) for (let x = 40; x <= 120; x++) { const i = (y * W + x) * 4; b[i] = 86; b[i + 1] = 217; b[i + 2] = 200; b[i + 3] = 255 }
    if (bar) for (let y = 30; y <= 36; y++) for (let x = 60; x <= 239; x++) { const i = (y * W + x) * 4; b[i] = 86; b[i + 1] = 217; b[i + 2] = 200; b[i + 3] = 255 }
    return b
  }
  const d = diffBox({ data: mk(true), W, H, bpp: 4 }, { data: mk(false), W, H, bpp: 4 }, H)
  /* ⚠️ 第一版夹具写成 `x <= 240` ⇒ 写到了**下一行的 x=0**（越界绕回），自证于是报出 x0=0/y1=37。
     那是**夹具自己错了**、不是分析器错 —— 这正是"自己写的检查脚本先自证"要挡的那一类。 */
  check('S1 差分器自证：自造图里已知的差别只有 y=30..36 / x=60..239，差分器必须原样报出来（期望 180×7=1260 像素）',
    !!d && d.x0 === 60 && d.x1 === 239 && d.y0 === 30 && d.y1 === 36 && d.n === 1260,
    '差分器报出 ' + JSON.stringify(d))
  const probe = Buffer.alloc(8 * 8 * 4)
  for (let i = 0; i < probe.length; i += 4) { probe[i] = 86; probe[i + 1] = 217; probe[i + 2] = 200; probe[i + 3] = 255 }
  const pf = path.join(DIR, 'selfcheck.png')
  await sharp(probe, { raw: { width: 8, height: 8, channels: 4 } }).png().toFile(pf)
  const back = await sharp(pf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let maxErr = 0
  for (let i = 0; i < probe.length; i++) maxErr = Math.max(maxErr, Math.abs(probe[i] - back.data[i]))
  check('S1b PNG 往返自证：自造 RGBA 图 → PNG → 解码，逐字节误差 = 0（量产品像素前先证明解码器准）',
    maxErr === 0 && back.info.width === 8 && back.info.height === 8,
    '往返 ' + back.info.width + 'x' + back.info.height + ' bpp=' + back.info.channels + ' maxErr=' + maxErr)
}

/* ============================================================================
 * ② 四个离屏真机帧：DOM 留痕 + 截图
 * ========================================================================== */
async function runCase (tag, configWindow) {
  const home = tmpHome('hb-' + tag)
  if (configWindow) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ window: configWindow }, null, 2))
  const out = path.join(DIR, tag)
  fs.mkdirSync(out, { recursive: true })
  const log = path.join(out, 'main.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--shot', '240', '--shot-states', 'WORKING', '--test-hover', 'on',
    '--shot-payload', PAYLOAD, '--bg', 'none', '--out', out, '--settle-ms', '2500'], { home, log })
  const r = await st.waitExit(45000)
  if (!r) st.kill()
  killStrayElectron()
  await sleep(150)
  const lg = readLog(log)
  const rowsLines = lg.match(/hover rows: \{[^\n]*/g) || []
  const geomLines = lg.match(/hover geom\(hover\)[^\n]*/g) || []
  const ringLines = lg.match(/renderer: ring: [^\n]*/g) || []
  const inkLines = lg.match(/hover ink: \{[^\n]*/g) || []
  let img = null
  const png = path.join(out, 'shot-WORKING-240-none.png')
  if (fs.existsSync(png)) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    img = { data, W: info.width, H: info.height, bpp: info.channels }
  }
  return {
    tag, exit: r ? r.code : null, png, img,
    rows: rowsLines.length ? (() => { try { return JSON.parse(rowsLines[rowsLines.length - 1].replace(/^hover rows: /, '')) } catch { return null } })() : null,
    geom: (geomLines.filter((l) => /display=block/.test(l)).pop() || geomLines.pop() || ''),
    ink: inkLines.length ? (() => { try { return JSON.parse(inkLines[inkLines.length - 1].replace(/^hover ink: /, '')) } catch { return null } })() : null,
    ring: ringLines.pop() || '',
    labLine: (lg.match(/labrow\([a-z-]+\): \{[^\n]*/g) || []).pop() || ''
  }
}
const parseLab = (r) => { const m = r.labLine.replace(/^labrow\([a-z-]+\): /, ''); try { return JSON.parse(m) } catch { return null } }

section('② 四帧：默认 / hoverBar=on / 默认重跑（确定性对照）/ 两开关同开（整根还原）')
const OFF = await runCase('off-default', null)
const ON = await runCase('on-bar', { hoverBar: 'on' })
const OFF2 = await runCase('off-default-2', null)
const BOTH = await runCase('on-both', { hoverBar: 'on', hoverRows: 'on' })
for (const r of [OFF, ON, OFF2, BOTH]) {
  console.log('  ' + r.tag.padEnd(15) + ' exit=' + r.exit + ' png=' + (r.img ? 'yes' : 'NO') + '  ' +
    (r.rows ? JSON.stringify(r.rows) : '(无 hover rows 留痕)'))
  console.log('      ' + r.geom)
  console.log('      ' + r.ring)
}

const R0 = OFF.rows, R1 = ON.rows, R2 = OFF2.rows, R3 = BOTH.rows

check('B0【取证】四帧都拿到了留痕与截图（0 帧 = 什么都没测，不许当通过）',
  [R0, R1, R2, R3].every((x) => x && x.shown === true) && [OFF, ON, OFF2, BOTH].every((r) => !!r.img),
  [OFF, ON, OFF2, BOTH].map((r) => r.tag + ':' + (r.img ? 'png' : 'NOpng') + '/' + (r.rows ? 'rows' : 'norows')).join('  '))

section('③ 默认：那根横条不在，而用户没点名的东西一个不动')
check('B1【开关生效】默认态渲染层自报 hoverBar=off（证明这个键真的从 config.json 走到了渲染层，不是死键）',
  !!R0 && R0.hoverBar === 'off', R0 ? ('hoverBar=' + R0.hoverBar) : '没有留痕')
/* ★ 这条是**本任务的靶心**：本载荷有分母（progress 5/6 ⇒ pt.ok=true），
   改动之前这里必然是 `.v2bullet=1 / .bs=1`（用户截图里就是那一帧）。 */
check('B2【靶心·横条已去掉】有分母的计划（5/6）下，`.v2bullet` 与 `.bs` 都是 0 —— 图标上方不再有那根横向进度条',
  !!R0 && R0.bullet === 0 && R0.bs === 0, R0 ? ('.v2bullet=' + R0.bullet + ' .bs=' + R0.bs + '（应都是 0）') : '没有留痕')
check('B3【守恒·环】环**照旧在画**且进度与计划一致（p=50%，来自 2 个会话的总进度；不因去掉横条而消失）',
  /ring: p=50\.0% src=sessions×2/.test(OFF.ring), OFF.ring)
check('B4【守恒·没点名的不动①】行首小圆点 `.r1 > .dot` 仍在（容器与圆点各 1 个）',
  !!R0 && R0.r1 === 1 && R0.dot === 1, R0 ? ('.r1=' + R0.r1 + ' .dot=' + R0.dot) : '没有留痕')
check('B5【守恒·没点名的不动②】「▲ 计划 6→11」的 `.h3 > .warnv2` 仍在（用户当初特意要的"进度倒退要说明"）',
  !!R0 && R0.h3warn === 1 && R0.warnv2 === 1 && /计划\s*6→11/.test(R0.text),
  R0 ? ('.h3>.warnv2=' + R0.h3warn + ' .warnv2=' + R0.warnv2 + ' text=' + JSON.stringify(R0.text)) : '没有留痕')
check('B6【守恒·没点名的不动③】三行文字保持**删除**（上一轮的成果不许被弄回来）：.st=0 / .bl=0，且文本不含特征词',
  !!R0 && R0.st === 0 && R0.bl === 0 && !/WORKING|commanding|本宿主不适用|进程/.test(R0.text),
  R0 ? ('.st=' + R0.st + ' .bl=' + R0.bl + ' text=' + JSON.stringify(R0.text)) : '没有留痕')
{
  const L0 = parseLab(OFF)
  check('B7【守恒·两行青色中文】`#lab` / `#lab2` 原封不动（独立 div，不在悬浮层里）：两行都非空，第 2 行取到本案载荷的真实值「7 轮 · 41 工具」',
    !!L0 && String(L0.labText || '').length > 0 && /7 轮 · 41 工具/.test(String(L0.lab2Text)),
    L0 ? ('#lab=[' + L0.labText + ']  #lab2=[' + L0.lab2Text + ']') : '没有 labrow 留痕')
}

section('④ 可回退：hoverBar=on 整根条原样回来（同时是③的正向对照）')
check('B8【开关生效】hoverBar=on 时渲染层确实读成了 on',
  !!R1 && R1.hoverBar === 'on', R1 ? ('hoverBar=' + R1.hoverBar) : '没有留痕')
check('B9【可回退·条回来】hoverBar=on 时 `.v2bullet` 与 `.bs` 各 1 个（改动之前那一版的行为原样还原）',
  !!R1 && R1.bullet === 1 && R1.bs === 1, R1 ? ('.v2bullet=' + R1.bullet + ' .bs=' + R1.bs) : '没有留痕')
check('B10【两个开关互不覆盖】hoverBar=on 时三行文字**仍然是删掉的**（.st=0/.bl=0）—— 条回来不等于文字回来',
  !!R1 && R1.st === 0 && R1.bl === 0, R1 ? ('.st=' + R1.st + ' .bl=' + R1.bl) : '没有留痕')
check('B11【整根还原】hoverBar=on + hoverRows=on 时三行文字与那根条同时回来（.st=1/.bl=1/.bs=1）——\n      这就是本轮改动之前那一版的完整形态，说明"可回退"是真的、不是半个',
  !!R3 && R3.st === 1 && R3.bl === 1 && R3.bullet === 1 && R3.bs === 1,
  R3 ? ('.st=' + R3.st + ' .bl=' + R3.bl + ' .v2bullet=' + R3.bullet + ' .bs=' + R3.bs) : '没有留痕')
/* ★ S2 正向对照：同一个解析器（`hover rows` 留痕）在 on 侧必须能**数出 1 个 `.bs`**。
   若留痕/解析坏了永远报 0，B9 会红 ⇒ ③ 里那个"0"就不可能是假否定。 */
check('S2【尺子自证·正向对照】同一个解析器在 hoverBar=on 侧报出 `.bs`=1，在默认侧报 0 —— 于是"默认侧没有条"是**真否定**',
  !!R1 && R1.bs === 1 && !!R0 && R0.bs === 0,
  'on 侧 .bs=' + (R1 ? R1.bs : '?') + '；默认侧 .bs=' + (R0 ? R0.bs : '?'))

section('⑤ 像素差分：改动之后**屏幕像素上**真的少了一根横条（口径：CSS px，dpr 由图像实测推出）')
{
  /* 先证明差分法可用：同载荷、两个进程的重跑必须逐像素一致（--shot 让渲染层 FREEZE）。 */
  const ctrl = (OFF.img && OFF2.img) ? diffBox(OFF.img, OFF2.img, 80) : 'noimg'
  check('P0【差分法可用性·正向对照】同载荷跑两个进程，y<40 CSS px 那条带里逐像素差分 = **空**（渲染确定性成立，差分法才可用）',
    ctrl === null, ctrl === 'noimg' ? '缺图' : (ctrl ? '差分非空 ' + JSON.stringify(ctrl) : '(空)'))
  const d = (ON.img && OFF.img) ? diffBox(ON.img, OFF.img, 80) : null
  if (d) {
    const dpr = Math.round(ON.img.W / 240)
    const box = { x0: d.x0 / dpr, x1: d.x1 / dpr, y0: d.y0 / dpr, y1: d.y1 / dpr }
    /* ⚠️ 整框差分**比那根条高**，而且这是**对的**、不是第二个元素：
       `.v2bullet` 是个 `display:block;height:13px` 的块，条进来之后它把下面那行 `.h3`
       （里面就是「▲ 计划 6→11」，色 #ffc266）**整体推下去 13px**
       —— 两帧的板高实测就是 204x23（无条）↔ 204x36（有条），差 13px。
       所以这里把差分拆开：
         · 那根条本身 = **严格色**：`.bs` 的 `background:#56d9c8`、无 alpha ⇒ 它画的像素是
           **完全不透明且逐通道精确等于 (86,217,200)**（`a=255`）。用这个严格判据能把它从
           "透过文字阴影看到的背景青色"里干净地摘出来（宽松的"偏青"判据会把后者也算进来 ——
           第一版就是这么假红的）。
         · 其余 = 被推下去的那行警告文字（布局位移），由下面 P2b 用 DOM 框独立证明。 */
    const isBarPx = (img, i) => img.data[i] === 86 && img.data[i + 1] === 217 && img.data[i + 2] === 200 && img.data[i + 3] === 255
    /* 整框主导色 */
    const tally = new Map()
    for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) {
      const i = (y * ON.img.W + x) * ON.img.bpp
      const k = ON.img.data[i] + ',' + ON.img.data[i + 1] + ',' + ON.img.data[i + 2] + ',a' + ON.img.data[i + 3]
      tally.set(k, (tally.get(k) || 0) + 1)
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    let cx0 = 1e9, cx1 = -1, cy0 = 1e9, cy1 = -1, cn = 0, other = 0, barInOff = 0
    for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) {
      const i = (y * ON.img.W + x) * ON.img.bpp
      const dd = Math.max(Math.abs(ON.img.data[i] - OFF.img.data[i]), Math.abs(ON.img.data[i + 1] - OFF.img.data[i + 1]),
        Math.abs(ON.img.data[i + 2] - OFF.img.data[i + 2]), Math.abs(ON.img.data[i + 3] - OFF.img.data[i + 3]))
      if (isBarPx(ON.img, i)) { cn++; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y }
      if (isBarPx(OFF.img, i)) barInOff++
      if (dd > 12 && !isBarPx(ON.img, i)) other++
    }
    const cbox = cn ? { x0: cx0 / dpr, x1: cx1 / dpr, y0: cy0 / dpr, y1: cy1 / dpr } : null
    console.log('  差分框(CSS px) = x ' + box.x0 + '..' + box.x1 + '（宽 ' + (box.x1 - box.x0) + '）  y ' + box.y0 + '..' + box.y1 +
      '（高 ' + (box.y1 - box.y0) + '）  变化像素 ' + d.n + '  dpr=' + dpr)
    console.log('  严格色 #56d9c8@a255 的像素盒(CSS px) = ' + (cbox ? ('x ' + cbox.x0 + '..' + cbox.x1 + '（宽 ' + (cbox.x1 - cbox.x0) + '）  y ' + cbox.y0 + '..' + cbox.y1 + '（高 ' + (cbox.y1 - cbox.y0) + '）') : '(无)') +
      '  个数 on 帧=' + cn + '  默认帧=' + barInOff)
    console.log('  非条部分的差像素 ' + other + '（= 被推下去 13px 的那行 ▲ 警告，见 P2b）')
    /* 悬浮板矩形（渲染层自报）：那根条必须落在板子里面 */
    const gm = /hover=(\d+),(\d+),(\d+)x(\d+)/.exec(ON.geom)
    const plate = gm ? { x: +gm[1], y: +gm[2], w: +gm[3], h: +gm[4] } : null
    check('P1【像素·横条真的没了】默认帧里**一个** `.bs` 的实色像素都没有（严格判据 #56d9c8 且 α=255）；而 hoverBar=on 帧里它构成一个横向矩形：宽 125±2 CSS px、高 ≤8、整体在窗口顶部（y1 ≤ 20）',
      barInOff === 0 && !!cbox && Math.abs((cbox.x1 - cbox.x0) - 125) <= 2 && (cbox.y1 - cbox.y0) <= 8 && cbox.y1 <= 20,
      '默认帧实色像素=' + barInOff + '；on 帧盒 ' + (cbox ? ('CSS x ' + cbox.x0 + '..' + cbox.x1 + ' y ' + cbox.y0 + '..' + cbox.y1 + ' 个数=' + cn) : '(无)'))
    check('P2【像素·就是那根条】差分框内出现最多的像素 = #56d9c8 且 **α=255**（`.bs` 的 background 是无 alpha 实色，这正是"它自己在画"而不是背景透出来的证据）',
      top[0] === '86,217,200,a255', '主导像素 ' + top[0] + ' × ' + top[1])
    /* P2b：非条那部分差像素不是"第二个新元素"，而是**同一行被推下去的位移** ——
       用既有的 `hover ink` 通道（它按 `.st/.h3/.bl` 逐行量框）独立证明：
       `.h3` 的 top 在有/无那根条时正好差 13px（= `.v2bullet` 的 height）。 */
    const h3Of = (r) => (r.ink && Array.isArray(r.ink.rows) ? r.ink.rows.find((x) => x.cls === '.h3') : null)
    const h3Off = h3Of(OFF), h3On = h3Of(ON)
    console.log('  hover ink .h3 框：默认 top=' + (h3Off ? h3Off.top : '?') + ' / hoverBar=on top=' + (h3On ? h3On.top : '?') +
      '（差 ' + (h3Off && h3On ? (h3On.top - h3Off.top) : '?') + 'px，期望 13 = .v2bullet 的 height）')
    check('P2b【像素·非条部分 = 布局位移，不是第二个新元素】`.h3` 那一行的框在有/无那根条时正好差 13px（= `.v2bullet` 的 height）；' +
      '两行的**文本与样式**都不变（同一个 `.warnv2`，色 #ffc266）',
      !!h3Off && !!h3On && (h3On.top - h3Off.top) === 13 && (h3On.color === h3Off.color) && h3On.w === h3Off.w,
      h3Off && h3On ? ('.h3 默认 top=' + h3Off.top + ' 色=' + h3Off.color + ' 宽=' + h3Off.w +
        '；on top=' + h3On.top + ' 色=' + h3On.color + ' 宽=' + h3On.w) : '没有 hover ink 留痕')
    check('P3【像素·落在悬浮板内】差分框完全落在 `#v2hover` 的实测矩形里（渲染层自报 ' + (plate ? plate.w + 'x' + plate.h + ' @' + plate.x + ',' + plate.y : '?') + '）',
      !!plate && box.x0 >= plate.x && box.x1 <= plate.x + plate.w && box.y0 >= plate.y && box.y1 <= plate.y + plate.h,
      plate ? ('板 ' + plate.x + ',' + plate.y + ',' + plate.w + 'x' + plate.h + ' vs 框 ' + JSON.stringify(box)) : '没有 hover geom 留痕')
    /* 宽度的**独立**预期：`.bs` 的 width:150px × scaleX(5/6=0.8333) = 125 CSS px */
    check('P4【像素·宽度对得上 CSS】那根条的实色盒宽度 = 150px × scaleX(0.833) ≈ 125 CSS px（与 `.bs` 的 width+transform 逐字对得上，误差 ≤2px 给抗锯齿）',
      !!cbox && Math.abs((cbox.x1 - cbox.x0) - 125) <= 2, cbox ? ('实测宽 ' + (cbox.x1 - cbox.x0) + '（期望 125，即 150×5/6）') : '没有实色盒')
    check('P5【守恒·板高只差这一块】两帧悬浮板高度差 = `.v2bullet` 的 height（13px）：渲染层自报 204x23 ↔ 204x36',
      /hover=0,0,204x36 /.test(ON.geom) && /hover=0,0,204x23 /.test(OFF.geom),
      'on 帧 ' + ON.geom.split(' ')[3] + '；默认帧 ' + OFF.geom.split(' ')[3])
  } else {
    check('P1【像素·横条真的没了】两帧存在像素差别且差出一个横向矩形', false, '差分是空的 —— 要么没抓到图，要么条根本没被去掉')
  }
}

section(ok ? '悬浮层横向进度条已去掉（环保留 / 两行青色中文保留 / 圆点与▲警告不动）：全部通过' : '悬浮层横向进度条：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
