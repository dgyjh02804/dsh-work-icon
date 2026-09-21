import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WorkIconReducer } from '../src/reducer.js'
import { MessageKind, createMessage, encodeMessage, validateMessage } from '../src/protocol.js'
import { TEXT_THROTTLE_MS } from '../src/index.js'

/* text 通道的**跨侧契约**守卫（2026-09-20）。
 *
 * 背景（真实故障，用户生产日志 helper.log.1 实测）：
 *   · 宿主 `src/index.js:308` 用 `createMessage(MessageKind.TEXT, {revision, ...payload})` 发送；
 *   · 而 `createMessage()`（src/protocol.js `stripReserved`）把 payload **平铺到顶层**，
 *     `validatePayload` 也按**顶层**校验 `message.revision` / `message.thoughtTail`；
 *   · 窗口 `main.js` 的 text 分支当时只认 `msg.text`（**嵌套对象**）⇒ **每一条都走 else**
 *     ⇒ 连续流式期 6.17 条/秒全是 `WARN text 载荷非对象，忽略`（p50 间隔 162ms = 宿主
 *     TEXT_THROTTLE_MS=160 的节拍，即 100% 丢失率），面板「思考文本」永远拿不到内容。
 *   · 为什么两侧都没拦住：宿主测试校验**扁平** ✓、窗口测试（v2-fields.mjs 旧版）自己造了
 *     **嵌套**形状 ✓ —— **两边各自绿、合起来是空的**（跨侧契约形状漂移）。
 *
 * 本文件的职责：把"权威形状"钉死在**宿主侧**（窗口侧的行为断言在
 * runtime/electron/tests/v2-fields.mjs 的 ⑥/⑥b：发宿主真实形状 ⇒ 必须渲染出内容）。
 * 两侧各一份守卫，任一侧单独漂移都会红。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAIN_JS = path.resolve(HERE, '..', 'runtime', 'electron', 'main.js')
const INDEX_HTML = path.resolve(HERE, '..', 'runtime', 'electron', 'index.html')

/** 7 个窗口能力声明（main.js 原文抽出，不硬编码） */
function declaredCapabilities () {
  const src = fs.readFileSync(MAIN_JS, 'utf8')
  const m = src.match(/const DECLARED_CAPABILITIES = \[([^\]]*)\]/)
  assert.ok(m, 'main.js 里找不到 DECLARED_CAPABILITIES')
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

test('跨侧契约：宿主 text 消息是**扁平**的（不是嵌套 text 对象）', () => {
  const msg = createMessage(MessageKind.TEXT, { revision: 7, activityText: 'a', thoughtTail: 't', bodyTail: 'b' })
  assert.equal(msg.text, undefined, 'payload 必须平铺到顶层；出现 msg.text 说明契约漂移了')
  assert.equal(msg.revision, 7)
  assert.equal(msg.activityText, 'a')
  assert.equal(msg.thoughtTail, 't')
  assert.equal(msg.bodyTail, 'b')
})

test('跨侧契约：扁平形状是**协议合法**的（窗口不可能靠"协议校验"发现形状错了）', () => {
  const flat = createMessage(MessageKind.TEXT, { revision: 1, activityText: 'a', thoughtTail: 't', bodyTail: 'b' })
  assert.deepEqual(validateMessage(flat), { ok: true, message: flat })
})

test('跨侧契约：**嵌套**形状反而是非法的（钉死权威方向，防止有人"顺手改成嵌套"）', () => {
  const nested = createMessage(MessageKind.TEXT, { text: { revision: 1, thoughtTail: 't' } })
  const res = validateMessage(nested)
  assert.equal(res.ok, false, '嵌套形状必须被协议判为非法（revision 不在顶层）')
  assert.match(String(res.error), /text\.revision/)
})

test('空载荷（只有 revision）合法且**没有**任何文本字段 —— "没有内容"不是"非法"', () => {
  const empty = createMessage(MessageKind.TEXT, { activityText: undefined, thoughtTail: undefined, bodyTail: undefined, revision: 42 })
  assert.equal(validateMessage(empty).ok, true)
  assert.equal(empty.revision, 42)
  for (const field of ['activityText', 'thoughtTail', 'bodyTail']) assert.equal(empty[field], undefined)
  /* 序列化后真的只剩 revision（undefined 键被 JSON 丢掉）—— 这就是线上字节 */
  const wire = JSON.parse(encodeMessage(empty))
  assert.deepEqual(Object.keys(wire).filter((k) => k !== 'protocolVersion' && k !== 'kind' && k !== 'timestamp'), ['revision'])
})

test('端到端往返：真实 reducer → textSnapshot → createMessage → encode → 解析，字段一字不差', () => {
  const reducer = new WorkIconReducer()
  reducer.setCapabilities(declaredCapabilities())
  const session = { header: { id: 'dsh-host', cwd: 'C:\\demo' } }
  reducer.handle(session, { type: 'turn/start', turn: 1, step: 1, data: { turn: 1 } })
  reducer.handle(session, { type: 'assistant/chunk', turn: 1, step: 1, data: { chunk: { type: 'reasoning-delta', index: 0, text: '思考正文' } } })
  reducer.handle(session, { type: 'assistant/chunk', turn: 1, step: 1, data: { chunk: { type: 'text-delta', index: 1, text: '正文' } } })
  reducer.handle(session, { type: 'tool/call', turn: 1, step: 1, data: { callId: 'c1', name: 'Bash', arguments: JSON.stringify({ command: 'pnpm test' }) } })

  const snapshot = reducer.textSnapshot()
  assert.ok(snapshot, '有活动/思考/正文时 textSnapshot 不该是 undefined')
  const wire = JSON.parse(encodeMessage(createMessage(MessageKind.TEXT, { revision: 1, ...snapshot })))
  assert.equal(wire.kind, 'text')
  assert.equal(wire.text, undefined, '线上字节里不许出现嵌套 text')
  assert.equal(wire.revision, 1)
  assert.equal(wire.activityText, snapshot.activityText)
  assert.equal(wire.thoughtTail, snapshot.thoughtTail)
  assert.equal(wire.bodyTail, snapshot.bodyTail)
  /* 窗口的判据必须能在**顶层**读到这三个字段（宿主形状的充要条件） */
  for (const field of ['activityText', 'thoughtTail', 'bodyTail']) assert.equal(typeof wire[field], 'string')
})

test('节拍来源：宿主文本节流 = TEXT_THROTTLE_MS，正是"6 条/秒"的上界', () => {
  /* 实测（helper.log.1，连续流式期）：相邻 WARN 间隔 p50=162ms / p10=160ms ⇒ 6.17 条/秒。
     这个密度不是随机的：text 只在节流点发送 ⇒ 丢一条就报一条 ⇒ 上限 = 1000/TEXT_THROTTLE_MS。
     因此"6 条/秒"等价于"**每一条 text 都被丢掉**"（100% 丢失率），而不是偶发丢包。 */
  assert.equal(TEXT_THROTTLE_MS, 160)
  assert.ok(1000 / TEXT_THROTTLE_MS < 6.3 && 1000 / TEXT_THROTTLE_MS > 6.0,
    '节流上限应落在 6.0~6.3 条/秒（与实测 6.17 条/秒一致）')
})

test('窗口侧守卫：判据不许退回"只认嵌套 msg.text"，且渲染层按顶层字段取数', () => {
  const main = fs.readFileSync(MAIN_JS, 'utf8')
  /* ① 旧判据（只认嵌套）必须已经不存在 —— 它就是 6.17 条/秒那条告警的成因 */
  assert.equal(/if \(msg\.text && typeof msg\.text === 'object'\)\s*\{/.test(main), false,
    'main.js 里仍存在"只认嵌套 msg.text"的旧判据：宿主发扁平 ⇒ 每条 text 都会被丢掉')
  /* ② 新路径存在，且以顶层为权威 */
  assert.match(main, /function handleTextMessage \(msg\) \{/, 'main.js 缺少 handleTextMessage')
  assert.match(main, /const src = nested \? msg\.text : msg/, 'handleTextMessage 必须以顶层为权威、嵌套仅作兼容')
  assert.match(main, /case 'text':\s*\n\s*handleTextMessage\(msg\)/, 'handleMessage 的 text 分支必须走 handleTextMessage')
  /* ③ 窗口声明了 text（不声明宿主不会发 —— 声明了就必须看得见） */
  assert.ok(declaredCapabilities().includes('text'), '窗口必须声明 text 能力')
  /* ④ 渲染层读的是**顶层**字段（与宿主形状同一口径） */
  const html = fs.readFileSync(INDEX_HTML, 'utf8')
  assert.match(html, /msg\.activityText/, '渲染层必须从顶层读 activityText')
  assert.match(html, /msg\.thoughtTail/, '渲染层必须从顶层读 thoughtTail')
  assert.equal(/msg\.text\.thoughtTail/.test(html), false, '渲染层不许读嵌套的 msg.text.thoughtTail')
  /* ⑤ 降级必须可见（纪律：没有输出必须能和出故障区分开） */
  assert.match(html, /思考文本不可用/, '渲染层缺少"思考文本不可用"的降级标识')
  assert.match(html, /等待数据/, '渲染层缺少"等待数据"标识（合法空载荷 ≠ 故障）')
})
