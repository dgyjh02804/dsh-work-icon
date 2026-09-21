#!/usr/bin/env node
/* v2-fields.mjs —— 四字段（todos / cost / context / text）实测
 * 覆盖（用户给的验收清单，一条不缺）：
 *   ① todos 是**信封** {items,more}（不当裸数组）；空列表 ≠ 没有数据
 *   ② cost：status='ok' 显示金额；**拿不到账本 ⇒ "账单不可用"，不是 ¥0.00**；unpriced 提示
 *   ③ context：applicable!==true ⇒ **不画**；ratio 直接用（**不再乘**）；used 不含 output
 *   ④ text：走 kind='text'，**revision 单调递增**驱动更新（不自己造时间戳）
 *   ⑤ 能力声明：**先实现再声明**（四项已在 DECLARED_CAPABILITIES 里，且都能渲染出来）
 *   ⑥ 统一纪律：applicable!==true ⇒ 不画；"没有数据"与"数值确实是 0"必须区分
 * 隔离：本次临时 home（harness 的 runId 目录）；离屏 --hidden；零真实输入。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, runDir, sleep, waitFor, section, report, killStrayElectron, readLog } from './harness.mjs'

const DIR = runDir('v2-fields')
let pass = 0, fail = 0
const t = (name, ok, detail) => { report(name, ok, detail); ok ? pass++ : fail++ }
/* 四段的留痕拼起来看（每段渲染完自己留一条） */
const panelOf = (lg) => [...lg.matchAll(/v2 sec (?:todos|cost|ctx|text) :: ([^\n]*)/g)].map((m) => m[1]).join(' || ')

section('① ready 声明能力：四样已声明（先实现后声明）')
const log = path.join(DIR, 'main.log')
/* ⚠️ 2026-09-19：本文件全程用 `readLog(log)` **通读整份日志**并按出现次数断言
   （例如"相同 revision 不重画"数 `/v2 text revision=1/` 的条数），所以这个文件**必须从零开始**。
   它原来没有清日志 ⇒ 一旦产物目录被复用（runId 撞车），旧的一轮日志会被一起数进去 = 假失败
   （实测：test/out/rm84/v2-fields/main.log 里同时有 09-12 与 09-19 两天的行）。
   runId 已改成带时间后缀（harness.mjs），这里再补一道本地保险。 */
fs.rmSync(log, { force: true })
const scriptPath = path.join(DIR, 'script.json')
fs.writeFileSync(scriptPath, JSON.stringify([{ at: 900, hover: true }, { at: 1300, mouse: '160|d,100,100;u,100,100|d,100,100;u,100,100' }]))
const st = runRuntime(['--hidden', '--state', 'WORKING', '--test-script', scriptPath], { home: tmpHome('v2f'), log })
await waitFor(() => readLog(log).includes('ready'), { timeout: 12000 }).catch(() => {})
let lg = readLog(log)
t('ready capabilities 含 todos/cost/context/text', /ready capabilities=\[[^\]]*"todos"[^\]]*"cost"[^\]]*"context"[^\]]*"text"/.test(lg),
  ((lg.match(/ready capabilities=[^\n]*/) || [''])[0]).slice(0, 130))

/* 面板由 --test-script 的双击打开（panel 不是宿主 kind） */
await waitFor(() => readLog(log).includes('panel OPEN'), { timeout: 12000 }).catch(() => {})
await sleep(400)

section('② todos：信封 {items,more}（不当裸数组）')
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', todos: { items: [
  { content: '写代码', status: 'in_progress', depth: 1 }, { content: '跑测试', status: 'pending', depth: 1 },
  { content: '子任务A', status: 'done', depth: 2 }], more: 3 } })
await sleep(500)
lg = readLog(log); let p = panelOf(lg)
t('items 渲染出来（含 depth 缩进与状态标记）', /写代码/.test(p) && /跑测试/.test(p), p.slice(0, 120))
t('more=3 折成 +N（不丢信息）', /还有 3 项/.test(p) && /任务 · 3\+3/.test(p), (p.match(/TASKS · [^|]*/) || [''])[0])

section('③ todos 空列表 ≠ 没有数据')
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', todos: { items: [], more: 0 } })
await sleep(400)
lg = readLog(log); p = panelOf(lg)
t('空列表显示"任务列表为空"（区分于"没有数据"）', /任务列表为空/.test(p) && /任务列表为空/, p.slice(0, 120))

section('④ cost：ok 显示金额 / 拿不到账本 ⇒ 账单不可用（不是 ¥0.00）')
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 } })
await sleep(400); lg = readLog(log); p = panelOf(lg)
t('cost ok ⇒ ¥1.50', /¥1\.50/.test(p), p.slice(0, 140))
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', cost: { status: 'unavailable' } })
await sleep(400); lg = readLog(log); p = panelOf(lg)
t('账本拿不到 ⇒ "账单不可用"，**不是 ¥0.00**', /账单不可用/.test(p) && !/¥0\.00/.test(p), p.slice(0, 140))
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', cost: { status: 'ok', cost: {}, priced: 0, unpriced: 2 } })
await sleep(400); lg = readLog(log); p = panelOf(lg)
t('status=ok 但没有金额 ⇒ 仍"账单不可用"（不显示 ¥0.00）', /账单不可用/.test(p) && !/¥0\.00/.test(p), p.slice(0, 140))

section('⑤ context：applicable!==true 不画；ratio 直接用（不再乘）')
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', context: { applicable: true, used: 1200, limit: 128000, ratio: 0.009375 } })
await sleep(400); lg = readLog(log); p = panelOf(lg)
t('applicable=true ⇒ 画环，百分比 = ratio×100 = 0.9%（**不是 0.9%×0.9%**）', /0\.9%/.test(p), p.slice(0, 160))
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', context: { applicable: false, used: 0, limit: 0, ratio: 0 } })
await sleep(400); lg = readLog(log); p = panelOf(lg)
/* 语义不变：applicable=false ⇒ 标题在、正文明确为不适用、不出任何百分比。
   文案去重后正文不再重复标题，证据改成两段分别匹配。 */
/* applicable=false 的 na 有两种合法形态：不适用（applicable!==true）与 ——（ratio 缺失）；两者都不许出现百分比。 */
/* ctx 证据必须取自 ctx 段自己那行（p 是四段拼接，取到的是别的子用例的 dump ✗）。
   na 的两种合法形态：不适用 / ——；两者都不许出现百分比。 */
t('applicable=false ⇒ 不画环（ctx=na，且无百分比）',
  /不适用|——/.test(((readLog(log).match(/v2 sec ctx :: [^\n]*/g) || []).pop()) || '') &&
  !/[0-9.]+%/.test(((readLog(log).match(/v2 sec ctx :: [^\n]*/g) || []).pop()) || ''),
  ((readLog(log).match(/v2 sec ctx :: [^\n]*/g) || []).pop()) || '')
/* 标题不进 payload（只在 DOM 里）⇒ 单独从面板文本断言，别把它塞进上一条的证据里 */
t('applicable=false ⇒ 上下文占用标题仍在（面板文本里）', /上下文占用/.test(((readLog(log).match(/panel text\(after-v2\)[^\n]*/g) || []).pop()) || ''), '')

section('⑥ text：走 kind + revision 驱动（不自己造时间戳）')
/* ⚠️ 2026-09-20 修：这三条原来发的是**嵌套**形状 `text:{...}`。
   那是**窗口旧判据自己臆想的形状**，宿主从来只发**扁平**（src/protocol.js `createMessage` 把 payload
   平铺到顶层，`validatePayload` 也按顶层 `message.revision` 校验）。
   ⇒ 两侧各自绿、合起来是空的：宿主测试校验扁平 ✓、本文件自己造了嵌套 ✓，**没有任何一条在测真配对**。
   后果（用户真实日志 helper.log.1 实测）：连续流式期 **6.17 条/秒**（= 宿主 TEXT_THROTTLE_MS=160 的节拍，
   p50 间隔 162ms）全是 `WARN text 载荷非对象，忽略`，面板「思考文本」永远拿不到内容。
   现在起，本文件一律发**宿主真实形状**（扁平），并在 ⑦ 里加刷屏与降级的断言。 */
st.send({ protocolVersion: 2, kind: 'text', revision: 1, activityText: '读文件', thoughtTail: '正在想这件事', bodyTail: '好的' })
await sleep(400); lg = readLog(log); p = panelOf(lg)
t('宿主扁平形状的 kind=text 被消费并渲染（revision=1）', /正在想这件事/.test(p), p.slice(0, 160))
t('日志记录了 revision（可证明是它驱动的）', /text -> renderer revision=1/.test(lg), '')
st.send({ protocolVersion: 2, kind: 'text', revision: 1, activityText: '读文件', thoughtTail: '正在想这件事', bodyTail: '好的' })
await sleep(300)
t('**相同 revision 不重画**（驱动源是 revision，不是时间）', [...readLog(log).matchAll(/v2 text revision=1/g)].length === 1,
  '出现 ' + [...readLog(log).matchAll(/v2 text revision=1/g)].length + ' 次')
st.send({ protocolVersion: 2, kind: 'text', revision: 2, activityText: '写代码', thoughtTail: '换个思路', bodyTail: '好的' })
await sleep(400); lg = readLog(log); p = panelOf(lg)
t('revision 递增 ⇒ 更新', /换个思路/.test(p), p.slice(0, 160))

section('⑥b text 通道的"不刷屏 / 该有内容有内容 / 该降级有降级"三条（bug 回归）')
{
  /* ① 不刷屏：连发 30 条宿主形状的真实节拍载荷（revision 递增），
        每一条都必须是**被消费**的，而不是被判"载荷非对象"丢掉。
        改前实测：这 30 条会产出 30 条 `WARN text 载荷非对象，忽略`。 */
  const beforeWarn = [...readLog(log).matchAll(/WARN text 载荷非对象，忽略/g)].length
  const beforeMark = [...readLog(log).matchAll(/v2 text revision=/g)].length
  for (let i = 0; i < 30; i++) {
    st.send({ protocolVersion: 2, kind: 'text', revision: 100 + i, activityText: '刷屏臂 ' + i, thoughtTail: '刷屏臂思考 ' + i })
    await sleep(12)
  }
  await sleep(600)
  const lgF = readLog(log)
  const afterWarn = [...lgF.matchAll(/WARN text 载荷非对象，忽略/g)].length
  const afterMark = [...lgF.matchAll(/v2 text revision=/g)].length
  t('连发 30 条 ⇒ **一条"载荷非对象"都没有**（不刷屏）', afterWarn - beforeWarn === 0,
    '新增 ' + (afterWarn - beforeWarn) + ' 条（改前实测 30 条）')
  t('30 条全部被消费（revision=X 留痕条数 = 30）', afterMark - beforeMark === 30, '新增留痕 ' + (afterMark - beforeMark) + ' 条')
  const pf2 = panelOf(lgF)
  t('该有内容时有内容：最后一条的内容真的画进了面板', /刷屏臂思考 29/.test(pf2), pf2.slice(0, 160))

  /* ② 合法空载荷（宿主"本轮没有可发文本"只发 revision）⇒ **"等待数据"**，不是静默、不是告警 */
  const beforeEmpty = [...readLog(log).matchAll(/WARN text /g)].length
  st.send({ protocolVersion: 2, kind: 'text', revision: 200 })
  await sleep(400)
  const lgE = readLog(log); const pe = panelOf(lgE)
  t('合法空载荷 ⇒ 面板明确写"等待数据"（区分于故障）', /等待数据/.test(pe), pe.slice(0, 160))
  t('合法空载荷 ⇒ **不告警**（空不是错，不许把"没内容"当故障）',
    [...readLog(log).matchAll(/WARN text /g)].length - beforeEmpty === 0,
    '新增 ' + ([...readLog(log).matchAll(/WARN text /g)].length - beforeEmpty) + ' 条')

  /* ③ 字段类型非法 ⇒ **"思考文本不可用（原因）"** + 一条**限流**痕迹（绝不静默丢） */
  const beforeDeg = [...readLog(log).matchAll(/WARN text /g)].length
  st.send({ protocolVersion: 2, kind: 'text', revision: 300, thoughtTail: 42 })
  await sleep(400)
  const lgD = readLog(log); const pd = panelOf(lgD)
  t('非法字段类型 ⇒ 面板写"思考文本不可用（原因）"', /思考文本不可用/.test(pd) && /thoughtTail/.test(pd), pd.slice(0, 180))
  t('非法字段类型 ⇒ 留一条**限流**痕迹（不是刷屏，但也不静默）',
    [...readLog(log).matchAll(/WARN text /g)].length - beforeDeg === 1,
    '新增 ' + ([...readLog(log).matchAll(/WARN text /g)].length - beforeDeg) + ' 条')
  /* 限流本身要能被证明：紧接着再发 5 条非法载荷，只应被"抑制"（不新增告警） */
  const beforeSup = [...readLog(log).matchAll(/WARN text /g)].length
  for (let i = 0; i < 5; i++) { st.send({ protocolVersion: 2, kind: 'text', revision: 400 + i, bodyTail: {} }); await sleep(80) }
  await sleep(400)
  t('5s 窗口内同类再发 5 条 ⇒ 告警被限流（新增 ≤1 条，不是 5 条）',
    [...readLog(log).matchAll(/WARN text /g)].length - beforeSup <= 1,
    '新增 ' + ([...readLog(log).matchAll(/WARN text /g)].length - beforeSup) + ' 条')
  /* 自愈：下一条合法载荷必须把降级态清掉（否则一次坏消息会永久污染面板）
     ⚠️ 这里**只能看最后一条** `v2 sec text ::` —— panelOf() 是**全日志拼接**，
     里面必然还留着前面 ③ 那句"思考文本不可用"，用拼接串做否定断言会假红
     （实测踩过一次：产品行为是对的 12:25:52.832 `文本 · 第 500 次更新恢复了正常思考`，
     红的是断言自己）。 */
  st.send({ protocolVersion: 2, kind: 'text', revision: 500, activityText: '恢复了', thoughtTail: '正常思考' })
  await sleep(400)
  const lastText = (readLog(log).match(/v2 sec text :: [^\n]*/g) || []).pop() || ''
  t('降级态可自愈：下一条合法载荷 ⇒ 面板恢复正常内容（不再写"不可用"）',
    /正常思考/.test(lastText) && !/思考文本不可用/.test(lastText), lastText.slice(0, 180))
}

section('⑧ 有数据时：样板区也用真实值画出来（不是"等待宿主数据"）')
{
  const lgx = readLog(log)
  const plate = (lgx.match(/plate real: [^\n]*/) || [''])[0]
  t('样板区走了"有数据"分支（不是 nodata）', /plate real:/.test(lgx), plate)
  t('样板区花费曾用真实值 ¥1.50（不是示例 0.428）', /cost=¥1\.50/.test(lgx), (lgx.match(/plate real: [^\n]*cost=¥1\.50[^\n]*/) || [''])[0].slice(0, 90))
  t('样板区上下文占用曾取真实 ratio（0.9%）', /ctx=0\.9%/.test(lgx), (lgx.match(/plate real: [^\n]*ctx=0\.9%[^\n]*/) || [''])[0].slice(0, 90))
  /* 决策变更（用户定：一个面板一个渲染器）：样板**刻意退掉**任务/思考等与 v2 重复的区块 ⇒
    现断言"样板不再画它们"（旧断言"样板画任务"已过期） */
const plateTxt = (readLog(log).match(/plate text\[[^\]]*\]/g) || []).pop() || ''
  t('样板自身文本不含重复区块（花费/任务/上下文占用）', !/花费/.test(plateTxt) && !/任务/.test(plateTxt) && !/上下文占用/.test(plateTxt), plateTxt.slice(0, 150))
}

section('⑨ 一个面板一个渲染器：关键值在同一次渲染里**只出现一次**（防两层叠画）')
{
  const lines = readLog(log).match(/panel text\(after-v2\)[^\n]*/g) || []
  const cntIn = (line, s) => (line.split(s).length - 1)
  const maxCnt = (s) => lines.reduce((m, l) => Math.max(m, cntIn(l, s)), 0)
  const lineWith = (s) => (lines.find((l) => l.includes(s)) || '').slice(0, 150)
  t('面板整层文本留痕存在（≥1 次渲染）', lines.length >= 1, lines.length + ' 次渲染留痕')
  t('"¥1.50" 任一次渲染里只出现一次', maxCnt('¥1.50') === 1, lineWith('¥1.50'))
  t('上下文占比 0.9% 任一次渲染里只出现一次', maxCnt('0.9%') === 1, lineWith('0.9%'))
  t('上下文占用（带值）任一次渲染里只出现一次', maxCnt('上下文占用 · ') === 1, lineWith('上下文占用 · '))
  t('任务文本"写代码"任一次渲染里只出现一次', maxCnt('写代码') === 1, lineWith('写代码'))
}

section('⑩ 几何自检：零出界 + 零重叠（机器判定，不靠人眼）')
{
  const lay = (readLog(log).match(/panel layout\(after-v2\)[^\n]*/g) || []).pop() || ''
  const num = (k) => { const m = lay.match(new RegExp(k + '=(\\d+)')); return m ? Number(m[1]) : -1 }
  t('几何自检留痕存在', /panel layout\(after-v2\)/.test(lay), lay.slice(0, 170))
  t('文本块零出界（全在黑板矩形内）', num('outside') === 0, lay.slice(0, 170))
  t('文本块零重叠', num('overlaps') === 0, lay.slice(0, 200))
  const last = (readLog(log).match(/panel text\(after-v2\)[^\n]*/g) || []).pop() || ''
  const cnt = (s) => (last.split(s).length - 1)
}

section('⑦ 老宿主（一个字段都不给）⇒ 四块都不出现（零 v2 渲染）')
const log2 = path.join(DIR, 'v1.log')
const st2 = runRuntime(['--hidden', '--state', 'IDLE'], { home: tmpHome('v2f1'), log: log2 })
await waitFor(() => readLog(log2).includes('ready'), { timeout: 12000 }).catch(() => {})
st2.send({ protocolVersion: 1, kind: 'state', state: 'WORKING', activity: 'coding', task: 'Bash' })
await sleep(500)
const lg2 = readLog(log2)
t('v1 下没有任何 v2 内容渲染（悬浮层 off / 面板无四块）', !/v2 render hover=on/.test(lg2) && !/v2 panel render/.test(lg2), '')

section('⑪ 长思考误判：断开后必须保留最后一帧（不许清空成"等待宿主数据"）')
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING',
  cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 },
  progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2 } })
await sleep(700)
const beforeDisc = ((readLog(log).match(/panel text\(after-v2\)[^\n]*/g) || []).pop()) || ''
t('前置：断开前确实有数据', /1\.5/.test(beforeDisc) || /4\/6/.test(beforeDisc), beforeDisc.slice(0, 110))
/* 模拟"静默超时"那一刻：宿主发来一条不带任何 v2 字段的 state */
st.send({ protocolVersion: 2, kind: 'state', state: 'DISCONNECTED' })
await sleep(900)
const lgD = readLog(log)
const afterDisc = ((lgD.match(/panel text\(after-v2\)[^\n]*/g) || []).pop()) || ''
const tailD = lgD.slice(Math.max(0, lgD.lastIndexOf('DISCONNECTED')))
t('断开后仍保留最后一帧数字（不许清空）', /1\.5/.test(afterDisc) || /4\/6/.test(afterDisc), afterDisc.slice(0, 130))
t('断开后不得出现 nodata 日志行', !/plate nodata/.test(tailD), '')
/* 说明：本场景下渲染层**本来就没丢数据**（d.hasData 仍为真）⇒ stale 分支不会被走到。
   "数据已 Xs 未更新"标注只在"曾有过数据、之后收到完全无 v2 字段的 state"时才出现 —— 该场景留待下一轮单独构造，
   这里只断言用户要求的三条（保留数字 / 不出现 nodata / 前置成立），不为自己加的日志细节写假绿断言。 */

section('⑫ 无 todos / 无 subitems 时：任务块与子代理块仍在（空态 ≠ 假数据）')
/* 只给 metrics（让 V2.any=true ⇒ 面板会渲染），特意不给 todos/subagents */
st.send({ protocolVersion: 2, kind: 'state', state: 'WORKING', metrics: { turns: 3, toolCalls: 9, elapsedMs: 12000 } })
await sleep(800)
const txtNoTodos = ((readLog(log).match(/panel text\(after-v2\)[^\n]*/g) || []).pop()) || ''
t('无 todos ⇒ 任务块仍渲染（含 任务列表为空）', /任务列表为空/.test(txtNoTodos), txtNoTodos.slice(0, 150))
t('无 subitems ⇒ 子代理/树块仍渲染（simple 模式给 子代理，full 模式给树根 主代理）', /子代理|主代理/.test(txtNoTodos), txtNoTodos.slice(0, 150))
t('空态不是假数据（不得出现 0/0 之类计数）', !/子代理\s*0\/0/.test(txtNoTodos), txtNoTodos.slice(0, 150))
try { st.kill(); st2.kill() } catch { /* ignore */ }
killStrayElectron()
console.log(`\n===== v2 四字段结果：${pass} PASS / ${fail} FAIL =====`)
process.exit(fail ? 1 : 0)
