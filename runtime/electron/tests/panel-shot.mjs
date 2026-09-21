#!/usr/bin/env node
/* panel-shot.mjs —— 面板展开态 / 悬浮层 离屏截图（有真实数据）
 *
 * ★ 为什么单独留这个文件：这条调用形状我丢了四次（凭记忆拼参数），它才是"能跑通的证据"。
 *   ⚠️ 三条极易踩错的点（照抄，别改）：
 *     1) 用 `--shot-states`（**不是** `--state`）——`--state` 只设图标状态，不会触发抓图；
 *     2) `--out` 给**目录**（给 .png 时单张路径在我这版没落盘）；
 *     3) **进程自己退出**（`waitExit`）——它在 `--settle-ms` 之后抓图再退出，**提前 kill 就永远拿不到图**。
 *   参考：`tests/shots.mjs`（七态黄金样本）用的是同一形状，它是本文件的出身。
 *
 * ★ 数据怎么进去：v2 载荷走 **stdio**（`st.send({kind:'state'|'text', ...})`），
 *   窗口 → ready 之后立刻喂；此时面板里的样板区与 v2 段**同源**，两边显示必然一致。
 *
 * 用法: node tests/panel-shot.mjs          （全部离屏，不弹窗口）
 * 产物: test/out/<runId>/panel-shot/{panel,hover}-*.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, runDir, sleep, waitFor, readLog, killStrayElectron, section } from './harness.mjs'

const DIR = runDir('panel-shot')
const D_PANEL = runDir('panel-shot', 'panel')   /* 分开目录：两张图同名会互相覆盖（踩过） */
const D_HOVER = runDir('panel-shot', 'hover')

/* 一份"有数据"的真实载荷（字段全部来自宿主协议 v2，不造任何假数字） */
function payload (now) {
  return { protocolVersion: 2, kind: 'state', state: 'WORKING', activity: 'coding',
    progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item',
      planChange: { from: 6, to: 11, at: now } },
    metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
    subagents: { total: 5, running: 2, done: 2, failed: 0, stopped: 1, unknown: 0, items: [
      { status: 'running', label: 'reviewer', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 },
      { status: 'done', label: 'tester', depth: 1, parent: null, startedAt: now - 90000, endedAt: now - 18000, toolCalls: 40 },
      { status: 'running', label: '检索参考图', depth: 2, parent: 'reviewer', startedAt: now - 12000, toolCalls: 6 }] },
    sessions: { total: 3, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] },
    todos: { items: [{ content: '样板区换真实数据', status: 'done', depth: 0 },
      { content: '清掉所有假数字', status: 'done', depth: 1 },
      { content: '跑 v2 四字段验收', status: 'in_progress', depth: 1 },
      { content: '产面板截图对照', status: 'pending', depth: 2 }], more: 0 },
    cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 },
    context: { applicable: true, used: 1200, limit: 128000, ratio: 0.009375 },
    tokens: { input: 1000, output: 50, total: 1050, cacheRead: 200, cacheWrite: 0, reasoning: 0 } }
}

/* ① 面板展开态 */
section('面板展开态（--shot-panel）')
{
  const payloadFile = path.join(DIR, 'payload.json')
  fs.writeFileSync(payloadFile, JSON.stringify({ state: payload(Date.now()).valueOf ? Object.assign({}, payload(Date.now()), { kind: undefined, protocolVersion: undefined }) : {}, text: { revision: 1, activityText: '正在写面板渲染', thoughtTail: '样板区不能再放假数字了', bodyTail: '好的' } }))
  const log = path.join(DIR, 'panel.log')
  const st = runRuntime(['--shot', '240', '--shot-panel', '--bg', 'dark', '--shot-states', 'WORKING',
    '--out', D_PANEL, '--shot-payload', payloadFile, '--settle-ms', '3000', '--hidden'], { home: tmpHome('panel'), log })
  await waitFor(() => readLog(log).includes('ready'), { timeout: 12000 }).catch(() => {})
  const r = await st.waitExit(60000)
  const lg = readLog(log)
  /* ---- ASSERT：有数据时"四个区 + 样板区真实值"都必须画得出来 ---- */
  const secs = ['todos', 'cost', 'ctx', 'text'].filter((k) => new RegExp('v2 sec ' + k + ' ::').test(lg))
  const plate = (lg.match(/plate real: [^\n]*/) || [''])[0]
  const bad = []
  if (!/panel OPEN/.test(lg)) bad.push('面板没打开')
  if (secs.length !== 4) bad.push('四段没画全（只有 ' + secs.join(',') + '）')
  if (!/plate real:/.test(lg)) bad.push('样板区没有真实值留痕（可能是"等待宿主数据"）')
  const lastKind = (lg.match(/plate (nodata|real):/g) || []).pop() || ''
  if (lastKind !== 'plate real:') bad.push('最后一次渲染不是"有数据"分支（' + lastKind + '）')
  if (plate && !/cost=¥1\.50/.test(plate)) bad.push('花费不是真实值：' + plate)
  if (plate && !/ctx=0\.9%/.test(plate)) bad.push('上下文占用不是真实值：' + plate)
  console.log('  exit=' + (r ? st.code : 'timeout') + '  panel OPEN=' + /panel OPEN/.test(lg) + '  四段留痕=' + secs.length + ' 条')
  console.log('  样板区真实值：' + plate)
  const lay = (lg.match(/panel layout\(after-v2\)[^\n]*/g) || []).pop() || ''
  const texts = lg.match(/panel text\(after-v2\)[^\n]*/g) || []
  const maxCnt = (s) => texts.reduce((m, l) => Math.max(m, l.split(s).length - 1), 0)
  if (!/overlaps=0/.test(lay)) bad.push('文本块有重叠：' + lay.slice(0, 120))
  if (!/outside=0/.test(lay)) bad.push('文本块有出界：' + lay.slice(0, 120))
  if (maxCnt('reviewer') !== 1) bad.push('子代理名 reviewer 出现 ' + maxCnt('reviewer') + ' 次（应 1）')
  if (maxCnt('检索参考图') > 1) bad.push('子代理名 检索参考图 出现 ' + maxCnt('检索参考图') + ' 次（应 ≤1）')
  if (!/工作图标 · 实时/.test(texts.join(''))) bad.push('页眉缺「· 实时」')
  if (bad.length) { console.log('  [FAIL] ' + bad.join(' / ')); process.exitCode = 1 } else console.log('  [PASS] 有数据时四个区 + 样板区真实值都画得出来')
}
killStrayElectron()
await sleep(300)

/* ② 悬浮层（轻量层，含进度/子代理摘要） */
section('悬浮层（--test-hover on）')
{
  const hoverPayload = path.join(D_HOVER, 'payload.json')
  fs.writeFileSync(hoverPayload, JSON.stringify({ state: (function () { const p = payload(Date.now()); delete p.kind; delete p.protocolVersion; delete p.todos; delete p.cost; delete p.context; return p })(), text: { revision: 1, thoughtTail: '悬浮层也要有文字' } }))
  const log = path.join(DIR, 'hover.log')
  const st = runRuntime(['--shot', '240', '--test-hover', 'on', '--bg', 'dark', '--shot-states', 'WORKING',
    '--out', D_HOVER, '--shot-payload', hoverPayload, '--settle-ms', '5000', '--hidden'], { home: tmpHome('hover'), log })
  await waitFor(() => readLog(log).includes('ready'), { timeout: 12000 }).catch(() => {})
  const r = await st.waitExit(60000)
  console.log('  exit=' + (r ? st.code : 'timeout'))
}
killStrayElectron()
await sleep(300)

/* 完成态（用户要的那张）：计划做完 ⇒ 环走满 */
section('完成态（--shot-states SUCCESS，progress 6/6）')
{
  const D_DONE = runDir('panel-shot', 'done')
  const pf = path.join(D_DONE, 'payload.json')
  const pl = payload(Date.now())
  pl.progress = { applicable: true, done: 6, total: 6, unit: 'leaf', inProgress: 0, mode: 'item' }
  pl.state = 'SUCCESS'
  pl.sessions = { total: 1, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 1 }] }
  fs.writeFileSync(pf, JSON.stringify({ state: (function () { const q = Object.assign({}, pl); delete q.kind; delete q.protocolVersion; return q })() }))
  const log = path.join(DIR, 'done.log')
  const st = runRuntime(['--shot', '240', '--bg', 'dark', '--shot-states', 'SUCCESS',
    '--out', D_DONE, '--shot-payload', pf, '--settle-ms', '3600', '--hidden'], { home: tmpHome('done'), log })
  const r = await st.waitExit(60000)
  const lg = readLog(log)
  const ring = (lg.match(/ring: [^\n]*/g) || []).pop() || ''
  console.log('  exit=' + (r ? st.code : 'timeout') + '  ' + ring.slice(0, 110))
  console.log(/p=100\.0%/.test(ring) ? '  [PASS] 完成态环走满（100.0%）' : '  [FAIL] 完成态环不是 100%')
  if (!/p=100\.0%/.test(ring)) process.exitCode = 1
}
killStrayElectron()
await sleep(300)

section('产物')
for (const n of fs.readdirSync(DIR).filter((x) => x.endsWith('.png')).sort()) {
  const b = fs.readFileSync(path.join(DIR, n))
  console.log('  ' + n + '  ' + b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) + '  ' + fs.statSync(path.join(DIR, n)).size + 'B')
}
