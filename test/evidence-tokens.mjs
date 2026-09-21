/**
 * 取证 1：当前 tokens 到底少算了什么（修改前跑）。
 * 读的是**上线的 state 消息里的 tokens 字段**（窗口显示的就是它），不是内部字段。
 * 只记录事实与数字，不下结论。
 */
import { WorkIconReducer } from '../src/reducer.js'

const main = { header: { id: 'ev-1', cwd: 'C:\\demo' } }
const USAGE = { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 30 }
const chunkUsage = { type: 'assistant/chunk', seq: 10, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: USAGE } } }
const messageUsage = { type: 'assistant/message', seq: 11, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ok' }] }, usage: USAGE } }

/**
 * 跑一串事件，取最后一条 state 消息里的 tokens。
 *
 * 注意：`tokens` 本身**不在**去重签名里（签名只管状态/进度/子代理/会话），
 * 所以只喂 usage 事件不会产出 state 消息 —— 这里在末尾补一个会改状态的事件
 * （tool/call），让累加结果上线；真实会话里这种事件本来就不停发生。
 */
function tokensAfter(label, events) {
  const reducer = new WorkIconReducer()
  let last
  const all = [...events, { type: 'tool/call', seq: 900, data: { turn: 1, step: 9, toolName: 'read_file', callId: 'c1', arguments: '{}' } }]
  for (const event of all) {
    const messages = reducer.handle(main, event)
    for (const message of messages) if (message.kind === 'state') last = message
  }
  console.log(`${label}\n    → state.tokens = ${JSON.stringify(last?.tokens ?? null)}`)
  return last?.tokens
}

const start = { type: 'turn/start', seq: 1, data: { turn: 1 } }

tokensAfter('场景 A：只有 usage chunk（请求失败/中断，没有 assistant/message）', [start, chunkUsage])
tokensAfter('场景 B：只有 assistant/message 终值', [start, messageUsage])
tokensAfter('场景 C：两者都有（同 turn/step，数字相同）', [start, chunkUsage, messageUsage])
tokensAfter('场景 D：两者都有，终值 output 50→120（终值是后到的样本）', [
  start,
  chunkUsage,
  { ...messageUsage, data: { ...messageUsage.data, usage: { ...USAGE, outputTokens: 120 } } },
])
tokensAfter('场景 E：两个不同的 step 各有一条 usage chunk（正常累加对照）', [
  start,
  chunkUsage,
  { ...chunkUsage, seq: 12, data: { turn: 1, step: 2, chunk: { type: 'usage', usage: USAGE } } },
])
