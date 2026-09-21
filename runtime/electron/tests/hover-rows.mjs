#!/usr/bin/env node
/* hover-rows.mjs —— 悬浮信息板（#v2hover）里那**三行文字被删掉**、图形全部保留（任务 B，2026-09-20）
 *
 * 用户原话：「就是左上角这个字我都不希望留，太碍眼了」（附截图，指的是图标左上角那块悬浮信息板）。
 * 被删的三行文字 = `.st`（WORKING · commanding）/ `.bl`（计划 ——（本宿主不适用））/
 *                 `.h3` 的正文（进程 主 · 1 跑 · 共 1）。
 *
 * ★ 只删**文字**，不删**图形**（用户当时选的是"全留"）：
 *     · `.r1 > .dot`        行首小圆点           —— 保留
 *     · `.v2bullet > .bs`   150px 计划进度条     —— ⚠️ **2026-09-21 任务 C 已去掉**（默认 hoverBar='off'）
 *                                                  本测试只断言"默认态下它不在了"；它自己的双向
 *                                                  （默认不在 ↔ hoverBar='on' 原样回来）在 hover-bar.mjs。
 *     · `.h3 > .warnv2`     「▲ 计划 6→11」      —— 保留（用户当初特意要的"进度倒退要说明"）
 *   ⇒ 所以本测试是**双向**断言：文字必须不在，图形必须还在。
 *     只测"文字没了"会放过"连同图形一起删掉"这种错改。
 *
 * ★ 可回退：`window.hoverRows`（'off' = 默认，三行文字不画；'on' = 三行文字原样回来）。
 *   本测试**两个方向都起真实进程**，证明这个开关真的能还原 —— 不是只写了个没人用的键。
 *
 * ★ 守恒项：#lab / #lab2（图标下那两行青色文字）是**独立 div**，不在 #v2hover 里，
 *   它们必须原封不动（本轮只动悬浮板）。用既有的 `labrow(...)` 留痕断言，见 R4。
 *
 * ★ 自证（"尺子先证明自己是准的"）：R1 说"三行都不在"、R5 说"三行都在"，
 *   两者用**同一个解析器**读**同一族留痕**。若解析器坏了（永远报 0），R5 必然红 ⇒
 *   R1 的"不存在"就不可能是一个假否定。R5 就是本测试的正向对照。
 *
 * 用法: node tests/hover-rows.mjs      （全程离屏 --hidden：不显示窗口、不移动光标、不合成任何输入）
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, runDir, readLog, killStrayElectron, section, report, sleep, waitFor } from './harness.mjs'

const DIR = runDir('hover-rows')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

/* 三行文字在**本测试这份载荷下**的原文 —— `hoverRows:'on'` 时必须逐字回来。
   ⚠️ 口径必须与载荷一致：本载荷 progress.applicable=true ⇒ `.bl` 显示的是「计划 4/6 · 67%」；
   「计划 ——（本宿主不适用）」是**用户截图那一版**（比例不可用）的形态，两者不是同一个字符串。
   我第一版就是拿截图那版去断言"on 侧必须原样回来"，于是假红了一条
   （实测抓到：**检查器的假设错了，不是产品错了** —— 这正是"检查脚本先自证"要防的那类）。 */
const ROW_TEXT = { st: 'WORKING · commanding', bl: '计划 4/6 · 67%', h3: '进程 主 · 1 跑 · 共 1' }
/* 用户截图里那三行的**特征词** —— 只用于**否定**断言：默认态里连一个字都不许留。
   ⚠️「计划」二字刻意**不**在禁列：保留的 `.warnv2`（「▲ 计划 6→11」）自己就带它，
   把它列进去会把"正确保留"判成"没删干净"。 */
const USER_SHOT_TOKENS = ['WORKING', 'commanding', '本宿主不适用', '进程', '跑']

/* 载荷：既有"有分母的计划"（⇒ pt.ok；⚠️ 任务 C 之后默认**不再**画那条 `.bs` 了，
   除非 hoverBar='on' —— 本测试断言的就是"默认不画"），又有 planChange（⇒ `.warnv2` 会画「▲ 计划 6→11」），
   还有 metrics（⇒ #lab2 有真实值）。一份载荷同时点亮"要删的文字"和"要留的图形"，两条断言才都落在同一个渲染帧上。 */
const payload = (now) => ({
  state: 'WORKING', activity: 'commanding',
  progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item', planChange: { from: 6, to: 11, at: now } },
  metrics: { turns: 7, toolCalls: 41, elapsedMs: 158000 },
  subagents: { total: 1, running: 1, done: 0, failed: 0, stopped: 0, unknown: 0,
    items: [{ status: 'running', label: 'commanding', depth: 1, parent: null, startedAt: now - 38000, toolCalls: 21 }] },
  sessions: { total: 1, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] }
})
const pf = path.join(DIR, 'payload.json')
fs.writeFileSync(pf, JSON.stringify({ state: payload(Date.now()) }))

/* 悬停时间轴：**先有数据再悬停**（`--test-hover` 那条消息在 renderer ready 就发，
   早于载荷 ⇒ 届时 V2 里还没有任何字段，悬浮层会按"老宿主"守卫不渲染）。
   第二次 hover=on 用来拿"过渡结束后"的 labrow(hot-settled) 留痕（opacity 有 140ms 过渡）。 */
const script = path.join(DIR, 'script.json')
fs.writeFileSync(script, JSON.stringify([{ at: 1500, hover: true }, { at: 4600, hover: false }, { at: 4800, hover: true }]))

/** 起一个离屏活会话、悬停、取留痕。`configWindow` 会写进本轮专属临时 home 的 config.json。 */
async function runCase (tag, configWindow) {
  const home = tmpHome('rows-' + tag)
  if (configWindow) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ window: configWindow }, null, 2))
  const out = path.join(DIR, tag)
  fs.mkdirSync(out, { recursive: true })
  const log = path.join(out, 'main.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--hidden', '--test-hover', 'on', '--state', 'WORKING', '--window-timeout', '60000',
    '--test-script', script, '--shot-payload', pf, '--bg', 'dark'], { home, log })
  /* 等"第二次悬停"渲染出来再收尾：晚于 4800ms 的那条 hover 时间轴 + 240ms 的 labrow 去抖 */
  await waitFor(() => (readLog(log).match(/v2 render hover=on/g) || []).length >= 2, { timeout: 25000 }).catch(() => {})
  await sleep(900)
  st.send({ kind: 'shutdown' })
  const r = await st.waitExit(15000)
  if (!r) st.kill()
  killStrayElectron()
  await sleep(200)
  const lg = readLog(log)
  const rowsLines = (lg.match(/hover rows: \{[^\n]*/g) || [])
  const invLines = (lg.match(/hover inv: \{[^\n]*/g) || [])
  const inkLines = (lg.match(/hover ink: \{[^\n]*/g) || [])
  const labAll = (lg.match(/labrow\([a-z-]+\): \{[^\n]*/g) || [])
  return {
    tag, exit: r ? r.code : null,
    rowsCount: rowsLines.length, invCount: invLines.length, inkCount: inkLines.length,
    rowsLast: rowsLines.length ? (() => { try { return JSON.parse(rowsLines[rowsLines.length - 1].replace(/^hover rows: /, '')) } catch { return null } })() : null,
    invLast: invLines.length ? (() => { try { return JSON.parse(invLines[invLines.length - 1].replace(/^hover inv: /, '')) } catch { return null } })() : null,
    inkLast: inkLines.length ? (() => { try { return JSON.parse(inkLines[inkLines.length - 1].replace(/^hover ink: /, '')) } catch { return null } })() : null,
    labSettled: (() => { const s = labAll.filter((x) => /^labrow\(hot-settled\)/.test(x)).pop() || labAll.pop() || ''
      try { return JSON.parse(s.replace(/^labrow\([a-z-]+\): /, '')) } catch { return null } })()
  }
}

section('① 默认（hoverRows=off）：三行文字不在、图形还在（离屏 --hidden）')
const OFF = await runCase('off', null)
console.log('  exit=' + OFF.exit + '  留痕 条数：hover rows=' + OFF.rowsCount + ' hover inv=' + OFF.invCount + ' hover ink=' + OFF.inkCount)
if (OFF.rowsLast) console.log('  hover rows = ' + JSON.stringify(OFF.rowsLast))
if (OFF.labSettled) console.log('  #lab=[' + OFF.labSettled.labText + ']  #lab2=[' + OFF.labSettled.lab2Text + ']')
console.log('  悬浮层可见文本 = ' + JSON.stringify(OFF.rowsLast ? OFF.rowsLast.text : '(无留痕)'))

const R0 = OFF.rowsLast
check('R0【取证】拿到了这一帧的 `hover rows` 留痕，且它自报 hoverRows=off 且 hoverBar=off（没有它 = 什么都没测，不许当通过）',
  !!R0 && R0.hoverRows === 'off' && R0.hoverBar === 'off' && R0.shown === true,
  R0 ? ('hoverRows=' + R0.hoverRows + ' hoverBar=' + R0.hoverBar + ' shown=' + R0.shown + ' 留痕行数=' + OFF.rowsCount) : '没有 hover rows 留痕')

check('R1a【删文字·DOM】三行文字的节点**一个都不在**：.st=0 / .bl=0 / .h3 里没有正文（h3 容器只为装 ▲ 警告而存在）',
  !!R0 && R0.st === 0 && R0.bl === 0,
  R0 ? ('.st=' + R0.st + ' .bl=' + R0.bl + ' .h3=' + R0.h3) : '没有留痕')
/* `hover ink` 是**上一轮就有的**独立取证通道（它按 `.st/.h3/.bl` 逐行量取色）。
   用第二条通道交叉验证 R1a —— 免得"是我新加的留痕自己写错了某个计数"这类假结果。 */
check('R1b【删文字·交叉取证】既有的 `hover ink` 通道里**没有 `.st` / `.bl`** 这两行（`.h3` 容器仍在是**对的** —— 它是 ▲ 警告的挂载点，不是正文）',
  !!OFF.inkLast && Array.isArray(OFF.inkLast.rows) &&
    !OFF.inkLast.rows.some((r) => r.cls === '.st') && !OFF.inkLast.rows.some((r) => r.cls === '.bl'),
  OFF.inkLast ? ('hover ink rows=' + OFF.inkLast.rows.length + ' 条 cls=' +
    JSON.stringify(OFF.inkLast.rows.map((r) => r.cls))) : '没有 hover ink 留痕')
check('R1c【删文字·文本】悬浮层的可见文本里不含用户截图那三行的任何特征词',
  !!R0 && !USER_SHOT_TOKENS.some((t) => R0.text.includes(t)),
  R0 ? ('text=' + JSON.stringify(R0.text) + '  禁列=' + JSON.stringify(USER_SHOT_TOKENS)) : '没有留痕')

check('R2【留图形·点】行首小圆点 `.r1 > .dot` 仍在（容器 .r1 与圆点各 1 个）',
  !!R0 && R0.r1 === 1 && R0.dot === 1,
  R0 ? ('.r1=' + R0.r1 + ' .dot=' + R0.dot) : '没有留痕')
/* ⚠️ 2026-09-21 任务 C 改了口径：那根 150px 横向计划进度条**默认被去掉**了
   （用户原话「我这个左上角的任务条也不要了，有环形的这样是多此一举」）。
   本载荷是"有分母的计划"（progress 4/6 ⇒ pt.ok=true），所以这里正是"有计划也不画条"的硬判据。
   条自己的**双向**断言（默认不在 / hoverBar='on' 原样回来 + 像素差分）在 tests/hover-bar.mjs。 */
check('R3【任务 C·横条已去掉】本载荷有分母（计划 4/6）却不画条：`.v2bullet` 与 `.bs` 都是 0（`.r1>.dot` 与 `.warnv2` 照旧保留，见 R2/R4）',
  !!R0 && R0.bullet === 0 && R0.bs === 0,
  R0 ? ('.v2bullet=' + R0.bullet + ' .bs=' + R0.bs + '（任务 C 后默认应都是 0）') : '没有留痕')
check('R4【留图形·警告】「▲ 计划 6→11」的 `.h3 > .warnv2` 仍在，且文本里真有这次倒退（用户当初特意要的"进度倒退要说明"）',
  !!R0 && R0.h3warn === 1 && R0.warnv2 === 1 && /计划\s*6→11/.test(R0.text),
  R0 ? ('.h3>.warnv2=' + R0.h3warn + ' .warnv2=' + R0.warnv2 + ' text=' + JSON.stringify(R0.text)) : '没有留痕')
check('R5【守恒·#lab/#lab2】图标下那两行青色文字**原封不动**（它们是独立 div，不在 #v2hover 里）：两行都非空，且第 2 行取到本案载荷的真实值「7 轮 · 41 工具」',
  !!OFF.labSettled && String(OFF.labSettled.labText || '').length > 0 &&
    /7 轮 · 41 工具/.test(String(OFF.labSettled.lab2Text)),
  OFF.labSettled ? ('#lab=[' + OFF.labSettled.labText + ']  #lab2=[' + OFF.labSettled.lab2Text + ']') : '没有 labrow 留痕')

section('② 可回退（window.hoverRows=on）：三行文字原样回来 —— 同时是本测试的**正向对照**')
const ON = await runCase('on', { hoverRows: 'on' })
if (ON.rowsLast) console.log('  hover rows = ' + JSON.stringify(ON.rowsLast))
const R1 = ON.rowsLast
check('R6【开关生效】hoverRows=on 时渲染层确实把它读成了 on（证明这个键**真的从 config.json 走到了渲染层**，不是个死键）',
  !!R1 && R1.hoverRows === 'on',
  R1 ? ('hoverRows=' + R1.hoverRows + ' 留痕行数=' + ON.rowsCount) : '没有 hover rows 留痕')
check('R7【可回退·文字回来】三行文字节点全部回来：.st=1 / .bl=1 / .h3 容器 1 个，且三行原文逐字对得上',
  !!R1 && R1.st === 1 && R1.bl === 1 && R1.h3 === 1 &&
    R1.text.includes(ROW_TEXT.st) && R1.text.includes(ROW_TEXT.bl) && R1.text.includes(ROW_TEXT.h3),
  R1 ? ('.st=' + R1.st + ' .bl=' + R1.bl + ' .h3=' + R1.h3 + ' text=' + JSON.stringify(R1.text)) : '没有留痕')
/* ⚠️ 任务 C 之后：`hoverRows='on'` 只让**三行文字**回来；那根横条归 hoverBar 管（默认仍 'off'）。
   所以这里 `.v2bullet` 容器 = 1（它装着「计划 4/6 · 67%」那行**文字** `.bl`），而 `.bs` 必须是 0。
   "条回来"那一档在 tests/hover-bar.mjs（hoverBar='on' ⇒ .bs=1）。 */
check('R8【可回退·图形不重复】回到 on 之后图形仍是**各一个**：`.dot`=1、`.warnv2`=1、`.bs`=0（任务 C：条不跟着文字行一起回来）',
  !!R1 && R1.dot === 1 && R1.bullet === 1 && R1.bs === 0 && R1.warnv2 === 1,
  R1 ? ('.dot=' + R1.dot + ' .v2bullet=' + R1.bullet + ' .bs=' + R1.bs + ' .warnv2=' + R1.warnv2) : '没有留痕')
/* ★ 正向对照：同一个解析器在 on 这一侧必须能**报出 3 行**。
   若解析器坏了（永远报 0），R7 会红 ⇒ ① 里的"三行都不在"就不可能是假否定。 */
check('R9【尺子自证】同一个解析器在 on 侧报出**非空**的 `.st/.bl/.h3`（应各 1）—— 于是 ① 里的"都不在"是**真否定**，不是解析器故障',
  !!R1 && R1.st === 1 && R1.bl === 1 && R1.h3 === 1 &&
    !!OFF.inkLast && !OFF.inkLast.rows.some((r) => r.cls === '.st' || r.cls === '.bl'),
  'on 侧 .st=' + (R1 ? R1.st : '?') + ' .bl=' + (R1 ? R1.bl : '?') + ' .h3=' + (R1 ? R1.h3 : '?') +
  '（应各 1）；off 侧 hover ink cls=' + (OFF.inkLast ? JSON.stringify(OFF.inkLast.rows.map((r) => r.cls)) : '?') + '（不应含 .st/.bl）')

section(ok ? '悬浮信息板三行文字已删 / 两个图形保留 / 任务 C 的横条默认不画：全部通过' : '悬浮信息板三行文字已删、图形保留：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
