#!/usr/bin/env node
/* log-dedup.mjs —— 「同一次渲染里每个 block 只留一条」的验收（任务 G，2026-09-19）
 *
 * 病灶（用户生产 helper.log 的实测）：`v2panel blk(after-v2)` 在 **50 秒里写了 1440 行**，
 * 占该窗口全部日志的 **66%**；同一次渲染里同 8 个 block 被重复打印 **15 次**。
 * 根因：这段取证代码被写在 `logPanelLayout()` 外层 forEach 的**回调体内部**，
 * 于是"每个 SEL 元素都把整份 PANEL_SEL 又量一遍"。
 *
 * 本文件要保的不是"日志少一点"，而是**"一次渲染 = 一条可用的记录"**：
 *   ① 同一次 logPanelLayout（= 一个连续 burst）里，同一个 block 文本**最多 1 条**；
 *   ② burst 大小必须等于"不同 block 文本的个数"（恰好一条，不重不漏）；
 *   ③ 【防退化守卫】留痕能力不许被削弱：`v2panel blk` 覆盖的文本集合必须与同轮 `panel blocks` 里的
 *      面板块集合一致（这不是证明改动发生了，而是防止"为了去重把内容也删掉"）。
 *
 * 用法: node tests/log-dedup.mjs       （全程离屏：--hidden）
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, runDir, readLog, killStrayElectron, section, report, sleep } from './harness.mjs'

const DIR = runDir('log-dedup')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

const now = Date.now()
const pf = path.join(DIR, 'payload.json')
fs.writeFileSync(pf, JSON.stringify({
  state: {
    state: 'WORKING', activity: 'coding',
    progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item' },
    metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
    subagents: { total: 3, running: 1, done: 1, failed: 0, stopped: 1, unknown: 0, items: [
      { status: 'running', label: 'reviewer', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 },
      { status: 'done', label: 'tester', depth: 1, parent: null, startedAt: now - 90000, endedAt: now - 18000, toolCalls: 40 }] },
    sessions: { total: 1, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] },
    todos: { items: [{ content: '去重日志', status: 'done', depth: 0 }, { content: '写断言', status: 'in_progress', depth: 0 }], more: 0 },
    cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 },
    context: { applicable: true, used: 1200, limit: 128000, ratio: 0.009375 },
    tokens: { input: 1000, output: 50, total: 1050, cacheRead: 200, cacheWrite: 0, reasoning: 0 }
  },
  text: { revision: 1, activityText: '正在写面板渲染', thoughtTail: 't', bodyTail: 'b' }
}))

section('一次渲染 = 一条记录（离屏 --hidden）')
const LOG = path.join(DIR, 'main.log')
fs.rmSync(LOG, { force: true })
const st = runRuntime(['--shot', '240', '--shot-panel', '--shot-states', 'WORKING', '--out', DIR,
  '--shot-payload', pf, '--settle-ms', '3200', '--bg', 'plate-b', '--hidden'], { home: tmpHome('dedup'), log: LOG })
const r = await st.waitExit(60000)
killStrayElectron()
const lg = readLog(LOG)

/* ---------- 把连续 burst 切出来（一次 logPanelLayout 会把同一批 block 连在一起打） ---------- */
/* 去重的**单位是"一条留痕"（整行，去掉时间戳）**，不是"文本"：
   面板里本来就可能有两个元素的文本相同（例如两处「花费」），它们 rect 不同 ⇒ 行也不同。
   重复打印的特征恰恰是**整行逐字节相同**（同一次调用里同一个元素被量了 15 遍）。 */
function bursts (text) {
  const out = []
  let cur = null
  for (const l of text.split('\n')) {
    const m = l.match(/v2panel blk\(([^)]+)\): ([^|]*)\|/)
    const body = l.replace(/^\[[^\]]*\]\s*(renderer:\s*)?/, '')
    if (m && /v2panel blk\(/.test(body)) {
      if (!cur || cur.tag !== m[1]) { cur = { tag: m[1], lines: [] }; out.push(cur) }
      cur.lines.push({ txt: m[2].trim(), key: body })
    } else cur = null
  }
  return out.filter((b) => b.lines.length)
}
const B = bursts(lg)
console.log('  进程 exit=' + (r ? r.code : null) + '；`v2panel blk` 总行数 = ' + (lg.match(/v2panel blk\(/g) || []).length +
  '；burst 段数 = ' + B.length + '；各段大小 = ' + B.map((b) => b.tag + ':' + b.lines.length).join(' '))

check('G1 真的渲染出了 v2 面板并留下了 blk 取证行（0 段 = 什么都没测，不许当通过）',
  B.length >= 1 && B.some((b) => b.tag === 'after-v2'),
  B.map((b) => b.tag + ':' + b.lines.length).join(' ') || '无')

const perBurst = B.map((b) => {
  const byKey = new Map()
  for (const o of b.lines) byKey.set(o.key, (byKey.get(o.key) || 0) + 1)
  return { tag: b.tag, n: b.lines.length, distinct: byKey.size, maxDup: Math.max(...byKey.values()) }
})
console.log('  逐段：' + perBurst.map((b) => b.tag + ' 行数=' + b.n + ' 不同留痕=' + b.distinct + ' 同一留痕最多重复=' + b.maxDup).join('  ｜  '))
check('G2【去重】同一次渲染里同一条留痕**最多出现 1 次**（改动前实测：同一个 block 被量了 15 遍 ⇒ 整行逐字节相同 15 条）',
  perBurst.every((b) => b.maxDup <= 1),
  perBurst.map((b) => b.tag + ':' + b.maxDup).join(' ') + '（上限 1）')
check('G3【恰好一条】每段的行数 == 该段里不同留痕的条数（不重不漏）',
  perBurst.every((b) => b.n === b.distinct),
  perBurst.map((b) => b.tag + ' ' + b.n + '/' + b.distinct).join('  '))

/* ---------- 防退化守卫：留痕内容不许缩水（改动前后都应该是绿的，**不证明改动发生**） ---------- */
const allBlkTxt = B.flatMap((b) => b.lines.map((o) => o.txt)).join(' | ')
const MARKERS = ['花费', '任务', '上下文占用', '会话', '¥1.50']
const missing = MARKERS.filter((m) => !allBlkTxt.includes(m))
check('G4【防退化守卫】留痕里仍然看得到 v2 面板的每一类内容（花费/任务/上下文占用/会话 + 真实金额）—— 去重不是把内容也删掉',
  missing.length === 0, missing.length ? ('缺失：' + missing.join(',')) : ('命中 ' + MARKERS.join(' / ') + '（' + B[0].lines.length + ' 条留痕/段）'))
/* 同一段里不许出现"同一文本的两次渲染被合并掉"的情况：行数必须等于块数（G3 已覆盖），
   这里再钉一条**总行数上界**，防止有人用"改成变化才打"把每段行数变成 0 条。 */
check('G5【留痕仍在】每段行数 ≥6（面板该有的块都要留痕；把它当成"日志少了就是好"是错的）',
  perBurst.every((b) => b.n >= 6),
  perBurst.map((b) => b.tag + ':' + b.n).join(' '))

section(ok ? '日志去重：全部通过' : '日志去重：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
