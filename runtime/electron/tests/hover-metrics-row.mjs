#!/usr/bin/env node
/* hover-metrics-row.mjs —— 代理指标行（轮数 · 工具数）的形态验收
 *
 * ⚠️ **口径变更记录（2026-09-19，任务 D）—— 旧断言不是被"放宽"，是被搬家作废的**：
 *   第一版（任务 C）用户原话：「刻度尺保留轮数和工具数，只保留文字，像这个图片一样加在这行文字下面」
 *     ⇒ 当时放在**悬浮层 #v2hover 的活动行下面**，样式与 `#v2hover .st` 同族；
 *       旧 C4–C8 就是按那个位置/那套样式写的（`.tok2` / `gap` / `stStyle` vs `tokStyle` / 分隔符）。
 *   第二版（任务 D）用户原话：「**换到图标下面那行青色文字的下面**」
 *     ⇒ 位置改为 `#lab`（图标下的青色状态行）**正下方**、样式改为**沿用 #lab**、
 *       并且**从悬浮层搬走**（不是复制：`.tok2` 连规则一起删）。
 *   ⇒ 于是 C4–C8 **整段重写**成「搬走了吗 / 在 #lab 下方吗 / 与 #lab 同族吗 / 会不会被窗口裁掉」，
 *     断言名里都标了【D 新口径】。旧断言留在这里会骗后面的人（"它还在悬浮层里"），所以必须换掉。
 *   不变的原则（照旧保留）：代理指标**无分母 ⇒ 不许画成条/百分比**（C9）；
 *     有分母的计划进度条 `.v2bullet` —— ⚠️ **2026-09-21 任务 C 之后口径翻转**：用户原话
 *     「我这个左上角的任务条也不要了，有环形的这样是多此一举」⇒ **默认不再画**
 *     （C15 已翻面，守卫的是"它别再回来"；它自己的双向断言 + 像素差分在 tests/hover-bar.mjs）；
 *     刻度尺照旧不许回来（C1–C3）。
 *
 * 「尺子」的判定依据（名字 + 与名字无关的形状，两条独立判据）：
 *   · 名字：`.v2ruler`（容器）与 `.v2ruler > i`（1px 宽绝对定位刻度线；`i.on` 是游标）
 *   · 形状：`#v2hover` 内不存在「子元素里 ≥6 个是 position:absolute 且宽度 ≤2px」的容器
 *   它**不是**别的东西：图标上的 `.tick`（r=94 虚线圆）在 SVG 里、是圆环不是直条，属 H2 几何；
 *   `.v2bullet` 是**计划进度**（有分母 done/total）；`.trow/.trow2` 是面板内容，与这一行无关。
 *
 * 用法: node tests/hover-metrics-row.mjs   （全程离屏：--hidden，不显示窗口、不合成输入）
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { runRuntime, tmpHome, runDir, RUNTIME, readLog, killStrayElectron, section, report, sleep, waitFor } from './harness.mjs'

const DIR = runDir('hover-metrics')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
const fmt = (c) => 'rgb(' + c.map(Math.round).join(',') + ')'

/* ---------- PNG 解码（精确 Paeth，与其余取色套件同一份实现） ---------- */
function pngDecode (buf) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++], cur = raw.slice(p, p + stride); p += stride
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const line = out.slice(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = cur[x]
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      line[x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + pr) & 0xff
    }
  }
  if (bpp === 3) {
    const o4 = Buffer.alloc(w * h * 4)
    for (let i = 0, j = 0; i < out.length; i += 3, j += 4) { o4[j] = out[i]; o4[j + 1] = out[i + 1]; o4[j + 2] = out[i + 2]; o4[j + 3] = 255 }
    return { w, h, px: o4 }
  }
  return { w, h, px: out }
}
const rectOf = (r, dpr) => (Array.isArray(r) ? { l: Math.round(r[0] * dpr), t: Math.round(r[1] * dpr), w: Math.round(r[2] * dpr), h: Math.round(r[3] * dpr) } : null)
/* 一行文字的"实测填充色"：取该矩形内**最亮的前 0.5%** 像素的均值 = 字形实心处的颜色。
   为什么不是"与底色差别最大的像素"：那批像素被 `text-shadow` 的黑色晕染主导，选择集随字形形状变化
   （汉字 vs 数字/拉丁），会把**同色**的两行量出 rgb(14,38,31) vs rgb(21,58,47) 这种假差异（实测）。
   实测标定（d-work500 帧，两行同色 var(--c1)=#5cffd0）：top0.5% ⇒ #lab rgb(90,249,204) / #lab2 rgb(92,255,208)。 */
function lineFill (img, rc) {
  if (!img || !rc || rc.w <= 0 || rc.h <= 0) return null
  const X1 = Math.min(img.w, rc.l + rc.w), Y1 = Math.min(img.h, rc.t + rc.h)
  if (X1 <= rc.l || Y1 <= rc.t) return null
  const list = []
  for (let y = rc.t; y < Y1; y++) for (let x = rc.l; x < X1; x++) {
    const i = (y * img.w + x) * 4
    list.push([img.px[i], img.px[i + 1], img.px[i + 2]])
  }
  if (!list.length) return null
  list.sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]))
  const top = list.slice(0, Math.max(6, Math.ceil(list.length * 0.005)))
  return [0, 1, 2].map((k) => Math.round(top.reduce((s, c) => s + c[k], 0) / top.length))
}
const overlap = (a, b) => { if (!Array.isArray(a) || !Array.isArray(b)) return -1; const ox = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const oy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return (ox > 0 && oy > 0) ? ox * oy : 0 }

const payload = (now) => ({
  protocolVersion: 2, kind: 'state', state: 'WORKING', activity: 'coding',
  progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item', planChange: { from: 6, to: 11, at: now } },
  metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
  subagents: { total: 5, running: 2, done: 2, failed: 0, stopped: 1, unknown: 0, items: [] },
  sessions: { total: 3, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] }
})

/* ============================================================================
 * ① 形态与位置（离屏活会话）
 * ========================================================================== */
section('代理指标行：已搬到 #lab 正下方、与 #lab 同族、不越界不重叠（离屏）')
const pf = path.join(DIR, 'payload.json')
fs.writeFileSync(pf, JSON.stringify({ state: (function () { const p = payload(Date.now()); delete p.kind; delete p.protocolVersion; return p })(),
  text: { revision: 1, thoughtTail: '悬浮层也要有文字' } }))
const script = path.join(DIR, 'script.json')
/* ★ 必须**先有数据再悬停**：`--test-hover` 那条消息在 renderer ready 就直接发，早于载荷 ⇒
   届时 V2 里还没有任何字段，悬浮层会按"老宿主"守卫不渲染（首版就是这么红的，实测）。 */
fs.writeFileSync(script, JSON.stringify([{ at: 1500, hover: true }, { at: 4600, hover: false }, { at: 4800, hover: true }]))
const log = path.join(DIR, 'hover.log')
fs.rmSync(log, { force: true })
const st = runRuntime(['--hidden', '--test-hover', 'on', '--state', 'WORKING', '--window-timeout', '60000',
  '--test-script', script, '--shot-payload', pf, '--bg', 'dark'], { home: tmpHome('hoverrow'), log })
await waitFor(() => /v2 render hover=on/.test(readLog(log)), { timeout: 20000 }).catch(() => {})
await sleep(600)
st.send({ kind: 'shutdown' })
const r = await st.waitExit(15000)
if (!r) st.kill()
killStrayElectron()
await sleep(200)
const lg = readLog(log)
console.log('  exit=' + (r ? r.code : 'timeout'))

const invM = (lg.match(/hover inv: \{[^\n]*/) || []).pop() || ''
let inv = {}
if (invM) { try { inv = JSON.parse(invM.replace(/^hover inv: /, '')) } catch (e) { console.log('  [WARN] hover inv JSON 解析失败: ' + e.message) } }
const labAll = (lg.match(/labrow\([a-z-]+\): \{[^\n]*/g) || [])
/* 判「同族」用**过渡结束后**的那条留痕：opacity 有 140ms 过渡，切换瞬间取到的是过渡起点（0），
   拿它判"hot 时真的显示"会假红（首版就是这么红的，实测）。 */
const labSettled = labAll.filter((s) => /^labrow\(hot-settled\)/.test(s)).pop() || labAll.pop() || ''
const labM = labSettled
let LB = {}
if (labM) { try { LB = JSON.parse(labM.replace(/^labrow\([a-z-]+\): /, '')) } catch (e) { console.log('  [WARN] labrow JSON 解析失败: ' + e.message) } }
const renderLine = (lg.match(/v2 render hover=[^\n]*/g) || []).pop() || ''
console.log('  渲染留痕: ' + (renderLine || '(无)'))
console.log('  形态留痕: ' + (invM || '(无 hover inv 行)'))
console.log('  两行留痕: ' + (labM || '(无 labrow 行)'))

const src = fs.readFileSync(path.join(RUNTIME, 'index.html'), 'utf8')
const styleBlocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, ''))
/* 只扫**代码**（去掉注释）：注释里会写明"删掉了 `.v2ruler`/`.tok2`"，那是说明不是实现。
   `v2LogHoverInv()`/`logLabRow()` 里的 `querySelectorAll('.v2ruler')/.tok2` 是**判据本身**，不算实现。 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
const hasRulerCss = /\.v2ruler[^{]*\{/.test(styleBlocks.join('\n'))
const hasRulerMarkup = /class="v2ruler"/.test(code)
const hasTickLoop = /ticks \+= '<i class=/.test(code)
const hasTok2Css = /\.tok2[^{]*\{/.test(styleBlocks.join('\n'))
const hasTok2Markup = /class="tok2">/.test(code)          /* `class="tok2">` = 生成标记；判据里的选择器字符串不算 */

check('C1 源码里不再有刻度尺的样式规则 / 标记生成 / 刻度循环（注释与判据里的计数器不算）',
  !hasRulerCss && !hasRulerMarkup && !hasTickLoop,
  '样式规则' + (hasRulerCss ? '仍在' : '已删') + '；标记生成' + (hasRulerMarkup ? '仍在' : '已删') + '；刻度循环' + (hasTickLoop ? '仍在' : '已删'))
check('C2 渲染出的悬浮层里没有尺子节点（按名字：.v2ruler / .v2ruler i 均为 0）',
  !!invM && Number(inv.ruler) === 0 && Number(inv.ticks) === 0, invM ? ('ruler=' + inv.ruler + ' ticks=' + inv.ticks) : '没有 hover inv 留痕')
check('C3 与类名无关的形状判据：悬浮层内不存在「≥6 个 1px 绝对定位子元素」的尺形容器',
  !!invM && Number(inv.tickbox) === 0, invM ? ('最大块内 1px 绝对定位子元素数 = ' + inv.tickbox) : '没有 hover inv 留痕')

/* ---------- D 口径：搬走了吗（是搬走，不是复制） ---------- */
const hasTok2Gen = /'<span class="tok2">'/.test(code)
check('C4【D 新口径｜替换旧 C4/C7/C8】代理指标行**已从悬浮层搬走**：`.tok2` 的样式规则与标记生成都已删，且悬浮层内 `.tok2` 计数 = 0、悬浮层文本里也没有「N 轮 · N 工具」',
  !hasTok2Css && !hasTok2Markup && !hasTok2Gen && !!invM && Number(inv.tok2) === 0 && inv.hasMetricsText === false,
  'CSS规则' + (hasTok2Css ? '仍在' : '已删') + '；标记生成' + (hasTok2Markup || hasTok2Gen ? '仍在' : '已删') + '；悬浮层内 .tok2=' + inv.tok2 +
  '；悬浮层文本含指标=' + inv.hasMetricsText + ' ｜ 悬浮层文本=[' + String(inv.text || '').slice(0, 70) + ']')

/* ---------- D 口径：在 #lab 下方吗 / 取到真实值吗 ---------- */
check('C5【D 新口径】#lab 正下方存在这一行，且取到**真实值**（载荷 turns=7 / toolCalls=41 ⇒ 恰好「7 轮 · 41 工具」，不是空串/占位）',
  !!labM && /^7 轮 · 41 工具$/.test(String(LB.lab2Text || '')),
  labM ? ('#lab=[' + LB.labText + ']  #lab2=[' + LB.lab2Text + ']') : '没有 labrow 留痕')
check('C6【D 新口径｜替换旧 C6】位置在 #lab 的**正下方**（#lab2.top ≥ #lab.bottom − 1，且左右边界与 #lab 对齐）',
  !!labM && Array.isArray(LB.lab) && Array.isArray(LB.lab2) &&
  (LB.lab2[1] >= LB.lab[1] + LB.lab[3] - 1) && Math.abs(LB.lab2[0] - LB.lab[0]) <= 1 && Math.abs(LB.lab2[2] - LB.lab[2]) <= 1,
  labM ? ('#lab=' + JSON.stringify(LB.lab) + '  #lab2=' + JSON.stringify(LB.lab2) + '（竖直间隙 ' + (LB.lab2[1] - (LB.lab[1] + LB.lab[3])) + 'px）') : '没有 labrow 留痕')
{
  const F = (s) => String(s || '').split('|')
  const same = !!labM && !!LB.labStyle && LB.labStyle === LB.lab2Style
  check('C7【D 新口径｜替换旧 C7】样式与 #lab **同族**：font-family / font-size / font-weight / color / letter-spacing / line-height / text-shadow 七项逐一相等（外加 opacity 见 C8）',
    same,
    labM ? ('#lab  ' + LB.labStyle + '\n           #lab2 ' + LB.lab2Style + '  ｜ 同族=' + same) : '没有 labrow 留痕')
  check('C8【D 新口径】可见性**沿用 #lab**（不另造开关）：两行 opacity 相同且 display 相同，且 hot 时都真的显示（opacity > 0）',
    !!labM && F(LB.labStyle)[7] === F(LB.lab2Style)[7] && LB.labDisplay === LB.lab2Display && Number(F(LB.lab2Style)[7]) > 0,
    labM ? ('#lab opacity=' + F(LB.labStyle)[7] + ' display=' + LB.labDisplay + ' ｜ #lab2 opacity=' + F(LB.lab2Style)[7] + ' display=' + LB.lab2Display) : '没有 labrow 留痕')
}
check('C9【D 新口径｜替换旧 C5】代理指标**仍然只是文字**：这一行文本不含 %，且不是 `.v2bullet` 那种进度条（无分母就不画条）',
  !!labM && String(LB.lab2Text || '').length > 0 && !/%/.test(String(LB.lab2Text || '')),
  labM ? ('lab2Text=[' + LB.lab2Text + ']（无 %、无条）') : '没有 labrow 留痕')
/* 需求 4「可见性沿用 #lab，别自己另造一套开关」的**源码级**判据：#lab 原有的两条互斥/取证规则
   必须**同时**覆盖 #lab2（面板打开时一并隐藏、--shot 取证时一并隐藏）。 */
const panelHideBoth = /body\.panel-open #lab,body\.panel-open #lab2\{opacity:0 !important\}/.test(styleBlocks.join('\n'))
const shotHideBoth = /body\.shot #lab,body\.shot #lab2\{display:none\}/.test(styleBlocks.join('\n'))
const hotShowBoth = /#stage\.hot #lab,#stage\.hot #lab2\{opacity:\.92\}/.test(styleBlocks.join('\n'))
check('C9b【D 新口径】可见性规则**成对**：hot 显示 / 面板打开隐藏 / --shot 隐藏 三条都同时覆盖 #lab 与 #lab2（没有第二套开关）',
  panelHideBoth && shotHideBoth && hotShowBoth,
  'hot显示=' + hotShowBoth + ' 面板打开隐藏=' + panelHideBoth + ' shot隐藏=' + shotHideBoth)
check('C10【D 新口径】分隔符仍是活动行同款「 · 」（中缀点号 + 两侧空格）',
  !!labM && / · /.test(String(LB.lab2Text || '')), labM ? ('lab2Text=[' + LB.lab2Text + ']') : '没有 labrow 留痕')

/* ---------- D 口径：不越界、不重叠（本项目踩过"内容被窗口裁切"的坑） ---------- */
{
  const win = Array.isArray(LB.win) ? LB.win : null
  const inside = (rc) => Array.isArray(win) && Array.isArray(rc) && rc[0] >= 0 && rc[1] >= 0 && (rc[0] + rc[2]) <= win[0] + 1 && (rc[1] + rc[3]) <= win[1] + 1
  check('C11【D 新口径】两行都**不越出窗口**：#lab / #lab2 的 rect 完整落在视口内（视口高 = --icon-win）',
    Array.isArray(LB.lab) && Array.isArray(LB.lab2) && inside(LB.lab) && inside(LB.lab2),
    'win=' + JSON.stringify(LB.win) + '  #lab=' + JSON.stringify(LB.lab) + '（下沿 ' + (Array.isArray(LB.lab) ? LB.lab[1] + LB.lab[3] : '?') + '）  #lab2=' + JSON.stringify(LB.lab2) + '（下沿 ' + (Array.isArray(LB.lab2) ? LB.lab2[1] + LB.lab2[3] : '?') + '）')
  const ov = { 与图标: overlap(LB.lab2, LB.zoom), 与LAB: overlap(LB.lab2, LB.lab), 与悬浮层: overlap(LB.lab2, LB.hover) }
  check('C12【D 新口径】两行**互不重叠、也不压住图标/悬浮层**（#lab2 与 #zoom / #lab / #v2hover 的相交面积 = 0）',
    ov.与图标 === 0 && ov.与LAB === 0 && ov.与悬浮层 === 0,
    '相交面积：' + JSON.stringify(ov) + ' ｜ #lab2=' + JSON.stringify(LB.lab2) + ' #zoom=' + JSON.stringify(LB.zoom) + ' #v2hover=' + JSON.stringify(LB.hover))
}

/* 不变要素守卫：既有断言口径（悬浮层零重叠/零出界；**任务 C 之后**那根横条默认不画） */
const lay = (lg.match(/panel layout\(hover\): [^\n]*/g) || []).pop() || ''
const geo = (lg.match(/hover geom\(hover\): [^\n]*/g) || []).pop() || ''
check('C13 既有口径不变：悬浮层零重叠、零出界（搬走一行没有把悬浮层版式挤坏）',
  /outside=0/.test(lay) && /overlaps=0/.test(lay), lay || '没有 panel layout(hover) 留痕')
check('C14 既有口径不变：悬浮层仍在窗口内（overflowRight ≤0、overflowBottom ≤0）',
  /overflowRight=-?\d+/.test(geo) && (function () { const m = geo.match(/overflowBottom=(-?\d+)/); return !!m && Number(m[1]) <= 0 })(), geo || '没有 hover geom 留痕')
/* ⚠️ 2026-09-21 任务 C **把这条口径翻了个面**（用户原话「我这个左上角的任务条也不要了，有环形的这样是多此一举」）：
   改前这里断言的是「有分母的计划进度条 `.v2bullet` 仍然渲染」（守卫任务 D 别误删它）；
   任务 C 之后**用户点名要它不在** ⇒ 默认态下 `bullet` 必须是 0。
   这条现在守卫的是**反面**：别让那根条悄悄回来。
   （它自己的双向断言 + 像素差分在 tests/hover-bar.mjs。） */
check('C15【C 新口径｜翻转旧口径】默认态下那根有分母的计划进度条**不画**了（hover inv 报 .v2bullet=0）—— 用户点名要去掉它；本条守卫的是"它别再回来"',
  !!invM && Number(inv.bullet) === 0, invM ? ('v2bullet=' + inv.bullet + '（任务 C 后默认应为 0）') : '没有 hover inv 留痕')

/* ============================================================================
 * ② 像素口径：两行的**实测填充色**必须同色 —— 比 computed style 更硬，
 *    它是"两行真用同一个 color 画出来"的直接证据。
 *    用既有的 `--trans-test` 活体抓帧（**不冻结** ⇒ #lab/#lab2 不会被 `body.shot` 的 display:none 藏掉）。
 * ========================================================================== */
section('两行实测填充像素色（活体抓帧 d-work500）')
const TRANS = runDir('hover-metrics', 'trans')
const log2 = path.join(DIR, 'trans.log')
fs.rmSync(log2, { force: true })
const st2 = runRuntime(['--hidden', '--trans-test', TRANS, '--test-hover', 'on', '--shot-payload', pf, '--state', 'WORKING'],
  { home: tmpHome('hoverrow2'), log: log2 })
await st2.waitExit(60000)
killStrayElectron()
await sleep(200)
const lg2 = readLog(log2)
/* 像素口径要的是 **d-work500 那一帧**对应的那一份几何/样式：trans 通道自己会连发 IDLE/WORKING/ERROR，
   所以取"最后一条处在 WORKING（#lab 文本含「执行中」）且拿得到指标值"的留痕 —— 与 d-work500 同帧。 */
const labT = (lg2.match(/labrow\([a-z-]+\): \{[^\n]*/g) || [])
let LB2 = {}
let labM2 = ''
for (const s of labT) {
  try {
    const o = JSON.parse(s.replace(/^labrow\([a-z-]+\): /, ''))
    if (/执行中/.test(String(o.labText || '')) && /^\d+ 轮 · \d+ 工具$/.test(String(o.lab2Text || ''))) { LB2 = o; labM2 = s }
  } catch (e) { /* ignore */ }
}
if (!labM2) labM2 = labT.pop() || ''
const frame = (st2.stdout.find((l) => l.includes('TRANS d-work500')) || '')
const png = (frame.match(/([A-Za-z]:\\[^\s]*\.png)/) || [])[1] || ''
let pxLab = null, pxLab2 = null, dpr = 2
if (png && fs.existsSync(png)) {
  const img = pngDecode(fs.readFileSync(png))
  dpr = (Array.isArray(LB2.win) && LB2.win[0]) ? img.w / LB2.win[0] : 2
  pxLab = lineFill(img, rectOf(LB2.lab, dpr))
  pxLab2 = lineFill(img, rectOf(LB2.lab2, dpr))
  console.log('  抓帧像素: ' + img.w + 'x' + img.h + '  dpr=' + dpr.toFixed(2))
}
console.log('  抓帧: ' + (frame || '(没有 TRANS d-work500 行)'))
console.log('  两行留痕: ' + (labM2 || '(无)').slice(0, 240))
console.log('  实测填充色: #lab=' + (pxLab ? fmt(pxLab) : 'n/a') + '  #lab2=' + (pxLab2 ? fmt(pxLab2) : 'n/a'))
{
  let d = null
  if (pxLab && pxLab2) d = Math.max(...[0, 1, 2].map((k) => Math.abs(pxLab[k] - pxLab2[k])))
  check('C16【D 新口径】两行**实测填充像素色**一致（同一 color 画出来的直接证据：逐通道差 ≤12，且不是近黑）',
    d !== null && d <= 12 && !!pxLab2 && (pxLab2[0] + pxLab2[1] + pxLab2[2]) > 90,
    d === null ? '没有取到像素（抓帧失败）' : ('#lab=' + fmt(pxLab) + '  #lab2=' + fmt(pxLab2) + '  最大通道差 ' + d))
}

section(ok ? '代理指标行（#lab 下方）：全部通过' : '代理指标行（#lab 下方）：有失败项')
await sleep(150)
process.exit(ok ? 0 : 1)
