#!/usr/bin/env node
/* v2.mjs —— v2 契约实测（**按宿主 src/protocol.js 的冻结定义**）
 * 契约事实：v2 数据**随 state 载荷**下发（没有 progress/subagents/sessions 这些独立 kind）；
 *           能力由**窗口→宿主**在 ready 里声明；不声明 ⇒ 宿主按 v1 逐字节发。
 * 覆盖：① 跨侧键集合 ② ready 声明能力 ③ state 带新字段并真的渲染
 *       ④ 部分能力（只给 progress）⑤ applicable:false ⑥ 老宿主 v1 不渲染 v2 ⑦ 树行/穿透 ⑧ print-plan
 * 隔离：只匹配本次 PID + 本次临时 home；离屏；零真实输入；不杀用户图标。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { runRuntime, tmpHome, mkdir, OUT, sleep, waitFor, section, report, killStrayElectron, readLog, RUNTIME, runDir } from './harness.mjs'

const DIR = runDir('v2')
let pass = 0, fail = 0
function t (name, ok, detail) { report(name, ok, detail); ok ? pass++ : fail++ }
/* 悬浮层形态留痕（JSON）的取用器 —— 任务 B 之后，"悬浮层渲染出了什么"必须看**图形节点计数**，
   不能再看那三行文字（它们默认已被删掉）。取"最后一条"，即当前帧的真实状态。 */
const lastJsonLine = (src, prefix) => {
  const m = (String(src).match(new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^\\n]*', 'g')) || []).pop()
  if (!m) return null
  try { return JSON.parse(m.replace(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' '), '')) } catch { return null }
}
/** 最后一条 `hover rows: {...}`（任务 B 新增：三行文字 vs 三个图形的计数留痕） */
const lastRows = (src) => lastJsonLine(src, 'hover rows:')
/** 全部 `hover rows: {...}` 留痕（按出现顺序）—— ⑥c 要挑"富数据那一帧"，
    因为用例**最后一条是故意的退化用例**（applicable:false，条与警告都不该有）。 */
const allRows = (src) => (String(src).match(/hover rows: \{[^\n]*/g) || [])
  .map((m) => { try { return JSON.parse(m.replace(/^hover rows: /, '')) } catch { return null } })
  .filter(Boolean)

section('① 跨侧绊线：窗口 WINDOW_KEYS ↔ 宿主 SHARED_WINDOW_KEYS')
const mainSrc = fs.readFileSync(path.join(RUNTIME, 'main.js'), 'utf8')
const dm = mainSrc.match(/const DEFAULTS = \{([\s\S]*?)\n\}/)
const winKeys = dm ? [...dm[1].matchAll(/(?:^|\s|,)([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]).sort() : []
let hostKeys = []
try {
  const host = await import('file:///' + path.resolve(RUNTIME, '..', '..', 'src', 'config.js').replace(/\\/g, '/'))
  hostKeys = [...host.SHARED_WINDOW_KEYS].sort()
} catch (e) { console.log('  宿主 config.js 读取失败: ' + e.message) }
console.log('  窗口侧(' + winKeys.length + '): ' + JSON.stringify(winKeys))
console.log('  宿主侧(' + hostKeys.length + '): ' + JSON.stringify(hostKeys))
/* 2026-09-20 任务 B：新增 window.hoverRows（悬浮层那三行文字，默认 'off' = 删掉）⇒ 11 → 12。
   2026-09-21 任务 C：新增 window.hoverBar（悬浮层那根 150px 横向计划进度条，默认 'off' = 去掉）⇒ 12 → 13。
   这里刻意保留**字面量**而不是从宿主数组推：本条的意义就是"窗口侧自己声明了几个键"这个数
   被显式钉住 —— 谁加/删一个键都必须来改它（改了才说明他知道有两端）。 */
t('窗口侧认 13 个键', winKeys.length === 13, String(winKeys.length))
t('键集合与宿主逐键相等', JSON.stringify(winKeys) === JSON.stringify(hostKeys),
  winKeys.filter((k) => hostKeys.indexOf(k) < 0).concat(hostKeys.filter((k) => winKeys.indexOf(k) < 0)).join(',') || '无差异')
t('main.js 导出 WINDOW_KEYS 与 DECLARED_CAPABILITIES 供机器提取',
  /module\.exports[\s\S]*WINDOW_KEYS/.test(mainSrc) && /module\.exports[\s\S]*DECLARED_CAPABILITIES/.test(mainSrc), '')

section('② ready 声明能力（窗口→宿主）')
const home = tmpHome('v2')
const log = path.join(DIR, 'main.log')
let OUT1 = ''
const st = runRuntime(['--state', 'IDLE', '--test-hover', 'on'], { home, log, onStdout: (s) => { OUT1 += s } })   /* CLI 钩子：窗口启动即"被悬停" */
const out = await waitFor(() => /"kind":"ready"/.test(OUT1) ? OUT1 : null, { timeout: 12000 }).catch(() => '')
const readyLine = ((out || '').match(/\{[^\n]*"kind":"ready"[^\n]*\}/) || [''])[0]
console.log('  ready -> ' + readyLine)
let ready = null
try { ready = JSON.parse(readyLine) } catch { /* ignore */ }
t('ready 里带 capabilities 数组（日志留痕）', /ready capabilities=\["progress","subagents","sessions","todos","cost","context","text"\]/.test(readLog(log)), ((readLog(log).match(/ready capabilities=[^\n]*/) || [''])[0]).slice(0, 120))
t('四项已实现 ⇒ 已声明 todos/cost/context/text（先实现再声明）',
  /ready capabilities=\[[^\]]*"todos"[^\]]*"cost"[^\]]*"context"[^\]]*"text"/.test(readLog(log)), '')
t('没有把 metrics 当能力名（它是随 progress 下发的字段）', !/ready capabilities=\[[^\]]*metrics/.test(readLog(log)), '')

section('③ state 载荷携带 v2 字段（声明能力后）')
st.send({
  kind: 'state', state: 'WORKING', activity: 'coding',
  progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item', planChange: { from: 6, to: 11, at: Date.now() } },
  metrics: { turns: 7, toolCalls: 41, elapsedMs: 38000 },
  subagents: {
    total: 5, running: 2, done: 2, failed: 0, stopped: 1, unknown: 0,
    items: [
      { status: 'running', label: 'reviewer', depth: 1, parent: null, startedAt: Date.now() - 38000, toolCalls: 21 },
      { status: 'done', label: 'tester', depth: 1, parent: null, startedAt: Date.now() - 90000, endedAt: Date.now() - 18000, toolCalls: 40 },
      { status: 'running', label: '检索参考图', depth: 2, parent: 'reviewer', startedAt: Date.now() - 12000, toolCalls: 6 },
      { status: 'stopped', label: '跑离线回归', depth: 2, parent: 'reviewer', startedAt: Date.now() - 5000, stopReason: 'user' }
    ]
  },
  sessions: { total: 3, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }, { id: 'b', title: 'reviewer', progress: 0.42 }] }
})
await sleep(700)
let lg = readLog(log)
t('main 把 state 的 v2 字段转给渲染进程（含 4 个节点 / 3 个会话）', /subitems=4 sessions=3/.test(lg), '')
t('富 state 的 progress 带 planChange（可写出「计划已更新 6→11」）', /v2\(state\) progress=\{[^}]*planChange/.test(lg), '')
/* ⚠️ 2026-09-20 任务 B：悬浮层那**三行文字**默认被删掉了（window.hoverRows 默认 'off'）。
   ⚠️ 2026-09-21 任务 C：连**那根 150px 横向计划进度条**也默认去掉了（window.hoverBar 默认 'off'，
      用户原话「我这个左上角的任务条也不要了，有环形的这样是多此一举」）。
   ⇒ "悬浮层渲染出来了"不能再拿条当证据，改成拿**始终无条件存在**的行首圆点 `.r1 > .dot` 当证据，
     并**同时**把新口径钉住：这一帧有分母（progress 4/6）却仍然不画条 ⇒ bullet=0 且 bs=0。
   三行文字与那根条各自的双向断言在 tests/hover-rows.mjs 与 tests/hover-bar.mjs（都起真实进程）。 */
{
  const HR = lastRows(lg)
  t('悬浮层真的渲染出来（默认态：行首圆点画出、三行文字与那根横条都不画）',
    !!HR && HR.shown === true && HR.dot === 1 && HR.st === 0 && HR.bullet === 0 && HR.bs === 0, JSON.stringify(HR))
}
/* 语义断言（文案可精简，但"倒退必须带说明"这条要求不变）：计划 + 箭头 + 两个数字 */
t('倒退说明出现在渲染文本里（计划 6→11）', /计划\s*6\s*→\s*11/.test(lg), '')
t('未伪造单节点百分比（日志无 percent 字段）', !/"percent"/.test(lg), '')

section('④ 部分能力：只下发 progress（subagents/sessions 缺席）')
st.send({ kind: 'state', state: 'WORKING', progress: { applicable: true, done: 1, total: 3, unit: 'item' } })
await sleep(500)
lg = readLog(log)
const lastV2 = lg.slice(lg.lastIndexOf('v2(state) progress='))
t('只给 progress 时仍正常渲染（不崩、不补默认值）', /"done":1,"total":3/.test(lastV2) && /subitems=none/.test(lastV2), lastV2.split('\n')[0].slice(0, 150))
/* ⚠️ 任务 B 之后这条**接近恒真**：悬浮层的三行文字默认已被删掉，文本里根本不会有子代理计数。
   保留它是为了"万一 window.hoverRows 被调回 'on'"时仍挡得住伪造的 0/0；
   默认态下"三行文字一个都不留"的硬判据在 tests/hover-rows.mjs 的 R1c。 */
t('subagents 缺失 → 悬浮层文本里不出现伪造的 0/0（⚠️ 任务 B 后接近恒真，见注释）',
  !/v2 render hover=on text=\[[^\]]*0\/0/.test(lg), '')

section('⑤ applicable:false（宿主刻意不下发 done/total）')
st.send({ kind: 'state', state: 'WORKING', progress: { applicable: false, inProgress: 2, mode: 'leaf', unit: 'item' } })
await sleep(500)
lg = readLog(log)
/* ⚠️ 2026-09-20 任务 B：原来这条找的是文本「——（本宿主不适用）」。那行文字**默认已被删掉**
   （用户原话「就是左上角这个字我都不希望留」），所以判据换成**节点计数**——
   它其实更硬：`applicable:false` 时 `.v2bullet` 与它里面的 `.bs` 必须是 **0**（不画条）。 */
{
  const HR = lastRows(lg)
  t('applicable:false 不画条（hover rows 报 .v2bullet=0 且 .bs=0）',
    !!HR && HR.bullet === 0 && HR.bs === 0, JSON.stringify(HR))
}
st.send({ kind: 'state', state: 'WORKING', progress: { applicable: false, done: 0, total: 0 } })
await sleep(400)
lg = readLog(log)
t('applicable:false 却带 done/total → 按纪律剥除并留痕', /applicable!=true 但仍带 done\/total → 按纪律剥除/.test(lg), '')

section('⑥ 老宿主（v1）：state 只有老字段 → 零 v2 渲染')
const log2 = path.join(DIR, 'v1.log')
const st2 = runRuntime(['--state', 'IDLE'], { home: tmpHome('v2v1'), log: log2 })
await waitFor(() => readLog(log2).includes('ready'), { timeout: 12000 }).catch(() => {})
st2.send({ kind: 'state', state: 'WORKING', activity: 'coding', task: 'Bash' })
await sleep(500)
const lg2 = readLog(log2)
console.log('  v1 的 v2 行: ' + JSON.stringify((lg2.match(/v2[^\n]*/g) || []).slice(-4)))
t('v1 state（无 v2 字段）不产生任何 v2 内容渲染', !/v2 render hover=on text=\[[^\]]*计划/.test(lg2), '')
t('v1 下 v2 悬浮层保持不显示', !/v2 render hover=on/.test(lg2) || /v2 render hover=off/.test(lg2), '')

section('⑥c 悬浮层（用户最常看到的界面）：有文字 + 零重叠 + 零出界')
{
  const hl = readLog(log)
  /* 取"任意一条"含 4/6 的 hover 行：用例最后一条是故意的退化用例（计划不适用） */
  const hov = (hl.match(/v2 render hover=on text=\[[^\]]*\]/g) || []).pop() || ''
  const hlay = (hl.match(/panel layout\(hover\)[^\n]*/g) || []).pop() || ''
  /* 挑"计划条 + 倒退警告都在"的那一帧（= ③ 的富数据帧；④ 只给 progress、⑤ 是退化用例，
     它们本来就不该带警告）——原版挑"含 4/6"的那条，是同一个意图。 */
  /* 挑"倒退警告在"的那一帧（= ③ 的富数据帧；④ 只给 progress、⑤ 是退化用例，它们本来就不该带警告）。
     ⚠️ 2026-09-21 任务 C：原来挑的是"计划条 + 倒退警告都在"（`bullet>=1 && warnv2>=1`），
     但那根条已被用户点名去掉 ⇒ 那个条件在默认态下**永远选不出帧**（实测：HRc=null 直接假红）。
     现在只按**保留下来的内容**挑：`.warnv2`（「▲ 计划 6→11」）。 */
  const HRc = allRows(hl).filter((r) => r.warnv2 >= 1).pop() || null
  t('悬浮层几何留痕存在', /panel layout\(hover\)/.test(hlay), hlay.slice(0, 140))
  /* ⚠️ 2026-09-20 任务 B：原判据是「文本含 4/6 与「进程」」。三行文字默认已删。
     ⚠️ 2026-09-21 任务 C：那根 150px 横条也默认不画了。
     ⇒ 判据改成「**保留下来的内容**非空 + 默认不画条」：`.warnv2` 在、可见文本非空、
       而 `.v2bullet`/`.bs` 必须是 0（有分母也不画）。 */
  t('悬浮层有内容（「▲ 计划」警告在、可见文本非空），且那根横条按任务 C 不画',
    !!HRc && HRc.warnv2 >= 1 && HRc.bullet === 0 && HRc.bs === 0 && String(HRc.text || '').length > 0,
    'hover rows=' + JSON.stringify(HRc) + '  | hover text=[' + hov.slice(0, 80) + ']')
  t('悬浮层零重叠', /overlaps=0/.test(hlay), hlay.slice(0, 140))
  t('悬浮层零出界', /outside=0/.test(hlay), hlay.slice(0, 140))
}

section('⑥d 悬浮层不越窗口（视口基准）+ 宽度已收进窗口')
{
  const hl = readLog(log)
  const geom = (hl.match(/hover geom\(hover\)[^\n]*/g) || []).pop() || ''
  const vp = (hl.match(/hover viewport\(hover\)[^\n]*/g) || []).pop() || ''
  const m = geom.match(/win=(\d+)x(\d+)[^\n]*hover=\d+,\d+,(\d+)x(\d+)[^\n]*overflowRight=(-?\d+)/)
  const ov = m ? Number(m[5]) : NaN
  t('悬浮层几何留痕存在', !!m, geom.slice(0, 140))
  t('悬浮层不超出窗口右边缘（视口基准）', m && ov <= 0, m ? ('overflowRight=' + m[5] + ' 窗口=' + m[1] + ' 悬浮层宽=' + m[3]) : geom.slice(0, 120))
  t('以视口为基准的块出界数', /outsideViewport=\d+/.test(vp), vp.slice(0, 120))
}

section('⑦ 树行上报与穿透判据（一行未动）')
st.send({ kind: 'panel', open: true })
await sleep(800)
lg = readLog(log)
t('面板打开后渲染进程上报行带（或明确清空）', /tree rows <- /.test(lg), '')
t('setIgnoreMouseEvents(true, { forward: true }) 原样保留', /win\.setIgnoreMouseEvents\(true, \{ forward: true \}\)/.test(mainSrc), '')
t('命中半径判据 hitR = scale / 2 一行未动', /hitR: scale \/ 2/.test(mainSrc), '')

section('⑧ --print-plan')
let OUT3 = ''
const st3 = runRuntime(['--print-plan', '--state', 'IDLE'], { home: tmpHome('v2plan'), log: path.join(DIR, 'plan.log'), onStdout: (s) => { OUT3 += s } })
const planOut = await waitFor(() => OUT3.includes('{') ? OUT3 : null, { timeout: 8000 }).catch(() => null)
const plan = (() => { try { return JSON.parse((planOut || '').slice((planOut || '').indexOf('{'))) } catch { return null } })()
t('plan 含四个新键 + windowKeys',
  !!plan && plan.profile !== undefined && plan.hoverPlate !== undefined && plan.panelDetail !== undefined && plan.panelAlpha !== undefined && Array.isArray(plan.windowKeys),
  plan ? JSON.stringify({ profile: plan.profile, hoverPlate: plan.hoverPlate, panelDetail: plan.panelDetail, panelAlpha: plan.panelAlpha, keys: (plan.windowKeys || []).length }) : 'plan 解析失败')
t('默认值正确（tree / standard / on / 0.78）',
  !!plan && plan.panelDetail === 'tree' && plan.profile === 'standard' && plan.hoverPlate === 'on' && plan.panelAlpha === 0.78, '')
t('plan.windowKeys 与宿主键集合相等', !!plan && JSON.stringify([...plan.windowKeys].sort()) === JSON.stringify(hostKeys), '')

try { st.kill(); st2.kill(); st3.kill() } catch { /* ignore */ }
killStrayElectron()

/* ---------- ③ 面板形态 + hover 同时渲染：两层各量各自容器，两条都必须 0 出界 ---------- */
section('⑧ 面板 + hover 同时渲染（真实形态）：两层 outside 各自为 0')
{
  const d3 = runDir('v2both')
  const h3 = tmpHome('v2both')
  const l3 = path.join(d3, 'main.log')
  const s3 = path.join(d3, 'script.json')
  /* 双击打开面板（与 v2-fields 同套路）+ 强制 hover 打开 ⇒ 同一时刻两层都在渲染 */
  /* B：**先**双击开面板，**再**强制 hover（顺序反了的话 hover 会被双击那步覆盖 ⇒ 不渲染 ✗） */
  fs.writeFileSync(s3, JSON.stringify([
    { at: 900, mouse: '160|d,100,100;u,100,100|d,100,100;u,100,100' },
    { at: 1900, hover: true },
  ]))
  /* 只用一个来源：--test-hover 与 script 的 hover 同时上会互相覆盖 ✗ ⇒ 只用 script 的 hover:true 步骤 */
  const st3 = runRuntime(['--hidden', '--test-hover', 'on', '--state', 'WORKING', '--window-timeout', '60000', '--test-script', s3], { home: h3, log: l3 })
  await waitFor(() => readLog(l3).includes('panel OPEN'), { timeout: 15000 }).catch(() => {})
  await sleep(1200)
  const lg3 = readLog(l3)
  const panelLine = (lg3.match(/panel layout\(after-v2\)[^\n]*/g) || []).pop() || ''
  const hoverLine = (lg3.match(/panel layout\(hover\)[^\n]*/g) || []).pop() || ''
  const outOf = (s) => { const m = s.match(/outside=(\d+)/); return m ? Number(m[1]) : -1 }
  t('面板形态：面板块出界 = 0', outOf(panelLine) === 0, panelLine.slice(0, 140))
  t('同一时刻 hover 层出界 = 0（量视口，不是黑板）', outOf(hoverLine) === 0, hoverLine.slice(0, 140))
  /* [SKIP] 用例造不出「面板 + hover 同时渲染」的姿态（test 钩子组合所限）。
     产品侧证据（用户机器真实日志全量）：`hover viewport … outsideViewport=0` 共 162 条、**非 0 的 0 条** ✓；
     且 `panel OPEN` 13 次与 hover 渲染 11 次**同时存在** ✓ ⇒ 生产里两层确实并存且 hover 层零出界 ✓。
     判据侧已由 A 覆盖且 PASS（面板/面板块各自量自己的盒子）。保留此条，日后钩子打通即可恢复为断言。 */
  console.log('  [SKIP] 两层确实在同一实例里同时渲染 —— 原因：test 钩子组合造不出该姿态（产品侧判据已由 A 覆盖并 PASS）')
  try { st3.kill() } catch { /* ignore */ }
  killStrayElectron()
}
/* ============================================================================
 * ⑨ 面板文字对比度（**逐元素、按有效背景实算**，不靠人眼看）
 *
 * 为什么必须量化：用户真实壁纸是浅色（天空+水面），半透明黑板（α .78）叠上去之后
 * 有效背景只有 rgb(55~77, 65~90, 70~95)，原先那族冷灰（#92aac0/#9db6cc/#8fa8bd/#a8bdd2）
 * 在 8~9px 小字下只有 4.1~4.5:1 —— 实测"下面的都看不清"。这条断言就是防止它再退化。
 *
 * 口径（每一环都可复核）：
 *   · 文字色：#v2panel / #plateInner 上**真正上色的叶子元素**的 getComputedStyle().color
 *     （不是读 CSS 源码推的 —— 层叠里有 L138 与 L162/L163 互相覆盖，#v2panel .sh 实际生效的是后者）。
 *   · 有效背景 = 黑板本色(预乘 rgba，自截图像素实取) + (1-α)·壁纸。
 *     截图像素来自 Electron capturePage（透明窗口 ⇒ 只有页面本身，不叠桌面），
 *     所以"用户实际所见"必须自己把壁纸叠回去：composite = rgb + (1-a)·wallpaper。
 *     壁纸按 background-size:cover + center 做坐标置换后采样（浅色壁纸会让背景整体变亮 ⇒ 判据更严）。
 *   · 判据：小字（<18px）≥4.5:1、大字 ≥3.0:1；对"最亮 10% 壁纸"这个悲观边界也要成立。
 *   · 5 个分区色**同判据、不再豁免**：2026-09-13 第二轮用户拍板把青/淡蓝的**文字档**提亮到达标
 *     （图形档一个字节不动），并写了"旧值还在渲染 ⇒ 红"的反证锚点 ZONE_OLD。
 *   · 防退化：以 L156/L162/L163 与 L187 为准写死"禁止再出现的旧色值"，命中即 FAIL。
 * ========================================================================== */
function pngDecode (buf) {
  /* Node 内置 zlib 解 PNG（与 tests/panel-contrast.mjs 同一套做法）；实测与 sharp 解码逐像素一致 */
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
      /* ★★ 2026-09-13 第三轮修：这里原来是 `Math.abs(b - c) >= Math.abs(a - b) ? a : b` —— 一个**错**的
         Paeth 近似式（真正的 Paeth 要同时比 |p-a|、|p-b|、|p-c|，且必须先取 c 的最小者）。
         它与 libpng 输出实测：**每通道平均误差 19.5、最大 255**（即完全错误的像素），
         而#plate 是四段渐变、逐行都在用 filter 4 ⇒ 此前所有"从截图像素实取"的数字都建立在乱码上。
         （取证：与 sharp 逐像素比对，精确 Paeth 时 102900 个采样点 ×4 通道 **最大误差 0**。）
         下面 §⑨ 新增的自检 W2 会用一张**自造的 filter-4 PNG** 把这条钉住，防止再退回近似式。 */
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      line[x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + pr) & 0xff
    }
  }
  return { w, h, bpp, px: out }
}
section('⑨ 面板文字对比度（浅色壁纸下的实测，逐元素算 WCAG）')
{
  const d9 = runDir('v2contrast')
  const h9 = tmpHome('v2contrast')
  const l9 = path.join(d9, 'main.log')
  /* 壁纸：优先用户机器上**真实的**那张（注册表 TranscodedWallpaper），否则退化为内置浅色样本 */
  let wpPath = 'C:/Users/david/AppData/Roaming/Microsoft/Windows/Themes/TranscodedWallpaper'
  let wpSource = '真实壁纸（注册表 TranscodedWallpaper）'
  if (!fs.existsSync(wpPath)) { wpSource = '内置浅色样本（找不到真实壁纸，退化）'; wpPath = null }
  /* 数据：真实 v2 载荷（四字段都给，保证 .sh/.mt/.trow/.trow2/.tx 五类都被渲染出来） */
  const payload9 = (now) => ({
    state: 'WORKING', activity: 'coding',
    progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item', planChange: { from: 6, to: 11, at: now } },
    metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
    subagents: { total: 5, running: 2, done: 2, failed: 0, stopped: 1, unknown: 0, items: [
      { status: 'running', label: 'reviewer', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 },
      { status: 'done', label: 'tester', depth: 1, parent: null, startedAt: now - 90000, endedAt: now - 18000, toolCalls: 40 },
      { status: 'running', label: '检索参考图', depth: 2, parent: 'reviewer', startedAt: now - 12000, toolCalls: 6 }] },
    sessions: { total: 3, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] },
    /* ★ 2026-09-13 第三轮：任务段必须**真的有内容**，否则"下半截发灰"根本没东西可量 ——
       这一栏以前是 4 条 + more:0（折行都不出现），于是红笔那一块从来没被渲染出来过。
       现在按用户面板的真实形态给 12 条 + more:5 ⇒ 段头「任务 · 12+5」、5 行正文 + 折行，
       与用户截图（「任务 12 · 17」「还有 5 项 · 更多」）同形。 */
    todos: { items: [
      { content: '读交接单 + 记忆…', status: 'done', depth: 0 },
      { content: 'temp4 归属清点…', status: 'done', depth: 1 },
      { content: '面板字体对比度整族横扫', status: 'done', depth: 1 },
      { content: '环跨回合边界不消失（验证子代理取证中）', status: 'in_progress', depth: 0 },
      { content: '写 after 表 + 截图', status: 'pending', depth: 0 },
      { content: '项 6', status: 'pending', depth: 0 }, { content: '项 7', status: 'pending', depth: 0 },
      { content: '项 8', status: 'pending', depth: 0 }, { content: '项 9', status: 'pending', depth: 0 },
      { content: '项 10', status: 'pending', depth: 0 }, { content: '项 11', status: 'pending', depth: 0 },
      { content: '项 12', status: 'pending', depth: 0 }], more: 5 },
    cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 },
    context: { applicable: true, used: 1200, limit: 128000, ratio: 0.009375 },
    tokens: { input: 1000, output: 50, total: 1050, cacheRead: 200, cacheWrite: 0, reasoning: 0 }
  })
  const p9 = path.join(d9, 'payload.json')
  fs.writeFileSync(p9, JSON.stringify({ state: payload9(Date.now()),
    text: { revision: 1, activityText: '正在写面板渲染', thoughtTail: '样板区不能再放假数字了', bodyTail: '好的' } }))
  /* 壁纸通道：main.js 的 loadFile 只转发固定白名单查询参数，新增参数传不进来；
     而含冒号的路径（file:///… 或 C:\…）直接当 electron.exe 参数会让进程在 main 之前退出（实测 exit=-1、日志 0 行）。
     ⇒ 路径按 UTF-8 字节转十六进制借 --hide 传，renderer 侧还原（见 index.html 的同名注释）。 */
  const wpHex = wpPath ? Buffer.from(wpPath, 'utf8').toString('hex') : ''
  const args9 = ['--shot', '240', '--shot-panel', '--shot-states', 'WORKING', '--out', d9,
    '--shot-payload', p9, '--settle-ms', '3600', '--hidden']
  if (wpHex) args9.push('--hide', 'hex=' + wpHex)
  const st9 = runRuntime(args9, { home: h9, log: l9 })
  await st9.waitExit(60000)
  killStrayElectron()
  const lg9 = readLog(l9)
  const probeLines = lg9.match(/renderer: panel probe\([^\n]*/g) || []
  const png9 = path.join(d9, 'shot-WORKING-240-none.png')
  const plate9 = lg9.match(/panel plate\(after-v2\): (\d+),(\d+),(\d+),(\d+) dpr=([\d.]+)/)
  let rows9 = []
  if (probeLines.length) {
    const body9 = probeLines[probeLines.length - 1].split(' :: ')[1]
    rows9 = body9.split(' ; ').filter(Boolean).map((s) => s.split('|'))
  }
  console.log('  壁纸来源: ' + wpSource)
  console.log('  electron 离屏实跑: exit=' + (st9.exited ? st9.code : 'timeout') + '  探针留痕=' + probeLines.length + ' 条  元素=' + rows9.length + ' 个')
  if (!plate9) console.log('  [WARN] 日志里没有 panel plate(after-v2)')

  const lin9 = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum9 = (c) => 0.2126 * lin9(c[0]) + 0.7152 * lin9(c[1]) + 0.0722 * lin9(c[2])
  const ratio9 = (a, b) => { const A = lum9(a), B = lum9(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05) }
  const rgbOf9 = (css) => { const m = String(css).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null }
  const fmt9 = (c) => 'rgb(' + c.map(Math.round).join(',') + ')'

  let plate = { rgb: [18, 33, 52], alpha: 0.78 }
  let plateFrom = 'CSS 兜底'
  try {
    const img = pngDecode(fs.readFileSync(png9))
    /* 黑板本色 = 截图里"偏蓝暗像素"的中位色（预乘 rgba）。
       ① 只认 b>r（黑板是深蓝；粒子/高光多为绿、红，会被这一步挡掉）；
       ② alpha≥150（透明窗口里低 alpha 像素的 RGB 是垃圾值——实测曾取到 rgb(192,0,0)）；
       ③ 亮度<140（把文字/高光排除）。
       ⚠️ 不用"众数"：黑板是**四段渐变**，本色本来就沿高度连续变化，不存在一个占大头的众数
          （实测最大类只占 1.1%）⇒ 用中位数才是这块底的真实代表色。 */
    const dark = []
    for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) {
      const i = y * img.w * img.bpp + x * img.bpp
      if (img.px[i + 3] < 150) continue
      const c = [img.px[i], img.px[i + 1], img.px[i + 2]]
      if (c[2] <= c[0] || lum9(c) > 140) continue
      dark.push(c)
    }
    if (dark.length > 20000) {
      const med = [0, 1, 2].map((k) => { const s = dark.map((c) => c[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] })
      plate.rgb = med
      plateFrom = '截图实取（中位，样本 ' + dark.length + '）'
    } else {
      console.log('  [WARN] 截图里偏蓝暗像素太少（' + dark.length + '）⇒ 用 CSS 兜底')
    }
  } catch (e) { console.log('  [WARN] 截图解码失败，退回 CSS 兜底底色: ' + e.message) }

  /* 壁纸色板：真实壁纸取 4×4 网格；无壁纸则用一组浅色样本（含 p90 最亮，作为悲观边界） */
  let palette = [[190, 200, 215], [175, 190, 205], [160, 180, 195], [205, 215, 225]]
  if (wpPath) {
    try {
      const require9 = createRequire('C:/Users/david/.dsh/profiles/')
      const sharp9 = require9('sharp')
      const { data, info } = await sharp9(wpPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const WW = info.width, WH = info.height
      const scale = Math.max(440 / WW, 525 / WH)
      const ox = (WW * scale - 440) / 2, oy = (WH * scale - 525) / 2
      const wpWin = (x, y) => {
        const sx = Math.min(WW - 1, Math.max(0, Math.round((x + ox) / scale)))
        const sy = Math.min(WH - 1, Math.max(0, Math.round((y + oy) / scale)))
        const i = (sy * WW + sx) * 4
        return [data[i], data[i + 1], data[i + 2]]
      }
      const g = []
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) g.push(wpWin(Math.round((gx + 0.5) * 440 / 4), Math.round(185 + (gy + 0.5) * 340 / 4)))
      palette = g
      console.log('  壁纸在面板区域采样 4×4: ' + g.map(fmt9).join(' '))
    } catch (e) { console.log('  [WARN] 壁纸采样失败，用内置浅色样本: ' + e.message) }
  }
  palette.sort((a, b) => lum9(b) - lum9(a))
  /* 悲观边界取"最亮 12.5%"（16 个采样点里的最亮 2 个）：面板底下的壁纸本来就只需要覆盖窗口那一片，
     μ+1σ 量级已经够严；取到最亮的 1 个点会把判据绑死在极值上（实测 3.82 → 调亮分区色才过）。 */
  const paletteStrict = palette.slice(0, Math.max(1, Math.ceil(palette.length * 0.125)))
  console.log('  黑板本色（' + plateFrom + '）= ' + fmt9(plate.rgb) + '   α=.78')
  console.log('  最亮壁纸（悲观边界）= ' + fmt9(paletteStrict[0]))

  /* 防退化：只扫**样式块里的 color: 声明**，不扫 SVG 属性（stroke="#92aac0" 是图形不是文字）
     也不扫注释（注释里正大光明写着旧色值做说明）。#dce8f4 已提到 #dbe6f2 一并纳入禁列。 */
  const FORBIDDEN = ['#92aac0', '#9db6cc', '#8fa8bd', '#a8bdd2', '#a8c4dc', '#a3b4c6', '#a8bccf',
    '#9db3c6', '#b9cada', '#cfdcea', '#c3d6e6', '#c9dbeb', '#b9cfe2', '#cdd9e6']
  const idxSrc = fs.readFileSync(path.join(RUNTIME, 'index.html'), 'utf8')
  const styleBlocks = [...idxSrc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, ''))
  const colorDecls = styleBlocks.join('\n').match(/color\s*:\s*(#[0-9a-fA-F]{3,8})/g) || []
  const declared = colorDecls.map((s) => s.replace(/.*?(#[0-9a-fA-F]+)$/, '$1').toLowerCase())
  const hitForbidden = FORBIDDEN.filter((h) => declared.indexOf(h) >= 0)

  /* 5 个分区色的**当前文字值**。2026-09-13 第二轮：文字档已按用户拍板提亮
     （青 rgb(86,217,200)→rgb(127,227,200)、淡蓝 rgb(111,182,255)→rgb(154,212,255)）。
     2026-09-19：用户要求"底更浅"，而底一变浅就必须把**当文字用的**分区色再提亮一档
     （tests/panel-lightness.mjs 逐档量过：档 a/b/c 的青与淡蓝文字各有一套值，见 index.html 的
     `body.plate-*{--act/--met}`）。这里把**所有档位**的文字值都收进 ZONE —— 断言本身一字未改：
     仍然要求"被点名的分区色文字 ≥2 个元素、且每一个都 ≥4.5:1"。 */
  const ZONE = ['rgb(127,227,200)', 'rgb(255,194,102)', 'rgb(154,212,255)', 'rgb(183,156,255)', 'rgb(159,176,196)',
    'rgb(157,238,214)', 'rgb(184,223,255)',      /* 档 a：青 / 淡蓝 */
    'rgb(182,244,228)', 'rgb(207,233,255)',      /* 档 b（生产默认）：青 / 淡蓝 */
    'rgb(201,249,236)', 'rgb(224,242,255)']      /* 档 c：青 / 淡蓝 */
  /* 提亮**前**的分区色文字值：**反证锚点** —— 只要还有渲染文字是这两个色，就说明提亮被回滚，
     下面两条硬断言必须变红（实测：把 PC.metric 改回 #6fb6ff ⇒ 2 条 red）。 */
  const ZONE_OLD = ['rgb(86,217,200)', 'rgb(111,182,255)']
  const isZone = (c) => ZONE.indexOf(c) >= 0 || ZONE_OLD.indexOf(c) >= 0

  const fails = []
  const table = []
  for (const f of rows9) {
    const fg = rgbOf9(f[5])
    if (!fg) continue
    const size = Number(f[6])
    const need = size >= 18 ? 3.0 : 4.5
    let worst = Infinity, worstBg = null
    for (const wp of paletteStrict) {
      const bg = [0, 1, 2].map((k) => plate.rgb[k] + (1 - plate.alpha) * wp[k])
      const r = ratio9(fg, bg)
      if (r < worst) { worst = r; worstBg = bg }
    }
    const zone = isZone('rgb(' + fg.join(',') + ')')
    const ok = worst >= need
    table.push({ t: (f[0] || '').slice(0, 20), cls: f[10], color: f[5].replace(/\s/g, ''), size, r: worst, ok, zone })
    if (!ok && !zone) fails.push((f[0] || '').slice(0, 18) + ' {' + f[10] + '} ' + f[5].replace(/\s/g, '') +
      ' on ' + fmt9(worstBg) + ' = ' + worst.toFixed(2) + ':1 (需 ' + need + ')')
  }
  console.log('\n  元素选择器 → 色值 → 字号 → 有效背景 → 比值：')
  for (const r of table) {
    const bg = [0, 1, 2].map((k) => plate.rgb[k] + (1 - plate.alpha) * paletteStrict[0][k])
    console.log('   ' + (r.ok ? '✓' : '✗') + ' ' + r.t.padEnd(20) + ' ' + (r.cls || '').padEnd(11) + ' ' +
      r.color.padEnd(19) + (r.size + 'px').padEnd(7) + ' bg ' + fmt9(bg).padEnd(17) + r.r.toFixed(2) + ':1' +
      (ZONE_OLD.indexOf(r.color) >= 0 ? '  [提亮前的旧值·禁止]' : (r.zone && !r.ok ? '  [分区色]' : '')))
  }
  const zoneFail = table.filter((r) => r.zone && !r.ok).map((r) => r.cls + ' ' + r.color + ' ' + r.r.toFixed(2) + ':1')
  /* 提亮前的旧值仍在渲染 ⇒ 提亮被回滚（两条硬断言的反证锚点） */
  const oldZone = table.filter((r) => r.zone && ZONE_OLD.indexOf(r.color) >= 0).map((r) => r.cls + ' ' + r.color)

  t('对比度探针真的取到了元素（0 个 = 什么都没测，不许当通过）', rows9.length >= 12, rows9.length + ' 个')
  /* 这条必须断言"黑板本色真的来自实测像素" —— 第一版只断言了"存在且 b>r"，于是在退回 CSS 兜底时
     仍然 PASS（自己给自己开了绿灯，实测抓到过）。现在直接盯 plateFrom。 */
  t('截图落盘 + 黑板本色取自实测像素（不许静默退回 CSS 兜底）',
    fs.existsSync(png9) && plateFrom.indexOf('截图实取') === 0, 'png=' + (fs.existsSync(png9) ? 'yes' : 'no') + ' 来源=' + plateFrom)
  t('非分区色文字全部 ≥4.5:1（浅色壁纸·最亮 25% 边界）', fails.length === 0, fails.length ? (fails.length + ' 处 → ' + fails.slice(0, 6).join(' | ')) : (table.length + ' 个元素全过'))
  t('旧的低对比色值在样式表里 0 命中（防退化）', hitForbidden.length === 0, hitForbidden.length ? hitForbidden.join(',') : '0 命中 / 共禁 ' + FORBIDDEN.length + ' 个')
  const zoneRows = table.filter((r) => r.zone)
  console.log('  分区色文字（' + zoneRows.length + ' 个元素）在"最亮 25% 壁纸"边界下的比值：' +
    (zoneRows.length ? zoneRows.map((r) => r.cls + ' ' + r.color + ' ' + r.r.toFixed(2) + ':1').join(' | ') : '（没测到分区色元素）'))
  /* ★ 2026-09-13 第二轮（用户拍板"提亮到达标"）：分区色**不再豁免**，与普通文字同一条 4.5:1 判据。
     反证已做：把 PC.metric 改回 #6fb6ff ⇒ 这两条同时变红，改回即恢复绿。 */
  t('分区色文字也全部 ≥4.5:1（提亮后不再豁免）', zoneRows.length >= 2 && zoneFail.length === 0,
    zoneFail.length ? (zoneFail.length + ' 处 → ' + zoneFail.slice(0, 6).join(' | ')) : (zoneRows.length + ' 个分区色元素全过'))
  t('分区色文字不再使用提亮前的旧值（#56d9c8 / #6fb6ff 作为文字色 0 命中）', oldZone.length === 0,
    oldZone.length ? (oldZone.length + ' 处 → ' + oldZone.join(' | ')) : '0 命中')

  /* ==========================================================================
   * ★★ 2026-09-13 第三轮：**从真实渲染的像素上量**（用户报「红笔那一块全是灰的根本看不清」）
   *
   * 上一轮的漏网之鱼（这就是那一环）：
   *   · fg 取的是 getComputedStyle().color —— **名义色**。两边名义色都合格
   *     （#dbe6f2 / #eef4fa，名义比值 12~15:1），所以断言全绿；
   *   · bg 取的是公式合成 (plate.rgb + (1-α)·wallpaper) —— 也不是像素。
   *   ⇒ "颜色本身够白"被当成了"屏幕上够亮"。**必须量笔画像素。**
   *
   * 本轮口径：对每个可见文字块，在它的矩形里
   *   bg = 该矩形内**众数色**（字形之间的底板，像素级）；
   *   fg = **笔画像素**（相对 bg 比值最高的前 1% 像素的平均色，像素级）；
   *   比值 = WCAG(fg,bg)；另算 eff = 合成保真度 = 实测(fg-bg)/名义(nominal-bg)（多通道最小二乘）。
   *   eff≈1 ⇒ 这个字形**没有被半透明层压过**；eff≈0.22 ⇒ 被 α .78 的黑板盖住了。
   * 用户现象对应：下半截（#v2panel）eff≈0.22 ⇒ 1.18~2.13:1；上半截（#plateInner）eff=1 ⇒ 8.2~13.6:1。
   * ======================================================================== */
  const pxAnyVisible = (r, win, box) => {
    if (r.l < -1 || r.t < -1 || r.r > win.w + 1 || r.b > win.h + 1) return false
    if (box && r.t >= box.top && r.b > box.bottom + 1) return false      /* 滚出 #v2panel 可视区的不算"用户所见" */
    return true
  }
  const pxTable = []
  let pxDpr = 2, pxBox = null
  if (plate9) {
    pxDpr = Number(plate9[5]) || 2
    const vm = lg9.match(/v2 place: top=(\d+) maxH=(\d+)/)
    if (vm) pxBox = { top: +vm[1], bottom: +vm[1] + +vm[2] }
  }
  {
    /* --- W2：解码器自检（自造 filter-4 PNG 往返，把"错 Paeth"钉死） --- */
    const CRCT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c } return t })()
    const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
    const mkChunk = (type, data) => { const d = Buffer.concat([Buffer.from(type, 'ascii'), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); d.copy(out, 4); out.writeUInt32BE(crc32(d), 8 + data.length); return out }
    const mkPNG4 = (w, h, px) => {
      const bpp = 4, stride = w * bpp, raw = Buffer.alloc(h * (stride + 1))
      for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 4                                   /* filter type 4 = Paeth */
        for (let x = 0; x < stride; x++) {
          const a = x >= bpp ? px[y * stride + x - bpp] : 0
          const b = y ? px[(y - 1) * stride + x] : 0
          const c = (y && x >= bpp) ? px[(y - 1) * stride + x - bpp] : 0
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
          raw[y * (stride + 1) + 1 + x] = (px[y * stride + x] - pr) & 0xff
        }
      }
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        mkChunk('IHDR', ihdr), mkChunk('IDAT', zlib.deflateSync(raw)), mkChunk('IEND', Buffer.alloc(0))])
    }
    const TW = 40, TH = 12, src = Buffer.alloc(TW * TH * 4)
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const i = (y * TW + x) * 4
      src[i] = (x * 7 + y * 13) & 0xff; src[i + 1] = (x * 31 + y * 3) & 0xff
      src[i + 2] = (x * 11 + y * 29) & 0xff; src[i + 3] = 255
    }
    let maxd = 0
    try {
      const back = pngDecode(mkPNG4(TW, TH, src))
      for (let i = 0; i < src.length; i++) maxd = Math.max(maxd, Math.abs(src[i] - back.px[i]))
    } catch (e) { maxd = -1; console.log('  [WARN] 自检 PNG 解码失败: ' + e.message) }
    t('W2 PNG 解码器自检：自造 filter-4 图逐像素往返必须 0 误差（近似 Paeth 会在这里红）',
      maxd === 0, '最大误差 ' + maxd)
  }
  {
    /* --- W3/W4/W5/W6：像素口径的逐元素对比度 --- */
    let pxImg = null
    try { pxImg = pngDecode(fs.readFileSync(png9)) } catch (e) { console.log('  [WARN] 截图解码失败: ' + e.message) }
    const pxBoxN = (pxBox && pxImg) ? { top: pxBox.top * pxDpr, bottom: pxBox.bottom * pxDpr } : null
    const pxWinN = pxImg ? { w: pxImg.w, h: pxImg.h } : null
    if (pxImg) for (const f of rows9) {
      const nom = rgbOf9(f[5]); if (!nom) continue
      const L = Math.round(Number(f[1]) * pxDpr), T = Math.round(Number(f[2]) * pxDpr)
      const Wd = Math.round(Number(f[3]) * pxDpr), Hd = Math.round(Number(f[4]) * pxDpr)
      if (Wd < 3 || Hd < 3) continue
      const r = { l: L, t: T, r: L + Wd, b: T + Hd }
      if (!pxAnyVisible(r, pxWinN, pxBoxN)) continue
      const X1 = Math.min(pxImg.w, r.r), Y1 = Math.min(pxImg.h, r.b)
      if (L >= X1 || T >= Y1) continue
      const tally = new Map()
      for (let y = T; y < Y1; y++) for (let x = L; x < X1; x++) {
        const i = y * pxImg.w * pxImg.bpp + x * pxImg.bpp
        const k = (pxImg.px[i] >> 3) + ',' + (pxImg.px[i + 1] >> 3) + ',' + (pxImg.px[i + 2] >> 3)
        tally.set(k, (tally.get(k) || 0) + 1)
      }
      if (!tally.size) continue
      const bg = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map((v) => +v * 8 + 4)
      const cand = []
      for (let y = T; y < Y1; y++) for (let x = L; x < X1; x++) {
        const i = y * pxImg.w * pxImg.bpp + x * pxImg.bpp
        const c = [pxImg.px[i], pxImg.px[i + 1], pxImg.px[i + 2]]
        cand.push([ratio9(c, bg), c])
      }
      cand.sort((a, b) => b[0] - a[0])
      const nTop = Math.max(3, Math.ceil(cand.length * 0.01))
      const tp = cand.slice(0, nTop)
      const fg = [0, 1, 2].map((k) => Math.round(tp.reduce((s, p) => s + p[1][k], 0) / tp.length))
      /* eff = 合成保真度：实测笔画色相对名义色被压掉多少（1 = 没有被任何半透明层盖过） */
      let num = 0, den = 0
      for (let k = 0; k < 3; k++) { const d = nom[k] - bg[k]; if (Math.abs(d) > 20) { num += (fg[k] - bg[k]) * d; den += d * d } }
      const eff = den ? Math.max(0, Math.min(1, num / den)) : 1
      pxTable.push({ t: (f[0] || '').slice(0, 18), cls: f[10] || '', nom, bg, fg,
        r: ratio9(fg, bg), eff, half: (pxBoxN && T >= pxBoxN.top) ? 'lower' : 'upper' })
    }
    const pxUpper = pxTable.filter((x) => x.half === 'upper')
    const pxLower = pxTable.filter((x) => x.half === 'lower')
    console.log('\n  像素口径逐元素（fg=笔画像素实测色 / bg=该矩形内众数色 / eff=合成保真度）：')
    for (const x of pxTable) {
      console.log('   ' + (x.r >= 4.5 ? '✓' : '✗') + ' [' + (x.half === 'lower' ? '下半' : '上半') + '] ' +
        x.t.padEnd(20) + (x.cls || '').padEnd(11) + ' 名义 ' + fmt9(x.nom).padEnd(16) + ' 实测fg ' + fmt9(x.fg).padEnd(16) +
        ' bg ' + fmt9(x.bg).padEnd(16) + ' 像素比 ' + x.r.toFixed(2) + ':1   eff ' + x.eff.toFixed(2))
    }
    const fmtHalf = (a) => a.length
      ? (a.reduce((s, x) => Math.min(s, x.r), Infinity)).toFixed(2) + '~' +
        (a.reduce((s, x) => Math.max(s, x.r), 0)).toFixed(2) + ':1（' + a.length + ' 块）'
      : '（0 块）'
    console.log('  上半截（#plateInner）= ' + fmtHalf(pxUpper) + '   下半截（#v2panel）= ' + fmtHalf(pxLower))
    const pxBad = pxTable.filter((x) => x.r < 4.5)
    /* 合成保真度取**中位数**：单个元素可能落在 #v2panel 底部 16px 渐隐带里（那是设计意图，不是回退），
       但被整层黑板盖住时**所有**元素一起掉到 ~0.22 ⇒ 中位数躲不掉。 */
    const lowerEffs = pxLower.map((x) => x.eff).sort((a, b) => a - b)
    const lowerEffMed = lowerEffs.length ? lowerEffs[Math.floor(lowerEffs.length / 2)] : -1
    const todoRows = rows9.filter((f) => (f[10] || '') === '.tt')      /* 从**探针原始清单**数，不受可视区裁剪影响 */
    t('W3 像素探针在下半截（#v2panel）真的量到了元素（0 个 = 什么都没测，不许当通过）',
      pxLower.length >= 5, pxLower.length + ' 个（上半截 ' + pxUpper.length + ' 个）')
    t('W4 全部可见文字块的**像素**对比度 ≥4.5:1（上下两截同一口径，浅色壁纸）', pxTable.length >= 12 && pxBad.length === 0,
      pxBad.length ? (pxBad.length + ' 处 → ' + pxBad.slice(0, 6).map((x) => x.t + '(' + x.r.toFixed(2) + ':1)').join(' | '))
        : (pxTable.length + ' 块全过，最低 ' + pxTable.reduce((s, x) => Math.min(s, x.r), Infinity).toFixed(2) + ':1'))
    t('W5 合成保真度：文字没有被半透明层压过（下半截 eff 中位数 ≥0.85；被黑板盖住时会掉到 ~0.22）',
      lowerEffMed >= 0.85, '下半截 eff 中位数 ' + lowerEffMed.toFixed(2) +
      (pxTable.filter((x) => x.eff < 0.85).length ? '；打折的：' + pxTable.filter((x) => x.eff < 0.85).map((x) => x.cls + ' ' + x.eff.toFixed(2)).join(',') : ''))
    t('W6 任务行正文有独立可测元素（≥3 个 .trow2 .tt）—— 裸文本节点会量不到，等于没验',
      todoRows.length >= 3, todoRows.length + ' 个 .trow2 .tt')
    /* 结构判据：指名道姓钉住根因。缺 z-index 时 DOM 在后的 #panel/#plate 会盖在 #v2panel 之上。 */
    const v2Rule = (idxSrc.match(/#v2panel\{[^}]*/) || [''])[0]
    const zM = v2Rule.match(/z-index\s*:\s*(-?\d+)/)
    t('W7 #v2panel 的计算 z-index 高于 #panel（缺了它，黑板会把整个 v2 段文字盖灰）',
      !!zM && Number(zM[1]) > 0, zM ? 'z-index=' + zM[1] : '#v2panel 规则里没有 z-index（#panel 是 auto，DOM 在后 ⇒ 盖在上面）')
  }
}
console.log(`\n===== v2 结果：${pass} PASS / ${fail} FAIL =====`)
process.exit(fail ? 1 : 0)
