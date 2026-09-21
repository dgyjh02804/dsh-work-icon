/**
 * `tokens` 取样口径：两条路径都要认，且**同一步的重复样本必须替换而不是累加**。
 *
 * 背景（实测，见交付报告）：
 *   - 官方 `dsh-token-meter/lib/types/usage-projection.js:58-62` 的 `usageOf` 认两条路径；
 *     只认 `data.usage` 会漏掉"请求失败/中断，只留下 usage chunk"的那一步 —— token 偏小且看不出来。
 *   - 反过来，天真地"两条都加"更危险：真实日志里 **2610/2610** 个同时有两份样本的 (turn, step)
 *     数字完全相同（同一 (turn, step) 的 chunk 早样本与 message 终样本是同一份测量），
 *     直接累加会把几乎每一步都算两遍。
 *   - 官方口径是"按 (turn, step) 的槽位，重复样本替换"（`addReplacing`），本文件把它钉死。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { WorkIconReducer } from '../src/reducer.js'

const session = (id = 's1') => ({ header: { id, cwd: 'C:\\demo' } })

/** 早样本：`assistant/chunk` + `chunk.type === 'usage'`。 */
const usageChunk = (turn, step, usage, seq) => ({
  type: 'assistant/chunk',
  seq,
  data: { turn, step, chunk: { type: 'usage', usage } },
})

/** 终样本：`assistant/message` + `data.usage`。 */
const usageMessage = (turn, step, usage, seq) => ({
  type: 'assistant/message',
  seq,
  data: { turn, step, message: { role: 'assistant', content: [] }, usage },
})

const USAGE = { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 30 }

/** 喂事件并取最后一条 state 消息里的 tokens（窗口看到的就是它）。 */
function tokensAfter(reducer, s, events) {
  let last
  // tokens 本身不在去重签名里，末尾补一个改状态的事件让累加结果上线
  const all = [...events, { type: 'tool/call', seq: 9000, data: { turn: 9, step: 9, toolName: 'read_file', callId: 'c', arguments: '{}' } }]
  for (const event of all) {
    for (const message of reducer.handle(s, event)) if (message.kind === 'state') last = message
  }
  return last?.tokens
}

test('🐛 修复前的缺口：只有 usage chunk（请求失败/中断）时 token 不再整条丢失', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    usageChunk(1, 1, USAGE, 2),
    // 请求以失败收尾：终值永远不会来
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'error' } } },
  ])
  // 修复前这里拿到的是 undefined（整步的 usage 都丢了）；修复后必须如实记上
  assert.deepEqual(tokens, {
    input: 1000,
    output: 50,
    total: 1050,
    cacheRead: 200,
    cacheWrite: 30,
    reasoning: 0,
  })
})

test('🐛 重复计数防线：同一个 (turn, step) 的 chunk + 终值只算**一次**', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    usageChunk(1, 1, USAGE, 2),
    usageMessage(1, 1, USAGE, 3),
  ])
  const once = { input: 1000, output: 50, total: 1050, cacheRead: 200, cacheWrite: 30, reasoning: 0 }
  assert.deepEqual(tokens, once, '两份样本是同一个槽位的重复报告 —— 不能变成 2000/100')
  assert.notDeepEqual(tokens, { input: 2000, output: 100, total: 2100, cacheRead: 400, cacheWrite: 60, reasoning: 0 })
})

test('同一步的终值比早样本大：取**终值**（替换），不是相加', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    usageChunk(1, 1, USAGE, 2),
    usageMessage(1, 1, { ...USAGE, outputTokens: 120 }, 3),
  ])
  assert.equal(tokens.output, 120, '终值是后到的样本，应覆盖早样本')
  assert.equal(tokens.total, 1120)
})

test('不同 (turn, step) 正常累加；(turn, step) 是槽位，turn 不同不算同一步', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    usageChunk(1, 1, USAGE, 2),
    usageChunk(1, 2, USAGE, 3), // 同轮下一步 → 累加
    usageChunk(2, 1, USAGE, 4), // 下一轮的 step 1 → 与上一步不是同一槽位 → 累加
  ])
  assert.deepEqual(tokens, {
    input: 3000,
    output: 150,
    total: 3150,
    cacheRead: 600,
    cacheWrite: 90,
    reasoning: 0,
  })
})

test('total 恒等于 input + output（替换之后重新推导，不会漂）', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    usageChunk(1, 1, { inputTokens: 100, outputTokens: 10 }, 2),
    usageChunk(1, 1, { inputTokens: 7, outputTokens: 3 }, 3), // 同一步替换掉上一份
    usageChunk(1, 2, { inputTokens: 50, outputTokens: 5 }, 4),
  ])
  assert.equal(tokens.input, 57)
  assert.equal(tokens.output, 8)
  assert.equal(tokens.total, tokens.input + tokens.output)
})

test('只认 chunk.type === "usage"：别的 chunk 带 usage 字段不算样本', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    // 官方口径只认 type === 'usage'；text 块里就算带了 usage 也不该被采纳
    { type: 'assistant/chunk', seq: 2, data: { turn: 1, step: 1, chunk: { type: 'text', text: 'x', usage: USAGE } } },
  ])
  assert.equal(tokens, undefined, '不该把非 usage 块里的字段当成 token 样本')
})

test('空/垃圾 usage 不产生 0 值假桶（没有依据的数字不许显示）', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    usageChunk(1, 1, {}, 2),
    usageChunk(1, 2, { inputTokens: 'x', outputTokens: null }, 3),
  ])
  assert.equal(tokens, undefined, '全非数字的 usage 应被忽略，而不是记成 0')
})

test('重放同一事件（同 seq）不翻倍 —— 即使槽位已知', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const chunk = usageChunk(1, 1, USAGE, 2)
  const tokens = tokensAfter(reducer, s, [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    chunk,
    chunk, // 完全重放
    { ...chunk, seq: 3 }, // 同内容不同 seq → 槽位替换，仍只算一次
  ])
  assert.equal(tokens.input, 1000)
})

test('真实回合形态：每步 chunk + 终值各一份，总账 = 各步之和（不是两倍）', () => {
  const reducer = new WorkIconReducer()
  const s = session()
  const events = [{ type: 'turn/start', seq: 1, data: { turn: 1 } }]
  let seq = 2
  const steps = 5
  for (let step = 1; step <= steps; step++) {
    events.push(usageChunk(1, step, { inputTokens: 100, outputTokens: 10 }, seq++))
    events.push(usageMessage(1, step, { inputTokens: 100, outputTokens: 10 }, seq++))
  }
  const tokens = tokensAfter(reducer, s, events)
  assert.equal(tokens.input, 100 * steps, `5 步各 100 input → 500（不是 1000）`)
  assert.equal(tokens.output, 10 * steps)
})
