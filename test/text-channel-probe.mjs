#!/usr/bin/env node
/* text-channel-probe.mjs —— text 通道「两端真实产物」只读探针（**不是断言套件**）
 *
 * 目的：把「宿主实际发出去的字节」与「窗口实际判读的结果」**同时、原样**打出来，
 *       让"没有输出"和"出故障"在证据上分得开（本项目纪律）。
 *       它自己不做 pass/fail 判定 —— 判定在 test/*.test.js 与 runtime/electron/tests/v2-fields.mjs，
 *       本文件只负责产证据，改前改后都能跑，产出可直接对照。
 *
 * 覆盖的臂（每条都打原始片段）：
 *   A  宿主侧：跑真实的 src/reducer.js + src/protocol.js 构造路径 → 拿到线上原始字节
 *      A0  正常有内容（reasoning-delta + tool/call）
 *      A1  同一进程内 createMessage 的**顶层键**与 typeof msg.text（窗口判的就是这个）
 *      A2  宿主"本轮没有可发文本"时的字节（真空中性形态，不是错误）
 *   B  窗口侧（离屏 --hidden，本轮临时 home）：
 *      B1  宿主形状（flat，A0 的原始字节）→ 结果
 *      B2  嵌套形状（历史测试脚手架的形状）→ 对照：证明"本探针能看见通过"
 *      B3  空载荷（仅 revision）→ 结果
 *      B4  连续 30 条宿主形状 = 刷屏量化
 *      B5  字段类型非法（thoughtTail 是数字）→ 该降级时的表现
 *      B6  ERROR 状态（由真实 reducer 的 tool/result error 产出）→ 与 text 通道是否同源
 *   C  面板真实文本（#plateInner + #v2panel 的 textContent）原文
 *
 * 红线遵守：零真实输入合成（只用 main.js 自带的 --test-script → test-mouse/test-hover 渲染层消息，
 *          不含 SetCursorPos / mouse_event / SendInput / keybd_event）；窗口一律 --hidden；
 *          只清理本轮 spawn 的进程（harness 的 PID + 本轮临时 home）。
 * 用法: node test/text-channel-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WorkIconReducer } from '../src/reducer.js'
import { MessageKind, createMessage, encodeMessage, validateMessage } from '../src/protocol.js'
import { runRuntime, tmpHome, runDir, readLog, sleep, waitFor, killStrayElectron } from '../runtime/electron/tests/harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAIN_JS = path.resolve(HERE, '..', 'runtime', 'electron', 'main.js')
const WARN_TEXT = 'WARN text 载荷非对象，忽略'

const hr = (t) => console.log('\n============== ' + t + ' ==============')
const show = (k, v) => console.log(k + ': ' + v)
const countIn = (hay, needle) => hay.split(needle).length - 1

/* ======================================================= A. 宿主侧真实产物 */
hr('A. 宿主侧（src/reducer.js + src/protocol.js，同进程真跑）')
/* 窗口声明的能力从 main.js 原文抽出来（不硬编码，声明一改这里跟着变） */
const declared = (() => {
  const src = fs.readFileSync(MAIN_JS, 'utf8')
  const m = src.match(/const DECLARED_CAPABILITIES = \[([^\]]*)\]/)
  if (!m) throw new Error('main.js 里没找到 DECLARED_CAPABILITIES —— 探针的前提失效，先修探针')
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
})()
show('窗口声明的能力（main.js 原文抽出）', JSON.stringify(declared))

const reducer = new WorkIconReducer()
reducer.setCapabilities(declared)
const sess = { header: { id: 'dsh-host', cwd: 'C:\\Users\\david\\Desktop\\构建\\demo' } }
reducer.handle(sess, { type: 'turn/start', turn: 1, step: 1, data: { turn: 1 } })
reducer.handle(sess, { type: 'assistant/chunk', turn: 1, step: 1, data: { chunk: { type: 'reasoning-delta', index: 0, text: '先量两端的形状，再动手' } } })
reducer.handle(sess, { type: 'assistant/chunk', turn: 1, step: 1, data: { chunk: { type: 'text-delta', index: 1, text: '好的，这就去量。' } } })
reducer.handle(sess, { type: 'tool/call', turn: 1, step: 1, data: { callId: 'c1', name: 'Bash', arguments: JSON.stringify({ command: 'pnpm test' }) } })

const payload = reducer.textSnapshot()
show('A0 reducer.textSnapshot() =', JSON.stringify(payload))
/* 与 src/index.js:308-311 完全同一构造方式 */
const msg = createMessage(MessageKind.TEXT, {
  revision: 1,
  ...(payload ?? { activityText: undefined, thoughtTail: undefined, bodyTail: undefined }),
})
const line = encodeMessage(msg)
show('A1 createMessage 顶层键 =', JSON.stringify(Object.keys(msg)))
show('A1 typeof msg.text（窗口判的就是这个）=', typeof msg.text)
show('A1 msg.text =', JSON.stringify(msg.text))
show('A1 msg.revision / activityText / thoughtTail =', JSON.stringify([msg.revision, msg.activityText, msg.thoughtTail]))
const vres = validateMessage(msg)
show('A1 validateMessage(宿主这条) =', JSON.stringify(vres.ok ? { ok: true } : vres))
show('A1 线上原始字节 =', JSON.stringify(line.replace(/\n$/, '')))

const emptyLine = encodeMessage(createMessage(MessageKind.TEXT, {
  revision: 99, activityText: undefined, thoughtTail: undefined, bodyTail: undefined,
}))
show('A2 宿主"本轮没有可发文本"时的字节 =', JSON.stringify(emptyLine.replace(/\n$/, '')))
show('A2 validateMessage(空载荷) =', JSON.stringify(validateMessage(createMessage(MessageKind.TEXT, { revision: 99 })).ok))

/* ======================================================= B. 窗口侧实测 */
hr('B. 窗口侧（--hidden 离屏 + 本轮临时 home）')
const DIR = runDir('text-probe')
const log = path.join(DIR, 'main.log')
fs.rmSync(log, { force: true })
/* 面板不是宿主 kind，只能由运行时的 --test-script 双击路径打开（内部消息，非真实输入） */
const script = [{ at: 700, mouse: '160|d,100,100;u,100,100|d,100,100;u,100,100' }]
const st = runRuntime(['--hidden', '--state', 'IDLE', '--test-script', JSON.stringify(script), '--window-timeout', '600000'], {
  home: tmpHome('textprobe'), log,
})
await waitFor(() => readLog(log).includes('ready'), { timeout: 20000 })
await waitFor(() => readLog(log).includes('panel OPEN'), { timeout: 20000 })
const readyLine = (readLog(log).match(/ready capabilities=[^\n]*/) || ['(未捕获到 ready 行)'])[0]
show('B0 ready 行', readyLine)
const b1Start = countIn(readLog(log), WARN_TEXT)

/* B1 宿主形状：A0 的**原始字节**，一字不改 */
st.sendRaw(line)
await sleep(600)
const b1Warn = countIn(readLog(log), WARN_TEXT)
show('B1 发送字节', JSON.stringify(line.replace(/\n$/, '')))
show('B1 WARN(累计) =', String(b1Warn))
show('B1 渲染层 text 留痕 =', JSON.stringify((readLog(log).match(/v2 text revision=[^\n]*/g) || [])))

/* B2 嵌套形状（历史测试脚手架的形状）—— 正向对照：证明本探针能看见"通过" */
st.sendRaw(JSON.stringify({
  protocolVersion: 2, kind: 'text', timestamp: Date.now(),
  text: { revision: 41, activityText: '对照-活动行', thoughtTail: '对照-思考尾串', bodyTail: '对照-正文尾串' },
}) + '\n')
await sleep(600)
const b2Warn = countIn(readLog(log), WARN_TEXT)
show('B2 WARN(累计) =', String(b2Warn) + '   本臂新增 = ' + String(b2Warn - b1Warn))
show('B2 渲染层 text 留痕 =', JSON.stringify((readLog(log).match(/v2 text revision=[^\n]*/g) || [])))

/* B3 空载荷（宿主真空形态） */
st.sendRaw(emptyLine)
await sleep(500)
show('B3 WARN(累计) =', String(countIn(readLog(log), WARN_TEXT)))

/* B4 连续 30 条宿主形状 = 刷屏量化（每次换 revision，模拟 160ms 节流持续推进） */
const b4Start = countIn(readLog(log), WARN_TEXT)
for (let i = 0; i < 30; i++) {
  st.sendRaw(encodeMessage(createMessage(MessageKind.TEXT, {
    revision: 100 + i, activityText: '刷屏臂 ' + i, thoughtTail: '刷屏臂思考 ' + i, bodyTail: undefined,
  })))
  await sleep(12)
}
await sleep(700)
const b4Warn = countIn(readLog(log), WARN_TEXT)
show('B4 发出 30 条 → 新增 WARN =', String(b4Warn - b4Start))
show('B4 WARN 明细时间戳 =', JSON.stringify((readLog(log).match(/\[\S+\] WARN text 载荷非对象，忽略/g) || []).slice(-4)))

/* B5 字段类型非法（该降级时的表现）*/
st.sendRaw(JSON.stringify({ protocolVersion: 2, kind: 'text', timestamp: Date.now(), revision: 900, thoughtTail: 42 }) + '\n')
await sleep(500)
show('B5 WARN(累计) =', String(countIn(readLog(log), WARN_TEXT)))
show('B5 降级标识行 =', JSON.stringify((readLog(log).match(/[^\n]*(降级|不可用|degraded)[^\n]*/g) || []).slice(-3)))

/* B6 ERROR 状态：由真实 reducer 的 tool/result error 产出，与 text 通道无关地发一条 */
const r2 = new WorkIconReducer()
const s2 = { header: { id: 'sess-err', cwd: 'C:\\demo' } }
r2.handle(s2, { type: 'turn/start', turn: 1, step: 1, data: { turn: 1 } })
const errMsgs = r2.handle(s2, {
  type: 'tool/result', turn: 1, step: 1,
  data: {
    callId: 'c1',
    message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: true }] },
    error: { name: 'ToolError', code: 'E_TOOL' },
  },
})
show('B6 reducer 产出的消息 kind/state =', JSON.stringify(errMsgs.map((m) => [m.kind, m.state])))
const errState = errMsgs.find((m) => m.kind === 'state' && m.state === 'ERROR')
show('B6 将要发送的 ERROR state 原始字节 =', JSON.stringify(errState ? JSON.stringify(errState) : '(reducer 未产出 ERROR)—— 探针前提失效'))
const b6WarnBefore = countIn(readLog(log), WARN_TEXT)
const b6StatesBefore = (readLog(log).match(/STATE -> /g) || []).length
if (errState) st.sendRaw(JSON.stringify(errState) + '\n')
await sleep(600)
const lgB6 = readLog(log)
show('B6 STATE -> ERROR 出现 =', String(lgB6.includes('STATE -> ERROR')))
show('B6 本臂新增 WARN =', String(countIn(lgB6, WARN_TEXT) - b6WarnBefore) + ' / 本臂新增 STATE -> 行 = ' + String((lgB6.match(/STATE -> /g) || []).length - b6StatesBefore))
show('B6 原始片段 =', JSON.stringify((lgB6.match(/\[\S+\] (?:WARN text|STATE -> ERROR)[^\n]*/g) || []).slice(-4)))
show('B6 renderer ERROR 留痕 =', JSON.stringify((lgB6.match(/renderer: labrow\(label\):[^\n]*(?:255, 77, 109)[^\n]*/g) || []).slice(-1)))

/* B7 ERROR 的出口：紧接着喂"下一步"（`step/start` —— reducer.js:1398 `#stepStart` 里
   `stickyKind==='tool'` 的 sticky ERROR 会在这一刻收），看红灯是否按设计自己退出。
   用户看到的是"39ms 的红闪"——要判它是不是 bug，就得看 ERROR 有没有出口、由什么驱动。 */
const afterMsgs = r2.handle(s2, { type: 'step/start', turn: 1, step: 2, seq: 2, data: {} })
show('B7 下一步(step/start) reducer 产出 =', JSON.stringify(afterMsgs.map((m) => [m.kind, m.state])))
const b7StatesBefore = (readLog(log).match(/STATE -> /g) || []).length
for (const m of afterMsgs) if (m.kind === 'state' || m.kind === 'pulse') st.sendRaw(JSON.stringify(m) + '\n')
await sleep(700)
const lgB7 = readLog(log)
show('B7 本臂新增 STATE -> 行 =', JSON.stringify((lgB7.match(/STATE -> [^\n]*/g) || []).slice(b7StatesBefore)))

/* ======================================================= C. 面板真实文本 */
hr('C. 面板真实文本（#plateInner + #v2panel 的 textContent）')
show('C1 最后一条 panel text(after-v2) =', JSON.stringify((readLog(log).match(/panel text\([^)]*\)[^\n]*/g) || []).slice(-1)))

hr('汇总')
show('WARN 总数（整轮探针）', String(countIn(readLog(log), WARN_TEXT)))
show('渲染层 text 留痕条数', String((readLog(log).match(/v2 text revision=/g) || []).length))
show('日志文件', log)

st.closeStdin()
const r = await st.waitExit(20000)
show('窗口退出码', JSON.stringify(r ? r.code : null))
killStrayElectron()
