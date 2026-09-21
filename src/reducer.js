/**
 * dsh-work-icon · 会话事件 → 工作状态归约
 *
 * 输入：DSH 的 (session, event)；输出：待发送的协议消息数组。
 * 归约器只认 DSH 的公开事件名（session/event 总线上的 type），
 * 不认识的事件一律安静忽略。
 *
 * 三条对外语义（最终报告「归约语义」一节）：
 *  1) 优先级   WAITING > ERROR > WORKING > THINKING > SUCCESS > IDLE > DISCONNECTED
 *  2) 粘性     WAITING / ERROR 一旦确立，不会被同轮内的 THINKING/WORKING 覆盖
 *  3) 去重     只有"对外可见的签名"变化才产出 state 消息（elapsedMs/timestamp 除外）
 */

import {
  Activity,
  Capability,
  MessageKind,
  WorkState,
  createMessage,
  isCapability,
} from './protocol.js'
import {
  TEXT_CAPS,
  TextRing,
  activityLineFor,
  todosDigest,
  todosPayload,
} from './text.js'
import { nextPendingLabel, progressDigest, progressPayload, treeTodosPayload } from './progress.js'
import { SubagentLedger, subagentsDigest } from './subagents.js'
import { ContextReason, contextDigest, contextPayload, pressureTokensOf, routeOf, usageSampleOf } from './context.js'

/** SPEC 第 4 节：OK 是一次性 2.5s 闪光后自动回 IDLE。 */
export const DEFAULT_SUCCESS_TTL_MS = 2500

/**
 * 轮级错误（turn 以 error / max-tokens / interrupted 结束）的红灯时长。
 *
 * 20s 的取值理由：够长，长到用户切回编辑器、抬头看一眼也能看到红；
 * 够短，短到不会因为一次失败把图标钉在红色上超过半分钟。
 * **关键不变式：ERROR 一定有出口** —— 以前它只能被"下一轮开始/用户开口"清掉，
 * 而这两件事都可能永远不发生（会话结束、子代理退出），于是图标永久冻红。
 */
export const DEFAULT_ERROR_TTL_MS = 20000

/**
 * 工具级错误（单次 `tool/result` 带 isError）的红灯时长。
 * 5s ≈ 一次"闪烁"：够被眼角捕捉到，又不会让长回合里偶发的一个失败命令
 * 把图标染红十几秒（实测长会话里工具失败非常常见）。
 */
export const DEFAULT_TOOL_ERROR_TTL_MS = 5000

/**
 * 会话"长时间没有任何事件"后，粘性状态（WAITING / ERROR）的淘汰阈值。
 * 用途：一个已经结束的子代理会话不该靠优先级永久压制主会话。
 */
export const DEFAULT_STALE_STICKY_MS = 90000

/**
 * 会话间取舍用的权重。只有「最需要人注意」的那一个会话会上屏。
 * SUCCESS 排在 THINKING 之下：另一个会话正在干活时，别用绿色闪光盖掉它。
 * DISCONNECTED 最低：只要还有任何活着的会话，它就永远不该上屏。
 */
export const STATE_RANK = Object.freeze({
  [WorkState.WAITING]: 60,
  [WorkState.ERROR]: 50,
  [WorkState.WORKING]: 30,
  [WorkState.THINKING]: 20,
  [WorkState.SUCCESS]: 10,
  [WorkState.IDLE]: 0,
  [WorkState.DISCONNECTED]: -10,
})

/**
 * **等级**（"同等级合并"的粒度）。
 *
 * 用户拍板（原话）：「保留紧急优先，**同等级的会话（都在跑 / 都在思考）要合并成一个总状态**」，
 * 并明确两条禁令：「别把该亮的灯合并掉（一个在等输入、另一个在跑 ⇒ 必须仍然是 WAITING）」、
 * 「也别把完成和在跑混成一个」。
 *
 * 等级就是按这两条禁令切出来的四档（切法与 `STATE_RANK` 的顺序严格一致）：
 *   URGENT 需要人：WAITING(60) / ERROR(50)   —— 不许被任何"在干活"的会话抢走
 *   BUSY   在干活：WORKING(30) / THINKING(20) —— "两边轮流干活"就是在这档里来回跳
 *   DONE   刚完成：SUCCESS(10)                —— 不许和 BUSY 混（用户第 2 条禁令）
 *   IDLE   没事  ：IDLE(0) / DISCONNECTED(-10)
 *
 * 为什么 BUSY 要合成一档（实测，不是推测）：
 *   `node test/measure-flicker.mjs` —— 两个会话的**工具轮流开合**时，图标 state 的
 *   真实发出序列是 `THINKING → WORKING → WORKING → WORKING → THINKING → …`，
 *   **值变化 6 次**。驱动是一个布尔量"此刻还有没有开着的工具"（`#thinkingPulse` 里
 *   `record.openTools.size > 0` ⇒ WORKING），它在两个会话之间轮流翻转。
 *   对用户来说这两种都是"有会话在干活、没在等我"，是同一条灯。
 */
export const StateTier = Object.freeze({
  URGENT: 'urgent',
  BUSY: 'busy',
  DONE: 'done',
  IDLE: 'idle',
})

/** 状态 → 等级。`STATE_RANK` 的次序必须与等级次序一致（URGENT > BUSY > DONE > IDLE）。 */
export const TIER_OF_STATE = Object.freeze({
  [WorkState.WAITING]: StateTier.URGENT,
  [WorkState.ERROR]: StateTier.URGENT,
  [WorkState.WORKING]: StateTier.BUSY,
  [WorkState.THINKING]: StateTier.BUSY,
  [WorkState.SUCCESS]: StateTier.DONE,
  [WorkState.IDLE]: StateTier.IDLE,
  [WorkState.DISCONNECTED]: StateTier.IDLE,
})

export function tierOfState(state) {
  return TIER_OF_STATE[state] ?? StateTier.IDLE
}

/**
 * "同等级合并"的触发门槛：同一等级里**达到**这个会话数才合并。
 *
 * 刻意 > 1：只有一个会话时，WORKING ⇄ THINKING 的来回是**真实信息**
 * （"正在跑工具" vs "正在想"），单会话行为必须与修复前逐字节一致（零回归）。
 * 合并只为解决"多个会话互相抢"这件用户报的事。
 */
export const MERGE_MIN_SESSIONS = 2

/**
 * **哪些等级才做合并**。
 *
 * 合并要解决的是「多个会话**同时在干活**时图标来回跳」，所以只有"正在发生工作"的两档才合并：
 *   URGENT（有人在等/出错）与 BUSY（有人在干活）。
 * DONE / IDLE 不合并 —— 那两个等级里不存在"两边轮流干活"，
 * 保持原有的"最近活跃者上屏"（新开的对话/刚结束的对话能立刻反映到图标上，
 * 这条被 `test/reducer-states.test.js` 的 projectNameOf 用例钉住）。
 */
const MERGE_TIERS = new Set([StateTier.URGENT, StateTier.BUSY])

const EDIT_TOKENS = new Set([
  'write', 'edit', 'patch', 'replace', 'apply', 'create', 'insert', 'rename',
  'move', 'delete', 'remove', 'mkdir', 'touch', 'format', 'writefile', 'multiedit',
])
const SEARCH_TOKENS = new Set([
  'read', 'glob', 'grep', 'search', 'find', 'list', 'ls', 'cat', 'view', 'open',
  'fetch', 'web', 'browse', 'explore', 'tree', 'locate', 'rg', 'scan', 'inspect',
])
const COMMAND_TOKENS = new Set([
  'bash', 'shell', 'sh', 'exec', 'execute', 'command', 'commands', 'cmd',
  'powershell', 'pwsh', 'terminal', 'run', 'runs', 'spawn', 'process', 'console',
])
const TEST_TOKENS = new Set([
  'test', 'tests', 'testing', 'build', 'builds', 'lint', 'typecheck', 'check',
  'verify', 'compile', 'bench', 'benchmark', 'spec',
])
const ASK_VERBS = new Set([
  'ask', 'asks', 'request', 'requests', 'prompt', 'prompts', 'require',
  'requires', 'need', 'needs', 'seek', 'seeks',
])
const USER_TOKENS = new Set(['user', 'human', 'me', 'operator', 'caller'])
/** tokens 桶的字段（替换累加与"两份样本是否相同"都按这套字段比）。 */
const TOKEN_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'])
const ASK_NOUNS = new Set([
  'question', 'questions', 'input', 'answer', 'answers', 'decision', 'decisions',
  'approval', 'permission', 'authorization', 'authorisation', 'consent',
  'clarify', 'clarification', 'confirmation', 'choice', 'help',
])

/** 命令文本里"这是测试/构建"的信号（SPEC：bash 里跑测试/构建 → testing）。 */
const TEST_COMMAND_PATTERN = new RegExp(
  [
    '(?:^|[\\s;&|(])(?:npm|pnpm|yarn|bun|npx|pnpx)\\s+(?:run\\s+)?(?:test|tests|build|lint|typecheck|check|t|b)\\b',
    'node\\s+--test\\b',
    'pytest\\b',
    'jest\\b',
    'vitest\\b',
    'cargo\\s+(?:test|build|check|clippy)\\b',
    'go\\s+(?:test|build|vet)\\b',
    'gradlew?\\b',
    'mvn\\w*\\b',
    'dotnet\\s+(?:test|build)\\b',
    'make\\b',
    'tsc\\b',
    'eslint\\b',
    'biome\\b',
    'ruff\\b',
    'tox\\b',
    'docker\\s+build\\b',
  ].join('|'),
  'iu',
)

/** camelCase / snake_case / kebab-case 都能切开，避免 MultiEdit 这类名字漏判。 */
export function tokenize(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
}

function textOf(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** 从任意形状的工具参数里抠出命令文本（bash 的 command / 字符串参数 / 数组）。 */
export function extractCommandText(args) {
  if (args === undefined || args === null) return ''
  if (typeof args === 'string') return args
  if (Array.isArray(args)) return args.map(extractCommandText).filter(Boolean).join(' \n ')
  if (typeof args !== 'object') return ''
  for (const key of ['command', 'cmd', 'script', 'shell', 'line', 'input', 'code']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
    if (value && typeof value === 'object') {
      const nested = extractCommandText(value)
      if (nested) return nested
    }
  }
  return ''
}

/**
 * 从 tool/call 事件取工具参数。
 *
 * 权威类型（`@deepseek-ai/dsh-session` 的 SessionEventMap）：
 *   'tool/call': { turn, step, callId, name, arguments: string }
 * `arguments` 是**模型产出的、未解析的 JSON 字符串**；没有 `data.args` / `data.input`。
 * 能解析就返回对象（bash 的命令文本在 `.command`），解析失败退回原文——
 * 退回原文只是保底，主路径永远是解析后的值，不能靠"正则碰巧匹配到 JSON 串里的字面量"。
 */
export function toolArgsOf(event) {
  const raw = event?.data?.arguments
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return raw
    return parsed
  } catch {
    return raw
  }
}

export function isTestCommandText(text) {
  const value = textOf(text)
  if (value.length === 0) return false
  // 引号/逗号/括号/冒号都当成命令分隔符：这样既能看清 shell 里的 `a && npm test`，
  // 也能在 arguments 是半截 JSON 字符串（解析失败的回退路径）时看见里面的命令。
  return TEST_COMMAND_PATTERN.test(value.replace(/["'`,:;[\]{}()]/gu, ' '))
}

/**
 * 工具名（+ 可选参数）→ activity。SPEC 第 5 节的四值枚举里没有"其它"，
 * 认不出来的工具归到 commanding（它在屏幕上等价于"正在动手做点什么"）。
 *
 * 判定顺序：改名（写）→ 读名（查）→ 命令族。命令族里再看命令行文本：
 * 只有真的跑测试/构建才算 testing，其余一律 commanding（SPEC 的原文要求）。
 * 命令族工具没有参数可看时，退回工具名自己的 test/build 词（run_tests → testing）。
 */
export function activityForTool(toolName, args) {
  const tokens = tokenize(toolName)
  const commandFamily = tokens.some((token) => COMMAND_TOKENS.has(token))
  const testToken = tokens.some((token) => TEST_TOKENS.has(token))
  const commandText = extractCommandText(args)

  if (tokens.some((token) => EDIT_TOKENS.has(token))) return Activity.EDITING
  if (tokens.some((token) => SEARCH_TOKENS.has(token))) return Activity.SEARCHING
  if (commandFamily) {
    if (commandText) return isTestCommandText(commandText) ? Activity.TESTING : Activity.COMMANDING
    return testToken ? Activity.TESTING : Activity.COMMANDING
  }
  if (testToken) return Activity.TESTING
  if (isTestCommandText(commandText)) return Activity.TESTING
  return Activity.COMMANDING
}

/**
 * 这个工具会不会阻塞等人？（ask_user_question / exit_plan_mode 这类）
 * 逐 token 判断而不是子串正则：`code_review`、`permission_scan` 这类
 * 名字里带 review/permission 的普通工具绝不能被误判成"等人确认"。
 */
export function isUserQuestionTool(toolName) {
  const tokens = tokenize(toolName)
  if (tokens.length === 0) return false
  const hasNoun = tokens.some((token) => ASK_NOUNS.has(token))
  const hasUser = tokens.some((token) => USER_TOKENS.has(token))
  const hasVerb = tokens.some((token) => ASK_VERBS.has(token))
  if (hasNoun && (hasUser || hasVerb)) return true
  // exit_plan_mode 会一直阻塞到用户批准/驳回，语义上就是"待确认"。
  return tokens.includes('exit') && tokens.includes('plan') && tokens.includes('mode')
}

export function sessionIdOf(session) {
  return String(session?.header?.id ?? session?.id ?? 'unknown-session')
}

/**
 * 会话 id 归一化：账本（以及上游个别位置）里同一会话可能写成
 * `session-<uuid>` 或裸 `<uuid>`（实测同机两种都有），比对前必须抹平前缀，
 * 否则会整段漏算花费。归约器内部一律用归一化后的 id 做键。
 */
export function normalizeSessionId(value) {
  const text = String(value ?? '').trim()
  return text.startsWith('session-') ? text.slice('session-'.length) : text
}

export function isSubagentSession(session) {
  return session?.header?.origin === 'subagent'
    || Number(session?.header?.delegationDepth ?? 0) > 0
}

/**
 * 父会话 id（权威类型里 session.header 上叫 parentSession，个别版本叫 parentId；
 * 与 dsh-bottom-info-bar 收集子代理时用的字段一致）。
 * 返回**归一化后**的 id：账本里同一会话可能写成 `session-<uuid>` 或裸 `<uuid>`。
 */
export function parentIdOf(session) {
  const raw = session?.header?.parentSession ?? session?.header?.parentId
  const text = String(raw ?? '').trim()
  if (text.length === 0) return undefined
  return normalizeSessionId(text)
}

function cleanLabel(value, max = 48) {
  const text = textOf(value).trim().replace(/\s+/gu, ' ')
  return text ? text.slice(0, max) : undefined
}

/**
 * 会话所在目录的短名。权威类型里 **Session 只有** `surface / header / id / firstLiveSeq / events / seq`，
 * 没有 `cwd` / `title` / `name` / `context` —— 目录只可能来自 `session.header.cwd`。
 * 会话标题是另一回事，走 `session/title` 事件（见 #sessionTitle）。
 */
function projectNameOf(session) {
  const cwd = cleanLabel(session?.header?.cwd, 200)
  if (!cwd) return undefined
  const parts = cwd.split(/[\\/]+/u).filter(Boolean)
  return cleanLabel(parts.length > 1 ? parts.at(-1) : cwd, 40)
}

/**
 * 工具调用的 callId（三条来源都已核对）：
 *   'tool/call'   → data.callId
 *   'tool/result' → data.message.content[0].toolCallId（ToolResultBlock 保留了 call 关联）
 *                或 data.message.source.callId（ToolMessageSource.callId）
 */
export function toolCallIdOf(event, fallback = '') {
  const data = event?.data
  const content = data?.message?.content
  const contentCallId = Array.isArray(content)
    ? content.find((item) => item && typeof item === 'object' && item.toolCallId)?.toolCallId
    : undefined
  const value = contentCallId ?? data?.message?.source?.callId ?? data?.callId
  const text = textOf(value)
  return text || fallback
}

/** 'tool/call' 的工具名只有一个家在 data.name。 */
export function toolNameOf(event) {
  return cleanLabel(event?.data?.name, 48) ?? 'tool'
}

/** 'turn/end' 的 reason 是 TurnEndReasonMap：completed|aborted|blocked|error|max-tokens|interrupted。 */
function reasonKindOf(event) {
  const reason = event?.data?.reason
  const value = (reason && typeof reason === 'object' ? reason.kind : reason) ?? 'completed'
  return cleanLabel(value, 32) ?? 'completed'
}

/**
 * 工具失败判定，两条真实来源：
 *   1) 'tool/result'.error = { name, code }（结构化内部失败）
 *   2) 'tool/result'.message.content[0].isError（ToolResultBlock 的模型可见错误标记）
 */
function toolErrorOf(event) {
  const data = event?.data
  const error = data?.error
  if (error && typeof error === 'object') {
    return {
      code: cleanLabel(error.code, 80),
      name: cleanLabel(error.name, 80),
    }
  }
  const block = Array.isArray(data?.message?.content) ? data.message.content[0] : undefined
  if (block && typeof block === 'object' && block.isError === true) return { code: undefined, name: undefined }
  return undefined
}

function progressOf(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return undefined
  const completed = todos.filter((todo) => ['completed', 'complete', 'done'].includes(textOf(todo?.status).toLowerCase())).length
  const currentIndex = todos.findIndex((todo) => textOf(todo?.status).toLowerCase() === 'in_progress')
  const current = currentIndex >= 0 ? todos[currentIndex] : todos.find((todo) => textOf(todo?.status).toLowerCase() === 'pending')
  return {
    completed,
    total: todos.length,
    current: currentIndex >= 0 ? currentIndex + 1 : undefined,
    label: cleanLabel(current?.content, 64),
  }
}

/**
 * token 增量。**两条路径都要认**（与官方 `dsh-token-meter/lib/types/usage-projection.js:58-62`
 * 的 `usageOf` 逐字同源）：
 *   - `assistant/chunk` + `data.chunk.type === 'usage'` → `data.chunk.usage`
 *     （**早样本**：请求失败/中断时，终值永远不来，只有这条留下 usage）
 *   - `assistant/message` → `data.usage`（同一步的**终样本**）
 *
 * 权威类型：
 *   'assistant/message': { turn, step, message, usage?: TokenUsage, interrupted? }
 *   TokenUsage = { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }
 * usage 挂在**事件**上（data.usage 或 data.chunk.usage），不在 message 上；也没有 totalTokens 字段。
 *
 * 对外保证窗口侧 README 约定的三键 `{ input, output, total }` 里 **total = input + output**
 * （消费方按"总量"显示时才不会自相矛盾）；cache/reasoning 作为附加字段一并给出，窗口可忽略。
 */
function usageOf(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return undefined
  const fromChunk = event?.type === 'assistant/chunk' && data.chunk?.type === 'usage'
    ? data.chunk.usage
    : undefined
  const usage = fromChunk ?? (event?.type === 'assistant/message' ? data.usage : undefined)
  if (!usage || typeof usage !== 'object') return undefined
  // 严格只认真正的数字：`Number(null) === 0`、`Number('') === 0` 会把一个畸形的 usage
  // 变成"0 token 的假桶"——那正是"显示 0 而不是真实数值"的假数据。一个真数字都没有就不认这份样本。
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const raw = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.reasoningTokens]
  if (!raw.some((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  const input = num(usage.inputTokens)
  const output = num(usage.outputTokens)
  return {
    input,
    output,
    total: input + output,
    cacheRead: num(usage.cacheReadTokens),
    cacheWrite: num(usage.cacheWriteTokens),
    reasoning: num(usage.reasoningTokens),
  }
}

/** 两份 usage 桶是否逐字段相同（官方 `bucketsEqual` 同义）。 */
function sameUsageBuckets(left, right) {
  if (!left || !right) return false
  return TOKEN_FIELDS.every((field) => (left[field] ?? 0) === (right[field] ?? 0))
}

/**
 * 累加但**先替换掉同一步的旧样本**（官方 `addReplacing` 同义）。
 *
 * 为什么不能直接加：同一个 (turn, step) 会报**两次** usage —— 先是 chunk 早样本、
 * 后是 assistant/message 终样本，两者数字实测完全相同（2610/2610 步）。
 * 直接加就会把几乎每一步都算两遍；减掉旧值再加新值才是官方口径。
 */
function addReplacingUsage(totals, previous, next) {
  const value = (bucket, field) => Number(bucket?.[field] ?? 0)
  const replaced = (field) => (totals?.[field] ?? 0) - value(previous, field) + value(next, field)
  const input = replaced('input')
  const output = replaced('output')
  return {
    input,
    output,
    // total 恒等于 input + output（窗口 README 的三键契约），替换后重新推导而不是各自累加。
    total: input + output,
    cacheRead: replaced('cacheRead'),
    cacheWrite: replaced('cacheWrite'),
    reasoning: replaced('reasoning'),
  }
}

/** 两次花费快照是否等价（金额/条数/状态全同 = 不需要重推）。 */
function sameCost(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.status !== right.status) return false
  if (left.priced !== right.priced || left.unpriced !== right.unpriced) return false
  if (left.partial !== right.partial) return false
  const a = left.cost ?? {}
  const b = right.cost ?? {}
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function compareRecords(left, right) {  const rank = (STATE_RANK[right.state] ?? 0) - (STATE_RANK[left.state] ?? 0)
  if (rank !== 0) return rank
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
  return left.id.localeCompare(right.id)
}

/** 对外可见签名：决定"要不要再发一条 state"。elapsedMs 刻意不进签名。 */
function signatureOf(
  record,
  rootPlan,
  rootTodos,
  subagentDigest = '',
  sessionsDigest = '',
  contextDigestValue = '',
  levelState = undefined,
  totalsDigest = '',
) {
  return [
    record.id,
    // 显示状态：多会话同等级合并后它可能**不等于** record.state，
    // 而窗口是按它挑颜色的 ⇒ 它必须进签名，否则"合并状态变了"会被去重吃掉。
    levelState ?? record.state,
    record.activity ?? '',
    record.toolName ?? '',
    record.task ?? '',
    record.project ?? '',
    record.title ?? '',
    record.reasoningEffort ?? '',
    // 计划进度的指纹（真进度：done/total/在做的哪一条/分母跳变）。
    // ⚠️ 与 `#stateMessage` 用**同一个来源**（根会话的计划）：否则焦点在子代理上时，
    //    主代理计划变了但签名没变 ⇒ 去重会把这条 state 吃掉，环永远不更新。
    progressDigest(rootPlan),
    // 子代理计数的指纹（真进度：已完成/总数；不含时间戳，避免每秒抖动）。
    subagentDigest,
    // 全部对话的指纹：别的对话开了/关了/换状态/进度变了，面板也要跟着更新。
    sessionsDigest,
    // 上下文占用的指纹（**资源指标**：pressureTokens/contextWindow）。
    // 故意由调用方**按能力门控**后传入：没有声明 context 能力的老窗口拿到空串，
    // 签名与 v1 完全一致（不因"占用变了"而多发一条它读不懂的 state）。
    contextDigestValue,
    // v2：todos 全文的指纹（"某条文案变了但计数没变"也要推一次）。
    // 只在 state 渲染时算，不进增量路径。同样取根会话（计划是对话级的，不是焦点会话的）。
    todosDigest(rootTodos),
    // "可相加总量"的指纹（工具数/轮数/token）：别的会话在动时也必须让图标重画，
    // 否则合计数字会停在旧值。空串（缺省）= 与旧签名逐字节一致。
    totalsDigest,
  ].join('|')
}

export class WorkIconReducer {
  constructor({
    includeSubagents = true,
    maxSessions = 256,
    successTtlMs = DEFAULT_SUCCESS_TTL_MS,
    errorTtlMs = DEFAULT_ERROR_TTL_MS,
    toolErrorTtlMs = DEFAULT_TOOL_ERROR_TTL_MS,
    staleStickyMs = DEFAULT_STALE_STICKY_MS,
    now = () => Date.now(),
  } = {}) {
    this.includeSubagents = includeSubagents === true
    this.maxSessions = Number.isFinite(maxSessions) && maxSessions > 0 ? maxSessions : 256
    this.successTtlMs = Number.isFinite(successTtlMs) && successTtlMs >= 0 ? successTtlMs : DEFAULT_SUCCESS_TTL_MS
    this.errorTtlMs = Number.isFinite(errorTtlMs) && errorTtlMs > 0 ? errorTtlMs : DEFAULT_ERROR_TTL_MS
    this.toolErrorTtlMs = Number.isFinite(toolErrorTtlMs) && toolErrorTtlMs > 0 ? toolErrorTtlMs : DEFAULT_TOOL_ERROR_TTL_MS
    this.staleStickyMs = Number.isFinite(staleStickyMs) && staleStickyMs > 0 ? staleStickyMs : DEFAULT_STALE_STICKY_MS
    this.now = now
    this.sessions = new Map()
    /** 子代理账本：**已结算**的终局永久保留，避免会话回收后"已完成"变小。 */
    this.subagentLedger = new SubagentLedger({ now: this.now })
    this.clock = 0
    this.signature = undefined
    /** 窗口声明的能力（协议 v2）；默认空 = 只发 v1 字段。 */
    this.capabilities = new Set()
    /** 没有任何会话时上屏的状态。IDLE=还没见过会话，DISCONNECTED=会话全没了。 */
    this.hostState = WorkState.IDLE
    /**
     * **代表会话**（焦点）的粘性 id。只承载**不可相加**的量
     * （elapsedMs / context / 计划 / 流式文本）；可相加的量走全量合计，与它无关。
     * 粘性的意义：只要它还在当前等级里就继续由它代表，焦点**不再由 `updatedAt` 决定** ——
     * 那正是"两个会话轮流干活时图标来回跳"的机制（见 `#select` 注释）。
     */
    this.focusSessionId = undefined
    /** 当前合并中的等级（`StateTier`）；`undefined` = 没有在合并（只有 0/1 个会话在该等级）。 */
    this.mergeTier = undefined
    /** 合并期间该等级**对外显示的状态**（只升不降，见 `#levelStateOf`）。 */
    this.mergeState = undefined
    /**
     * **花费的全局总量**（跨全部会话 + 各自的子代理后代）。
     * 由宿主按账本求和后经 `setCost` 写入；花费是**可相加**的量 ⇒ 只有一份，与代表会话无关。
     */
    this.totalCost = undefined
  }

  /**
   * 用 `ctx.subagents.listDescendants()` 的名册补齐子代理的名字与模式。
   *
   * 为什么需要它：`subagent/descriptor` 是 **model-hidden 的 log-only 事件**，
   * 生产里我们**收不到**（实测：载荷里 mode/label 双缺 ⇒ 面板只能显示"(未命名)"），
   * 而官方枚举会把 descriptor 折出来、连 label 一起给（`list-children.d.ts:45-52`）。
   *
   * 纪律：`kind === 'diagnostic'`（corrupt/unsupported/unavailable）**不编名字**，
   * 拿不到就保持空态 —— 空态是明确的，假名字不是。
   *
   * @param entries `SubagentDescendantListEntry[]`
   * @returns 有变化才 true（调用方据此决定要不要重推一次 state）
   */
  applySubagentRoster(entries) {
    if (!Array.isArray(entries)) return false
    let changed = false
    for (const entry of entries) {
      if (!entry || entry.kind !== 'child') continue
      const id = entry.id
      if (id === undefined || id === null || String(id).length === 0) continue
      if (this.subagentLedger.noteSession(id, { parentId: entry.parentId, depth: entry.depth })) changed = true
      if (this.subagentLedger.noteDescriptor(id, { label: entry.label, mode: entry.mode })) changed = true
    }
    return changed
  }

  setIncludeSubagents(value) {    const include = value === true
    if (include === this.includeSubagents) return []
    this.includeSubagents = include
    if (!include) {
      for (const [id, record] of this.sessions) {
        if (record.subagent) this.sessions.delete(id)
      }
    }
    return this.#render()
  }

  /** 插件启动时先给窗口一个确定的状态，别让它停在未知态。 */
  initialMessages() {
    this.hostState = WorkState.IDLE
    return this.#render()
  }

  /**
   * 主入口。event 是 DSH 总线上的会话事件，session 是它所属的会话。
   * 任何未知事件类型都返回空数组（安静忽略）。
   */
  handle(session, event) {
    if (!event || typeof event.type !== 'string') return []
    const subagent = isSubagentSession(session)
    const sessionId = sessionIdOf(session)

    // ── 子代理账本：**不受 includeSubagents 影响** ────────────────────────
    // "跟随子代理"只决定它们是否参与**焦点竞争**（图标显示谁），
    // 但面板要能显示"一共几个子代理、干到哪了" —— 用户关掉跟随正是为了不被红图标打扰，
    // 那时更不能连带把子代理进展也一起丢掉。
    if (subagent) {
      this.subagentLedger.noteSession(sessionId, {
        parentId: parentIdOf(session),
        depth: Number(session?.header?.delegationDepth ?? 1),
      })
      switch (event.type) {
        case 'subagent/descriptor':
          this.subagentLedger.noteDescriptor(sessionId, event?.data)
          break
        case 'turn/start':
          this.subagentLedger.noteLive(sessionId, { turnActive: true, at: this.now() })
          break
        case 'tool/call':
          this.subagentLedger.noteToolCall(sessionId)
          break
        case 'turn/end':
          this.subagentLedger.noteTurnEnd(sessionId, reasonKindOf(event), this.now())
          break
        default:
          break
      }
    }

    if (subagent && !this.includeSubagents) {
      // 不参与竞争：只把账本变化反映到当前选中会话的面板上（签名没变就什么都不发）。
      return this.#render()
    }

    const id = sessionIdOf(session)
    const isNewSession = !this.sessions.has(id)
    const record = this.#record(id, session, subagent)
    const seq = Number(event.seq)
    if (Number.isFinite(seq)) record.lastSeq = Math.max(record.lastSeq, seq)
    record.project = projectNameOf(session) ?? record.project

    const messages = this.#dispatch(record, event)
    // 任何事件都算"这个会话还活着"：陈旧淘汰靠它区分"静默的死会话"与"在跑的会话"。
    record.lastEventAt = this.now()
    // 会话第一次出现在总线上，而这条事件本身不改变状态（例如 request/header）：
    // 也要把 IDLE 推给窗口，否则它会一直停在上一个会话留下的画面上。
    if (messages.length === 0 && isNewSession) return this.#render()
    return messages
  }

  #dispatch(record, event) {
    switch (event.type) {
      case 'turn/start':
        return this.#turnStart(record)
      case 'step/start':
        return this.#stepStart(record)
      case 'assistant/chunk':
        // 热路径：实测 152 块/秒、均值 3 字符。这里**只做环形缓冲 append（O(1)）**，
        // 不产出任何消息 —— 文本由插件的 160ms 节流器统一发（见 textSnapshot）。
        this.#absorbChunk(record, event)
        this.#absorbUsage(record, event)
        // 上下文占用的**分子**同样来自 usage 样本（与官方 contextPressure 投影同源同口径）。
        // 这里仍不产出消息：一步之内还有 assistant/message 会收口。
        this.#absorbContextUsage(record, event)
        return []
      case 'assistant/message': {
        // 落定事件是**权威文本**：用它整段覆盖缓冲，顺带自愈任何漏掉的增量。
        this.#absorbSettledText(record, event)
        this.#absorbUsage(record, event)
        this.#absorbContextUsage(record, event)
        const messages = this.#thinkingPulse(record)
        // 占用变了但工作状态没变（最常见：一直在 THINKING 且没有开着的工具）时，
        // #thinkingPulse 会返回 []。环仍要动，所以补一次 #render()——
        // 它自带签名去重，真没变依旧返回 []。
        return messages.length > 0 ? messages : this.#render()
      }
      case 'request/context':
        // 上下文占用的**分母**：ContextPressureProjection.contextWindow 的唯一来源。
        // 该事件只在"路由或容量变化"时写，所以很稀。
        return this.#requestContext(record, event)
      case 'request/header': {
        // 只影响"推理强度"这一条附加信息，本身不改变工作状态。
        const effort = cleanLabel(event?.data?.header?.config?.reasoningEffort, 24)
        if (!effort || effort === record.reasoningEffort) return []
        record.reasoningEffort = effort
        record.updatedAt = ++this.clock
        return this.#render()
      }
      case 'session/title': {
        // SessionTitleEventData：{ title, sourceSeqs, source }，latest-wins。
        // 这是会话标题的唯一来源（Session 本体上没有 title/name 字段）。
        const title = cleanLabel(event?.data?.title, 64)
        if (!title || title === record.title) return []
        record.title = title
        record.updatedAt = ++this.clock
        return this.#render()
      }
      case 'tool/call':
        return this.#toolCall(record, event)
      case 'tool/result':
        return this.#toolResult(record, event)
      case 'user/message':
        return this.#userMessage(record)
      case 'todo/write':
        return this.#todoWrite(record, event)
      case 'todo/tree':
        // coding-tree 预设走这条（树形工具明确拒绝与扁平工具共存）
        return this.#todoTree(record, event)
      case 'subagent/descriptor':
        // 子代理的"任务名"就在这条 SessionEventMap 事件里（label = 委派时的 short description）
        this.subagentLedger.noteDescriptor(record.id, event?.data)
        return []
      case 'turn/end':
        return this.#turnEnd(record, event)
      case 'approval/asked':
        return this.#approvalAsked(record, event)
      case 'approval/decided':
        return this.#approvalDecided(record, event)
      default:
        return []
    }
  }

  /** 会话被回收：最后一个会话消失 = 宿主侧没有活的工作可显示了。 */
  disposeSession(session) {
    const id = sessionIdOf(session)
    // 账本**保留已结算事实**：否则"已完成 N 个"会随会话回收而变小。
    // 注意：即使这个会话因为 includeSubagents=false 没进 this.sessions，也要通知账本。
    this.subagentLedger.remove(id)
    if (!this.sessions.delete(id)) return []
    if (this.sessions.size === 0) this.hostState = WorkState.DISCONNECTED
    return this.#render()
  }

  /**
   * 粗粒度权威信号：`agent/status`（payload.agent / payload.status）。
   *
   * 它只回答"这个 agent 现在有没有在跑"，比事件推断更权威但更粗糙，所以：
   *  - 只用它做**校正与兜底**（补上 turn/start 之前的那一段、修掉没有 turn/end 的悬挂态），
   *  - 绝不动粘性状态（WAITING/ERROR 只有"人处理了"才能解除），
   *  - 绝不动正在进行的回合（turnActive 时事件推断更细），
   *  - 绝不动还没到期的 SUCCESS（那是给人看的 2.5s 闪光，交给 tick 回落）。
   * 因此它既不会让 WAITING 掉回 THINKING，也不会让 WORKING 抢掉别人。
   */
  handleAgentStatus(session, status) {
    const running = status === 'running'
    const subagent = isSubagentSession(session)
    if (subagent && !this.includeSubagents) return []
    const id = sessionIdOf(session)
    // 只在 running 时凭空建记录：一个空闲的新 agent 不值得推消息打扰窗口。
    if (!this.sessions.has(id) && !running) return []
    const record = this.#record(id, session, subagent)
    record.agentStatus = running ? 'running' : 'idle'
    // ⚠️ 刻意**不**在这里更新 lastEventAt：agent/status 由插件每 500ms 对账一次，
    //    拿它当"会话还活着"的证据会让任何注册在案的会话永远不会变陈旧，
    //    从而悄悄废掉粘性的陈旧淘汰（那正是图标卡红事故的根因之一）。
    //    "最近有没有真的动过"只认真正的 session/event。
    record.project = projectNameOf(session) ?? record.project
    if (record.sticky) return []
    if (record.turnActive) return []

    if (running) {
      if (record.state === WorkState.THINKING || record.state === WorkState.WORKING || record.state === WorkState.WAITING) return []
      if (record.state === WorkState.SUCCESS && this.now() < record.successUntil) return []
      this.#apply(record, WorkState.THINKING, {
        phase: 'agent-running',
        activity: undefined,
        toolName: undefined,
      })
      return this.#render()
    }

    // idle：只修正"推断出来但已经没人干活"的状态；SUCCESS 与粘性状态已在上面挡掉。
    if (record.state !== WorkState.THINKING && record.state !== WorkState.WORKING) return []
    record.openTools.clear()
    record.waitingCallId = undefined
    record.waitingApprovalId = undefined
    this.#apply(record, WorkState.IDLE, { phase: 'agent-idle', activity: undefined, toolName: undefined })
    return this.#render()
  }

  /** DSH 侧整体断开（例如 sessions 服务被拆掉）时显式置为 DISCONNECTED。 */
  disconnect() {
    this.sessions.clear()
    this.hostState = WorkState.DISCONNECTED
    return this.#render()
  }

  /**
   * 立起一个粘性状态。**每个粘性都必须带出口**：
   *   - `ttlMs > 0` → tick() 到期自动衰减（ERROR 走这条）；
   *   - `ttlMs === 0` → 靠显式事件解除，同时受 `staleStickyMs` 陈旧淘汰保护（WAITING 走这条）。
   * 这条不变式是本次线上事故（图标永久卡红）的根治点。
   */
  #setSticky(record, state, { kind, ttlMs = 0, resume } = {}) {
    record.sticky = state
    record.stickyKind = kind
    record.stickySince = this.now()
    record.stickyTtlMs = ttlMs
    record.stickyResume = resume ?? record.state
  }

  #clearSticky(record) {
    record.sticky = undefined
    record.stickyKind = undefined
    record.stickySince = 0
    record.stickyTtlMs = 0
    record.stickyResume = undefined
  }

  /** 粘性到期/被确认后的回落：回到立起粘性之前的那个状态（默认 IDLE）。 */
  #decaySticky(record, phase) {
    const target = record.stickyResume ?? WorkState.IDLE
    this.#clearSticky(record)
    this.#apply(record, target === WorkState.ERROR ? WorkState.IDLE : target, {
      phase,
      activity: undefined,
      errorCode: undefined,
    })
  }

  /**
   * 人处理了 → 确认并清除错误（点击图标 / 右键菜单「清除错误状态」都应走这里）。
   * 只清 ERROR；WAITING 是有待回答的问题，不该被"点一下"抹掉。
   */
  acknowledgeError() {
    let changed = false
    for (const record of this.sessions.values()) {
      if (record.sticky !== WorkState.ERROR) continue
      this.#decaySticky(record, 'error-acknowledged')
      changed = true
    }
    if (!changed) return []
    return this.#render()
  }

  /**
   * 时间推进钩子：SUCCESS 回落、**粘性衰减**、陈旧会话淘汰。
   * 由插件的一个低频定时器驱动，也可以被测试直接调用。
   */
  tick(now = this.now()) {
    let changed = false
    for (const record of this.sessions.values()) {
      // ① SUCCESS 的 2.5s 闪光（原有行为）
      if (record.state === WorkState.SUCCESS && record.successUntil > 0 && now >= record.successUntil) {
        record.successUntil = 0
        this.#apply(record, record.resumeState ?? WorkState.IDLE, {
          phase: 'success-expired',
          activity: undefined,
          toolName: undefined,
          task: undefined,
        })
        changed = true
        continue
      }

      const silentMs = now - record.lastEventAt

      // ② 粘性 ERROR 到期 → 回落（**本次事故的核心出口**）
      if (record.sticky === WorkState.ERROR) {
        const expired = record.stickyTtlMs > 0 && now - record.stickySince >= record.stickyTtlMs
        if (expired) {
          this.#decaySticky(record, 'error-expired')
          changed = true
          continue
        }
      }

      // ③ 粘性 WAITING 的陈旧淘汰：会话已经结束（轮不在跑）或者长时间静默且 agent 不在跑，
      //    就不该再以最高优先级占着聚合状态（一个早已结束的子代理不能永久压制主会话）。
      if (record.sticky === WorkState.WAITING) {
        const turnOver = record.turnActive !== true
        const stale = silentMs >= this.staleStickyMs && record.agentStatus !== 'running'
        if (turnOver || stale) {
          this.#decaySticky(record, turnOver ? 'wait-turn-over' : 'wait-stale')
          changed = true
          continue
        }
      }

      // ④ 一般性陈旧淘汰：既没有活跃回合、又长时间没有任何事件的会话，
      //    不该继续用 WORKING 之类的旧状态参与竞争（同一类 bug 的另一种形态）。
      if (record.turnActive !== true && silentMs >= this.staleStickyMs
        && record.state !== WorkState.IDLE && record.state !== WorkState.DISCONNECTED) {
        this.#clearSticky(record)
        record.successUntil = 0
        this.#apply(record, WorkState.IDLE, {
          phase: 'stale-idle',
          activity: undefined,
          toolName: undefined,
          task: undefined,
        })
        changed = true
      }
    }
    if (!changed) return []
    return this.#render()
  }

  /** 心跳载荷：带上新鲜的 elapsedMs，但不参与去重（不产出 state）。 */
  pulsePayload() {
    const selection = this.#select()
    const record = selection.record
    return {
      // 与 `#stateMessage` 同源：合并后的显示状态。
      state: selection.state,
      activity: record.activity,
      session: record.id === 'dsh-host' ? undefined : record.id,
      task: record.task,
      // ⚠️ 耗时**不可相加** ⇒ 代表会话的单值（心跳是计时器，不是合计）。
      elapsedMs: this.#elapsedMs(record),
    }
  }

  /**
   * 窗口声明的能力（协议 v2）。只认得出的三个，其余忽略。
   * 老窗口不发 capabilities → 集合为空 → 新增字段一律不下发（v1 字节级不变）。
   */
  setCapabilities(capabilities) {
    const next = new Set()
    if (capabilities !== undefined && capabilities !== null) {
      for (const value of capabilities) {
        if (isCapability(value)) next.add(value)
      }
    }
    this.capabilities = next
    return this.capabilities
  }

  supports(capability) {
    return this.capabilities.has(capability)
  }

  /**
   * 当前选中会话的流式文本快照（节流器每 160ms 调一次）。
   * 返回 undefined 表示"这一轮没有可发的文本"——调用方据此跳过发送。
   */
  textSnapshot() {
    if (!this.capabilities.has(Capability.TEXT)) return undefined
    const { record } = this.#select()
    const activityText = record.activityText
    const thoughtTail = record.thought ? record.thought.tail(TEXT_CAPS.thoughtTailChars) : ''
    const bodyTail = record.body ? record.body.tail(TEXT_CAPS.bodyTailChars) : ''
    if (!activityText && !thoughtTail && !bodyTail) return undefined
    return {
      activityText,
      thoughtTail: thoughtTail || undefined,
      bodyTail: bodyTail || undefined,
      session: record.id === 'dsh-host' ? undefined : record.id,
    }
  }

  /**
   * 花费写入口：宿主**只做求和**（读 dsh-bottom-info-bar 的账本），这里只负责把它挂起来。
   *
   * ⚠️ 它是**全局总量**（跨全部会话），所以存在 reducer 上，**不挂在某个会话记录上**。
   * 修复前它挂在"焦点会话"的记录上：多会话时焦点一换，新焦点身上没有花费
   * ⇒ 图标的花费整段消失/来回跳（用户说的"价格统计也会抢夺"）。
   * 花费**可相加**（用户拍板），所以只有一份总量，与谁是代表无关。
   */
  setCost(cost) {
    const { record } = this.#select()
    if (record.id === 'dsh-host') return false
    if (sameCost(this.totalCost, cost)) return false
    this.totalCost = cost
    return true
  }

  /**
   * 花费口径需要的会话集合：当前会话 + 它的 origin=subagent 后代
   * （对齐底栏 "ui.sessionIncludingSubagents"）。
   * 沿 parentId 一层层收集，深度优先；id 一律归一化后比较。
   */
  sessionIdsFor(id) {
    const root = normalizeSessionId(id)
    const out = new Set()
    if (root.length === 0) return []
    out.add(root)
    const children = new Map()
    for (const record of this.sessions.values()) {
      const key = normalizeSessionId(record.id)
      const parent = record.parentId
      if (!parent) continue
      const list = children.get(parent)
      if (list === undefined) children.set(parent, [key])
      else list.push(key)
    }
    // 广度优先收集后代（会话数很少，不需要更聪明的结构）。
    const queue = [root]
    while (queue.length > 0) {
      const current = queue.shift()
      for (const child of children.get(current) ?? []) {
        if (out.has(child)) continue
        out.add(child)
        queue.push(child)
      }
    }
    return [...out]
  }

  /**
   * 只读：某个会话当前的粘性状态元信息（诊断/测试用）。
   * `ttlMs === 0` 表示它没有时间出口，只能靠显式事件或陈旧淘汰解除。
   */
  stickyInfoOf(session) {
    const record = this.sessions.get(sessionIdOf(session))
    if (!record || !record.sticky) return undefined
    return {
      state: record.sticky,
      kind: record.stickyKind,
      since: record.stickySince,
      ttlMs: record.stickyTtlMs,
      resume: record.stickyResume,
      silentMs: this.now() - record.lastEventAt,
      turnActive: record.turnActive,
      agentStatus: record.agentStatus,
    }
  }

  /**
   * 当前选中会话的**所属对话**子代理视图（真进度：已完成/总数）。
   *
   * 关键：根不是"选中的那条会话"，而是它**所在对话的顶层会话**。
   * 因为子代理自己也可能是聚合焦点（它是最近活跃的那个），
   * 但用户问"一共几个子代理干到哪了"时，指的是**这个对话**的子代理全体。
   *
   * `total === 0` = 这个对话没有子代理 → 上游不画子代理那一行（不是 "0/0"）。
   */
  subagentsSnapshot() {
    const { record } = this.#select()
    if (record.id === 'dsh-host') return undefined
    return this.subagentLedger.snapshot(this.#conversationRootId(record))
  }

  /** 沿 parentId 一路向上找到所属对话的顶层会话 id。 */
  #conversationRootId(record) {
    let id = normalizeSessionId(record.id)
    const seen = new Set()
    for (;;) {
      if (seen.has(id)) break
      seen.add(id)
      const parent = this.#parentOf(id)
      if (!parent) break
      id = parent
    }
    return id
  }

  #parentOf(id) {
    for (const other of this.sessions.values()) {
      if (normalizeSessionId(other.id) !== id) continue
      return other.parentId ? normalizeSessionId(other.parentId) : undefined
    }
    return this.subagentLedger.parentOf(id)
  }

  /**
   * 把"当前焦点会话"解析成它所属对话的**顶层记录**（没有父的就返回自己）。
   *
   * 为什么计划与活动量必须走根记录：子代理会**抢焦点**（这是刻意的 ——
   * 子代理卡在 WAITING/ERROR 时图标必须变红提醒人）。但焦点是"图标显示谁"，不是
   * "这个对话的计划算谁的"。子代理几乎不写 todo（实测 6/6 一条都没写），
   * 于是焦点一旦落到子代理身上，它那张空计划就把主代理的计划整条盖掉 ——
   * 症状就是"开了跟随子代理之后计划时有时无，甚至恒不显示"。
   */
  #rootRecordOf(record) {
    if (!record || record.id === 'dsh-host') return record
    const rootId = this.#conversationRootId(record)
    for (const other of this.sessions.values()) {
      if (normalizeSessionId(other.id) === rootId) return other
    }
    return record
  }

  /** 当前对话的**计划**：取根会话的 progress（子代理不写 todo，不许用它顶替主代理的计划）。 */
  #planOf(record) {
    const root = this.#rootRecordOf(record)
    return root?.progress
  }

  /**
   * 全部活会话的列表（多对话面板用）。
   *
   * 排序：**活跃优先**（有活跃回合 / 终态灯亮着的排前面），其次最近事件时间。
   * 宿主给"完整列表 + 活跃度排序 + 总数"，**面板显示几行由窗口侧决定**（`limit` 只是有界化）。
   */
  sessionsSnapshot({ limit = TEXT_CAPS.sessions } = {}) {
    const rows = []
    for (const record of this.sessions.values()) {
      const active = record.turnActive === true
        || record.state === WorkState.WORKING
        || record.state === WorkState.THINKING
        || record.state === WorkState.WAITING
        || record.state === WorkState.ERROR
      const subagents = this.subagentLedger.snapshot(normalizeSessionId(record.id))
      const row = {
        id: record.id,
        state: record.state,
        active,
        isSubagent: record.subagent === true,
        lastEventAt: record.lastEventAt,
      }
      if (record.title) row.title = record.title
      if (record.project) row.project = record.project
      if (record.progress) row.progress = record.progress
      if (subagents.total > 0) row.subagents = { total: subagents.total, running: subagents.running, done: subagents.done }
      rows.push(row)
    }
    rows.sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1
      if (left.lastEventAt !== right.lastEventAt) return right.lastEventAt - left.lastEventAt
      return String(left.id).localeCompare(String(right.id))
    })
    // 主会话（非子代理）优先展示：面板第一行应该是"你正在跟它说话的那个"
    rows.sort((left, right) => (Number(left.isSubagent) - Number(right.isSubagent)))
    return {
      total: rows.length,
      items: rows.slice(0, Math.max(0, limit)),
      hidden: Math.max(0, rows.length - Math.max(0, limit)),
    }
  }

  /** 只想看主会话时用（面板默认只列对话，不列子代理）。 */
  mainSessionsSnapshot({ limit } = {}) {
    const all = this.sessionsSnapshot({ limit: Number.MAX_SAFE_INTEGER })
    const items = all.items.filter((item) => !item.isSubagent)
    const bounded = limit === undefined ? items : items.slice(0, Math.max(0, limit))
    return { total: items.length, items: bounded, hidden: Math.max(0, items.length - bounded.length) }
  }

  /**
   * 活动量（**代理指标**：轮/步/工具调用数/耗时）。
   * 与 `progress` 严格分开出境 —— 它没有分母，不许被画成进度条。
   *
   * ⚠️ **可加的量才总计**（用户拍板的核心判据）：
   *   - `turns` / `toolCalls` 可以相加 ⇒ **跨全部会话合计**（含各自的子代理）；
   *   - `elapsedMs` **不可相加**（两个会话同时跑，加起来不是任何真实的东西）
   *     ⇒ 保持代表会话的单值（见 `#select` 的"代表会话"）。
   *
   * 修复前的真实缺陷（`node test/measure-multisession.mjs`）：这两个计数取的是
   * **焦点根会话**的 `metrics`，而焦点每个事件都换 ⇒ 面板上的"轮 · 工具"在
   * A 的 (1,7) 与 B 的 (1,4) 之间来回跳 —— 用户说的"统计也会抢夺"。
   */
  metricsSnapshot() {
    const { record } = this.#select()
    let turns = 0
    let toolCalls = 0
    for (const other of this.sessions.values()) {
      // 轮数：**只算主代理**（子代理的一轮不是"对话的一轮"）——这条口径不变，
      // 只是从"焦点那一个主代理"扩成"全部主代理"。
      if (other.subagent === true) continue
      turns += other.metrics?.turns ?? 0
      toolCalls += other.metrics?.toolCalls ?? 0
      // ⚠️ 子代理的**工具调用数**取自账本，而不是 `record.metrics.toolCalls`：
      //    被追踪的子代理的会话记录**不进 this.sessions**（它只进账本），
      //    所以会话表里根本没有它的计数可加。账本才是它的真相来源。
      //    这里只累加**主会话自己**的 toolCalls（上面 `continue` 掉子代理），
      //    子代理一律走账本 ⇒ 不会重复计入。
      const subs = this.subagentLedger.snapshot(normalizeSessionId(other.id))
      toolCalls += (subs.items ?? []).reduce((sum, item) => sum + (item.toolCalls ?? 0), 0)
    }
    return {
      turns,
      toolCalls,
      // ⚠️ 耗时**不可相加**：它是"这个会话跑了多久"的计时器，不是可累加的量。
      //    两个会话同时跑，39s + 40s 不是任何真实的东西 ⇒ 取代表会话的单值。
      // 计数口径：这里**总是**给数字（0 也是诚实的），
      // 与 state.elapsedMs 的"没在跑就不给"区分开 —— 那个字段语义是"计时器"。
      elapsedMs: this.#elapsedMs(record) ?? 0,
    }
  }

  /**
   * **可相加**的活动量：全部会话的 token 合计（含子代理会话自己的用量）。
   *
   * 与 `metricsSnapshot` 同一条纪律 —— 可加的量才总计。
   * 一个会话都没有样本时返回 `undefined`（"还没有数字"≠"0"，窗口按 undefined 不画）。
   * 恒有 `total === input + output`（替换式累加的不变式在求和后依然成立）。
   */
  tokensSnapshot() {
    let any = false
    const sum = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
    for (const record of this.sessions.values()) {
      const tokens = record.tokens
      if (!tokens) continue
      any = true
      sum.input += tokens.input ?? 0
      sum.output += tokens.output ?? 0
      sum.total += tokens.total ?? 0
      sum.cacheRead += tokens.cacheRead ?? 0
      sum.cacheWrite += tokens.cacheWrite ?? 0
      sum.reasoning += tokens.reasoning ?? 0
    }
    if (!any) return undefined
    // 三个键的契约（total = input + output）在求和之后重新推导，绝不各自累加。
    return {
      input: sum.input,
      output: sum.output,
      total: sum.input + sum.output,
      cacheRead: sum.cacheRead,
      cacheWrite: sum.cacheWrite,
      reasoning: sum.reasoning,
    }
  }

  /**
   * **花费**口径需要的全部会话 id：跨**全部对话**（每个对话 = 一个会话 + 它的全部后代子代理）。
   *
   * 修复前宿主用的是 `sessionIdsFor(snapshot().sessionId)` —— **焦点会话**那一棵子树，
   * 于是两边的花费在账本里各算各的、图标显示谁就报谁（"价格统计也会抢夺"）。
   * 用户拍板：花费是**可相加**的量 ⇒ 跨全部会话总计。
   *
   * 口径仍是 `dsh-bottom-info-bar` 的 `ui.sessionIncludingSubagents`（一个会话含其后代），
   * 只是把"当前这一个会话"换成"全部会话"求并集（`Set` 去重，不会重复计同一条账）。
   */
  costSessionIds() {
    const out = new Set()
    for (const record of this.sessions.values()) {
      for (const id of this.sessionIdsFor(record.id)) out.add(id)
    }
    return [...out]
  }

  /** 只读：当前对话的计划进度（协议字段 `progress` 的来源；**取根会话**，不是焦点会话）。 */
  progressSnapshot() {
    const { record } = this.#select()
    return this.#planOf(record)
  }

  /**
   * 只读：当前选中会话的**上下文占用**（协议字段 `context` 的来源）。
   * 与 `progressSnapshot` 是两件事：那个是工作进度，这个是资源指标。
   * @returns `{ applicable:true, used, limit, ratio }` / `{ applicable:false, reason }` / undefined
   */
  contextSnapshot() {
    const { record } = this.#select()
    return record.context
  }

  /** 只读快照，供测试与日志使用（不含任何活动对象）。 */
  snapshot() {
    const selection = this.#select()
    const record = selection.record
    return {
      // ⚠️ 显示状态（等级合并后的），不是代表会话自己的 state。
      state: selection.state,
      /** 代表会话自己的状态（诊断/测试用：合并时它会与 `state` 不同）。 */
      sessionState: record.state,
      /** 是否正在做"同等级合并"（该等级里 ≥ MERGE_MIN_SESSIONS 个会话）。 */
      merged: selection.merged,
      /** 参与合并的等级成员数（0 = 没有会话）。 */
      tierMembers: selection.members,
      activity: record.activity,
      sessionId: record.id,
      task: record.task,
      project: record.project,
      title: record.title,
      phase: record.phase,
      agentStatus: record.agentStatus,
      /** 当前动作用的工具名 / 一行活动文本（诊断"粘住时还在干活吗"用）。 */
      toolName: record.toolName,
      activityText: record.activityText,
      sticky: record.sticky,
      sessionCount: this.sessions.size,
    }
  }

  // ── 事件分支 ──────────────────────────────────────────────────────────

  #turnStart(record) {
    record.turnActive = true
    record.metrics.turns += 1
    if (record.subagent) this.subagentLedger.noteLive(record.id, { turnActive: true, at: this.now() })
    record.openTools.clear()
    record.waitingCallId = undefined
    record.waitingApprovalId = undefined
    // 新一轮开始 = 上一轮的等待/错误已经被处理掉了，粘性在这里解除。
    this.#clearSticky(record)
    record.successUntil = 0
    record.task = undefined
    // ⚠️ 这里**故意不清** `record.progress`（曾经写过 `record.progress = undefined`，是 bug）。
    //
    // 为什么：`progress` 不是"本轮的临时量"，它是**会话级**的 —— 由 `todo/*` 那**一份全量快照**
    // 算出来的（`src/progress.js:130-156`：`progressPayload` 每次拿的都是完整 todos）。
    // 计划属于**这场对话**，不属于"这一轮"：
    //   · 用户发一条消息 ⇒ 主会话（= 对话根）开新一轮 ⇒ 上一轮的清空把根计划抹掉 ⇒
    //     `#stateMessage` 落到 `?? { applicable:false, reason:'no-todos' }`（`reducer.js:1760`），
    //     窗口按纪律**不画环**、悬停层写「计划 —（本宿主不适用）」。
    //     而模型只有在**计划真的变了**时才会再发一次 `todo/tree` ⇒ 整个回合环都不在。
    //   · 实证（`node test/repro-turnstart-plan.mjs`）：turn/start 前
    //     `{applicable:true,mode:'tree',done:4,total:8}` → 之后 `{applicable:false,reason:'no-todos'}`。
    //   · 同一份快照的兄弟字段 `record.todos` **本来就没在这里清**（取根会话那处 `reducer.js:1751-1753`
    //     照旧下发），只清单算出来的 `progress` 本身就是不对称的。
    // 计划真的没了怎么办：那是 `todo/write {todos:[]}` 的事 —— `progressPayload` 会如实回
    // `{applicable:false,reason:'no-todos'}`（见 test/progress.test.js「退化②」）。
    // 没有 todo 时依然是 `applicable:false` ⇒ 「没有计划 ⇒ 不画环」的规则不受影响。
    record.toolName = undefined
    // v2：新一轮从干净文本开始（否则上一轮的思考会一直挂在展开面板里）。
    record.thought.reset()
    record.body.reset()
    record.activityText = undefined
    record.startedAt = this.now()
    this.hostState = WorkState.IDLE
    this.#apply(record, WorkState.THINKING, { phase: 'turn-start' })
    return this.#render()
  }

  /**
   * `assistant/chunk` 的各分支（权威类型 StreamChunk）：
   *   block-start      { index, blockType }              → 新块：清掉对应缓冲
   *   reasoning-delta  { index, text }                    → 追加思考（O(1)）
   *   text-delta       { index, text }                    → 追加正文（O(1)）
   *   block-end        { index, block }                   → 该块整段文本：权威覆盖
   *   tool-call-delta / usage / finish                    → 与文本无关，忽略
   *
   * 不认识的分支安静忽略（未来新增 chunk 类型不该让插件出问题）。
   */
  #absorbChunk(record, event) {
    const chunk = event?.data?.chunk
    if (!chunk || typeof chunk !== 'object') return
    switch (chunk.type) {
      case 'reasoning-delta':
        record.thought.append(typeof chunk.text === 'string' ? chunk.text : '')
        return
      case 'text-delta':
        record.body.append(typeof chunk.text === 'string' ? chunk.text : '')
        return
      case 'block-start':
        if (chunk.blockType === 'reasoning') record.thought.reset()
        else if (chunk.blockType === 'text') record.body.reset()
        return
      case 'block-end': {
        const block = chunk.block
        if (!block || typeof block !== 'object') return
        if (block.type === 'reasoning' && typeof block.text === 'string') record.thought.set(block.text)
        else if (block.type === 'text' && typeof block.text === 'string') record.body.set(block.text)
        return
      }
      default:
        return
    }
  }

  /**
   * `assistant/message` 的 content 是权威文本（实测 695 个 reasoning 块、均值 3.6 KB）。
   * 一次遍历拼出该消息的全部思考/正文文本，整段覆盖缓冲。
   */
  #absorbSettledText(record, event) {
    const content = event?.data?.message?.content
    if (!Array.isArray(content) || content.length === 0) return
    let thought
    let body
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'reasoning' && typeof block.text === 'string') {
        thought = thought === undefined ? block.text : thought + block.text
      } else if (block.type === 'text' && typeof block.text === 'string') {
        body = body === undefined ? block.text : body + block.text
      }
    }
    if (thought !== undefined) record.thought.set(thought)
    if (body !== undefined) record.body.set(body)
  }

  /**
   * `step/start`：agent 又往下走了一步。
   * 工具级错误的红灯在这一刻就该收 —— "agent 已经继续干活了"是最强的"人/流程已处理"信号，
   * 比等 TTL 更准。（轮级错误不会走到这里：那一轮已经结束了。）
   */
  #stepStart(record) {
    if (record.sticky === WorkState.ERROR && record.stickyKind === 'tool') {
      this.#decaySticky(record, 'step-after-tool-error')
    }
    return this.#thinkingPulse(record)
  }

  #thinkingPulse(record) {
    if (record.openTools.size > 0) return []
    // 粘性只阻止"用绿色覆盖错误"，**不阻止记录新活动**：
    // 状态仍是 ERROR/WAITING，但要继续把新的 toolName/activity 推出去
    //（老实现直接 return []，于是粘住期间窗口完全看不到"正在做什么"）。
    if (record.sticky) return this.#render()
    if (record.state === WorkState.THINKING) return []
    this.#apply(record, WorkState.THINKING, {
      phase: 'thinking',
      activity: undefined,
      toolName: undefined,
    })
    return this.#render()
  }

  #toolCall(record, event) {
    const callId = toolCallIdOf(event, `seq-${String(event.seq ?? 'unknown')}`)
    const name = toolNameOf(event)
    const args = toolArgsOf(event)
    record.openTools.set(callId, name)
    // 活动量（**代理指标**，不是进度）：只统计，不外显为百分比。
    record.metrics.toolCalls += 1
    // ⚠️ 这里**刻意不再**记账本（曾经写过 `if (record.subagent) this.subagentLedger.noteToolCall(...)`）：
    //    子会话的 `tool/call` 已经在 `handle()` 的子代理账本分支里记过一次，
    //    这里再记一次 ⇒ 一次真实调用被算成 **2 次**，而且账本数字还会随
    //    `includeSubagents`（一个纯显示开关）变化。实测（`node` 一次性脚本）：
    //      includeSubagents=true  → 1 次调用记成 2
    //      includeSubagents=false → 1 次调用记成 1
    //    现在"工具数"是跨全部会话的**对外合计**，这个双计会直接让用户看到翻倍的数字。
    //    `handle()` 那条在两种模式下都会执行，所以删掉这一条是安全的（唯一真相来源）。
    // v2：一行动作文本。每次工具调用只解析一次 arguments（一轮里几十次，不是热路径）。
    record.activityText = activityLineFor(name, args)
    const activity = activityForTool(name, args)

    // 粘性优先：等确认/报错期间新来的工具调用不允许把状态拉回 WORKING，
    // 但**必须把"当前在干什么"记下来并上屏**（见 #thinkingPulse 的注释）。
    if (record.sticky) {
      record.toolName = name
      record.activity = activity
      return this.#render()
    }

    if (isUserQuestionTool(name)) {
      record.waitingCallId = callId
      record.toolName = name
      this.#setSticky(record, WorkState.WAITING, { kind: 'wait', resume: record.state })
      this.#apply(record, WorkState.WAITING, { phase: 'user-question', toolName: name, activity: undefined })
      return this.#render()
    }

    record.toolName = name
    this.#apply(record, WorkState.WORKING, { phase: 'tool-call', activity, toolName: name })
    return this.#render()
  }

  #toolResult(record, event) {
    const callId = toolCallIdOf(event)
    if (callId) {
      record.openTools.delete(callId)
      if (callId === record.waitingCallId) {
        record.waitingCallId = undefined
        if (record.sticky === WorkState.WAITING) this.#clearSticky(record)
      }
      if (callId === record.waitingApprovalId) {
        record.waitingApprovalId = undefined
        if (record.sticky === WorkState.WAITING) this.#clearSticky(record)
      }
    }

    const error = toolErrorOf(event)
    if (error) {
      // 工具级失败 = **短红灯**（默认 5s）后自动回落到出错前的状态。
      // 依据：长会话里单条命令失败非常常见（grep 没命中、测试红、命令非零退出），
      // 让它们永久/长期染红整个图标，等于把"红"变成噪声。
      // 真正该长期红的是"轮以 error 结束"（见 #turnEnd）。
      this.#setSticky(record, WorkState.ERROR, {
        kind: 'tool',
        ttlMs: this.toolErrorTtlMs,
        resume: record.state === WorkState.ERROR ? WorkState.WORKING : record.state,
      })
      this.#apply(record, WorkState.ERROR, {
        phase: 'tool-error',
        activity: record.activity,
        toolName: record.toolName,
        errorCode: error.code,
      })
      return this.#render()
    }

    // 还在等确认 / 错误红灯未到期：状态保持不动，但仍把可见字段刷出去。
    if (record.sticky) return this.#render()

    return this.#resume(record, 'tool-result')
  }

  #userMessage(record) {
    // 用户开口了 = 上一轮的等待/错误已被处理，粘性解除。
    const hadSticky = record.sticky !== undefined
    this.#clearSticky(record)
    record.successUntil = 0
    record.waitingApprovalId = undefined
    if (record.waitingCallId) {
      record.openTools.delete(record.waitingCallId)
      record.waitingCallId = undefined
    }
    if (!hadSticky) return []
    return this.#resume(record, 'user-message')
  }

  #todoWrite(record, event) {
    const todos = Array.isArray(event?.data?.todos) ? event.data.todos : []
    // v2：完整快照（≤12 条）——即便进度计数没变，列表文案变了也要推。
    record.todos = todosPayload(todos)
    // 计划进度（真进度）：分母跳变如实上报，**不单调化**。
    this.#setProgress(record, progressPayload({ mode: 'flat', todos, previous: record.progress, now: this.now() }))
    const label = record.progress?.applicable
      ? (record.progress.inProgress ?? nextPendingLabel(todos, false))
      : undefined
    if (label && label !== record.task) record.task = label
    // 去重交给 #render 的签名（签名里含 progressDigest）—— 没变就不会发消息。
    return this.#render()
  }

  /**
   * `todo/tree`（coding-tree 预设的树形计划）→ **叶子计数**的进度。
   * 树的硬不变式：`completed 父节点 ⇒ 子节点全 completed`，所以父节点是推导出来的，
   * 按叶子计数才贴近真实工作量（与 `dsh-tool-todo-tree` 自己的 countStatus 口径一致）。
   */
  #todoTree(record, event) {
    const todos = Array.isArray(event?.data?.todos) ? event.data.todos : []
    record.todos = treeTodosPayload(todos)
    this.#setProgress(record, progressPayload({ mode: 'tree', todos, previous: record.progress, now: this.now() }))
    // 活动行兜底：树形计划下 task 用"当前 in_progress 的那一条"
    const label = record.progress?.applicable ? (record.progress.inProgress ?? nextPendingLabel(todos, true)) : undefined
    if (label && label !== record.task) record.task = label
    return this.#render()
  }

  /** 写入计划进度；只有"对外可见"的变化才触发重推。 */
  #setProgress(record, next) {
    const before = progressDigest(record.progress)
    record.progress = next
    if (progressDigest(next) !== before) record.updatedAt = ++this.clock
  }

  #turnEnd(record, event) {
    record.turnActive = false
    record.openTools.clear()
    record.waitingCallId = undefined
    record.waitingApprovalId = undefined
    const kind = reasonKindOf(event)
    // 子代理账本：`subagent/end` 收不到时的退路（同一套 stopReason 词汇）。
    // 可续会话的"一轮结束"不算子代理结束，账本内部会自己判断。
    if (record.subagent) this.subagentLedger.noteTurnEnd(record.id, kind, this.now())

    if (kind === 'blocked') {
      this.#setSticky(record, WorkState.WAITING, { kind: 'wait', resume: record.state })
      this.#apply(record, WorkState.WAITING, { phase: 'turn-end', activity: undefined, toolName: undefined })
      return this.#render()
    }

    // 用户在等确认/错误红灯还没到期，而本轮已经结束了 → 红灯的出口不止 TTL：
    // 先把 TTL 重新对齐到"轮级"时长（让用户看得到），到期由 tick 衰减到 IDLE。
    // 老实现这里直接 `return []`，粘性既不清也没 TTL → **状态永久冻结**（本次线上事故）。
    if (record.sticky === WorkState.ERROR) {
      if (kind === 'completed') {
        record.stickyTtlMs = this.errorTtlMs
        record.stickySince = this.now()
        record.stickyResume = WorkState.IDLE
        return this.#render()
      }
      if (kind === 'error') {
        // 轮级的真错误比工具级闪烁严重：升级成轮级 TTL（而不是被短 TTL 提前收掉）。
        record.stickyKind = 'turn'
        record.stickyTtlMs = this.errorTtlMs
        record.stickySince = this.now()
        record.stickyResume = WorkState.IDLE
        record.reasonKind = kind
        return this.#render()
      }
      // aborted / interrupted / max-tokens：本轮不是故障收尾 → 红灯到此为止。
      this.#clearSticky(record)
      record.successUntil = 0
      this.#apply(record, WorkState.IDLE, {
        phase: 'turn-end',
        activity: undefined,
        toolName: undefined,
        reasonKind: kind,
      })
      return this.#render()
    }

    if (kind === 'aborted' || kind === 'interrupted') {
      // aborted = 用户主动打断；interrupted = 流被打断（常伴随用户操作）。
      // 两者都不是"出故障"，不该红。
      this.#clearSticky(record)
      record.successUntil = 0
      this.#apply(record, WorkState.IDLE, {
        phase: 'turn-end',
        activity: undefined,
        toolName: undefined,
        reasonKind: kind,
      })
      return this.#render()
    }

    if (kind === 'max-tokens') {
      // 严重度判断：**输出被截断 ≠ 出故障**。
      // 实测触发场景就是"子代理完工报告太长撞上输出上限" —— 那是正常工况，
      // 让它把整个图标染红（且旧代码会永久红）是明显的误报。
      // 这里给中性 IDLE（不给绿，因为活儿未必干完了；不给红，因为没坏），
      // reasonKind 保留下来，窗口想提示可以自行提示。
      this.#clearSticky(record)
      record.successUntil = 0
      this.#apply(record, WorkState.IDLE, {
        phase: 'turn-end',
        activity: undefined,
        toolName: undefined,
        reasonKind: kind,
      })
      return this.#render()
    }

    if (kind !== 'completed') {
      // 只有真正的 error 才让图标长期红，并且**一定带 TTL**（有出口）。
      this.#setSticky(record, WorkState.ERROR, {
        kind: 'turn',
        ttlMs: this.errorTtlMs,
        resume: WorkState.IDLE,
      })
      this.#apply(record, WorkState.ERROR, {
        phase: 'turn-end',
        activity: undefined,
        toolName: undefined,
        reasonKind: kind,
      })
      return this.#render()
    }

    this.#clearSticky(record)
    record.successUntil = this.now() + this.successTtlMs
    record.resumeState = WorkState.IDLE
    this.#apply(record, WorkState.SUCCESS, {
      phase: 'turn-end',
      activity: undefined,
      toolName: undefined,
      task: undefined,
    })
    return this.#render()
  }

  #approvalAsked(record, event) {
    const id = String(event?.data?.id ?? '')
    // 'approval/asked': { id, toolName, callId?, reason? }
    const toolName = cleanLabel(event?.data?.toolName, 48) ?? 'approval'
    if (id) record.waitingApprovalId = id
    this.#setSticky(record, WorkState.WAITING, { kind: 'wait', resume: record.state })
    record.toolName = toolName
    this.#apply(record, WorkState.WAITING, { phase: 'approval', activity: undefined, toolName })
    return this.#render()
  }

  #approvalDecided(record, event) {
    const id = String(event?.data?.id ?? '')
    if (!record.waitingApprovalId || (id && id !== record.waitingApprovalId)) return []
    record.waitingApprovalId = undefined
    if (record.sticky === WorkState.WAITING) this.#clearSticky(record)
    return this.#resume(record, 'approval-decided')
  }

  /**
   * 等待/工具结束后回到"正常运转"的那一档：还有工具开着就是 WORKING（activity 取第一个
   * 还开着的工具），否则就是 THINKING。三个分支（工具结束、审批结束、用户答复）共用。
   */
  #resume(record, phase) {
    const working = record.openTools.size > 0
    const activity = working ? activityForTool(record.openTools.values().next().value) : undefined
    this.#apply(record, working ? WorkState.WORKING : WorkState.THINKING, {
      phase,
      activity,
      toolName: record.toolName,
    })
    return this.#render()
  }

  // ── 内部机制 ──────────────────────────────────────────────────────────

  #absorbUsage(record, event) {
    const usage = usageOf(event)
    if (!usage) return
    const seq = Number(event?.seq)
    // 同一 seq 只累加一次，避免重放/重复事件把 token 数翻倍。
    if (Number.isFinite(seq)) {
      if (record.usageSeqs.has(seq)) return
      record.usageSeqs.add(seq)
      if (record.usageSeqs.size > 4096) record.usageSeqs.clear()
    }
    // 官方口径：以 (turn, step) 为槽位，同一个槽位的**重复样本替换而不是累加**
    // （chunk 早样本 + message 终样本是同一个槽位的两份样本，直接加会算两遍）。
    // 依赖的日志不变式（官方注释明写）：一个 (turn, step) 的 usage 报告是相邻的，
    // 一旦进入更晚的 step，合法的日志不会再回到更早的 step。
    const turn = Number.isFinite(Number(event?.data?.turn)) ? Number(event.data.turn) : undefined
    const step = Number.isFinite(Number(event?.data?.step)) ? Number(event.data.step) : undefined
    const slot = record.usageSlot
    const previous = slot && slot.turn === turn && slot.step === step ? slot.buckets : undefined
    if (previous !== undefined && sameUsageBuckets(previous, usage)) return
    record.tokens = addReplacingUsage(record.tokens, previous, usage)
    record.usageSlot = { turn, step, buckets: usage }
  }

  // ── 上下文占用（**资源指标**：真分母 pressureTokens/contextWindow）──────────

  /**
   * 分子：usage 样本 → pressureTokens。
   *
   * 口径**逐行照抄** `dsh-token-meter` 的 `contextPressure` 投影
   * （`usage-projection.js:56` `pressureFrom`）：
   *   `pressureTokens = inputTokens + cacheReadTokens + cacheWriteTokens`
   * 只取 **prompt 侧**（不含 outputTokens）—— 占用的是"下一次请求要送进去的东西"。
   *
   * 两条 usage 路径都认（`chunk.type === 'usage'` 与 `assistant/message`），
   * 与官方 `usageOf` 一致；只走 `data.usage` 会漏掉"请求失败只留下 chunk"的回合。
   *
   * 拿不到就是拿不到：不累加、不估算，直接不改动现有分母/分子（**不写 0**）。
   */
  #absorbContextUsage(record, event) {
    const pressure = pressureTokensOf(usageSampleOf(event))
    if (pressure === undefined) return
    this.#setContext(record, { used: pressure })
  }

  /**
   * 分母：`request/context` → `ContextPressureProjection.contextWindow` 的唯一来源。
   * `data` 就是 RequestContext 本身（`types.d.ts:335`）：`{ provider, model, contextWindow? }`。
   *
   * @returns 待发送的消息（分母变了才推，所以很省）
   */
  #requestContext(record, event) {
    const route = routeOf(event)
    const changed = route.limit !== record.contextLimit
      || route.model !== record.contextModel
    if (!changed) return []
    record.contextLimit = route.limit
    record.contextModel = route.model
    record.contextProvider = route.provider
    // 分母变了 = 环的"上限"变了，必须让窗口知道（路由切换后 200k→1M 这种）。
    this.#setContext(record, {})
    return this.#render()
  }

  /**
   * 统一写入口：把当前分子/分母组装成线上载荷。
   * 两者缺一 → `{ applicable:false, reason }`，**字段级不下发 used/limit/ratio**。
   */
  #setContext(record, patch = {}) {
    const used = 'used' in patch ? patch.used : record.contextUsed
    const limit = 'limit' in patch ? patch.limit : record.contextLimit
    if ('used' in patch) record.contextUsed = patch.used
    if ('limit' in patch) record.contextLimit = patch.limit
    const next = contextPayload({ used, limit })
    if (contextDigest(next) === contextDigest(record.context)) return false
    record.context = next
    record.updatedAt = ++this.clock
    return true
  }

  #elapsedMs(record) {
    if (!record.startedAt || record.state === WorkState.IDLE || record.state === WorkState.DISCONNECTED) return undefined
    const elapsed = this.now() - record.startedAt
    return elapsed > 0 ? elapsed : undefined
  }

  #record(id, session, subagent) {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const record = {
      id,
      state: WorkState.IDLE,
      activity: undefined,
      task: undefined,
      progress: undefined,
      /**
       * 上下文占用载荷（**资源指标**，与 progress 严格分开）。
       * `{ applicable:true, used, limit, ratio }` 或 `{ applicable:false, reason }`。
       * 起步态永远是 `undefined`（还没收到 request/context → 没有分母 → 不下发）。
       */
      context: undefined,
      /** 上下文占用的**分子**（pressureTokens，来自 usage 样本）；undefined = 还没样本。 */
      contextUsed: undefined,
      /** 上下文占用的**分母**（contextWindow，来自 request/context）；undefined = 不知道上限。 */
      contextLimit: undefined,
      /** 分母的身份（只进日志与"分母变了"的判断，不上线路）。 */
      contextProvider: undefined,
      contextModel: undefined,
      toolName: undefined,
      project: projectNameOf(session),
      /** 来自 `session/title` 事件（Session 本体没有标题字段）。 */
      title: undefined,
      /** 最近一次 agent/status 的粗粒度信号：'running' | 'idle' | undefined。 */
      agentStatus: undefined,
      reasoningEffort: undefined,
      tokens: undefined,
      /**
       * 最近一次 usage 样本的槽位 `{ turn, step, buckets }`（官方 `tokenUsage.last` 同义）。
       * 同一个 (turn, step) 再来一份样本时**替换**掉这一份，而不是再加一遍 ——
       * chunk 早样本与 message 终样本是同一个槽位的两份样本。
       */
      usageSlot: undefined,
      errorCode: undefined,
      reasonKind: undefined,
      successUntil: 0,
      resumeState: undefined,
      sticky: undefined,
      /** 粘性的元信息：kind('tool'|'turn'|'wait') / since / ttl / 回落目标。 */
      stickyKind: undefined,
      stickySince: 0,
      stickyTtlMs: 0,
      stickyResume: undefined,
      /** 最近一次收到该会话事件的时刻：陈旧淘汰（staleStickyMs）的依据。 */
      lastEventAt: this.now(),
      turnActive: false,
      openTools: new Map(),
      waitingCallId: undefined,
      waitingApprovalId: undefined,
      usageSeqs: new Set(),
      subagent,
      /** 父会话 id（子代理会话才有）；花钱口径要沿它收集后代。 */
      parentId: parentIdOf(session),
      /**
       * v2 文本载体。刻意用环形缓冲而不是字符串：
       * 事件路径只做 `append`（O(1)），只在节流点读尾部。
       */
      thought: new TextRing(TEXT_CAPS.ringCapacity),
      body: new TextRing(TEXT_CAPS.ringCapacity),
      /** 最近一次工具调用的"一行动作"（`正在执行 pwsh: npm test`）。 */
      activityText: undefined,
      /** 完整 todo 快照的紧凑载荷（≤12 条）。 */
      todos: undefined,
      /**
       * 计划进度（**真进度**：计划完成度）。
       * `{ applicable:false, reason:'no-todos' }` = 没有 todo → 上游据此**不画条**（不是 0%）。
       */
      progress: undefined,
      /**
       * 活动量（**代理指标，不是进度**）：轮/步/工具调用数与起始时刻。
       * 刻意与 progress 分开存放，协议里也分开出境。
       */
      metrics: { turns: 0, steps: 0, toolCalls: 0 },
      startedAt: 0,
      lastSeq: -1,
      updatedAt: ++this.clock,
    }
    this.sessions.set(id, record)
    this.hostState = WorkState.IDLE
    if (this.sessions.size > this.maxSessions) this.#evict(record)
    return record
  }

  #evict(keep) {
    const others = [...this.sessions.values()].filter((record) => record !== keep)
    const idle = others
      .filter((record) => record.state === WorkState.IDLE || record.state === WorkState.DISCONNECTED)
      .sort((left, right) => left.updatedAt - right.updatedAt)
    const victim = idle[0] ?? others.sort((left, right) => left.updatedAt - right.updatedAt)[0]
    if (victim) this.sessions.delete(victim.id)
  }

  #apply(record, state, patch = {}) {
    record.state = state
    if ('activity' in patch) record.activity = patch.activity
    if ('toolName' in patch) record.toolName = patch.toolName
    if ('task' in patch) record.task = patch.task
    record.phase = patch.phase
    record.errorCode = patch.errorCode
    record.reasonKind = patch.reasonKind
    record.updatedAt = ++this.clock
  }

  /**
   * 选出上屏的**等级状态**与**代表会话**。
   *
   * 旧实现只有一句 `[...this.sessions.values()].sort(compareRecords)[0]`，
   * 即"最需要人注意的那个会话独占上屏"。多根会话并存时它有两个真实缺陷
   * （都是实测出来的，不是推测 —— `node test/measure-multisession.mjs` /
   * `node test/measure-flicker.mjs`）：
   *
   *   ① **焦点每来一个事件就换一次**：`compareRecords` 在 rank 相同时用
   *      `updatedAt` 决胜，两个会话同等级 ⇒ 谁刚动过谁赢。实测序列
   *      （12500ms=root-a、15500ms=root-b、18500ms=root-a、20000ms=root-b…）
   *      焦点在 A/B 之间来回换，而 `#stateMessage` 里 session / activity / tokens /
   *      cost / context / 流式文本**全部跟着焦点走** ⇒ 用户说的"相互抢夺页面"。
   *   ② **等级内的状态值也会回跳**：BUSY 档内 WORKING ⇄ THINKING 随
   *      "有没有开着的工具"在两边的轮流开合而翻转（实测 6 次）。
   *
   * 新规则（三条，逐条对应上面两个缺陷与用户的两条禁令）：
   *   ① **等级优先不变**：先取 rank 最高的那个状态所属的**等级**
   *      （URGENT > BUSY > DONE > IDLE，与 `STATE_RANK` 同序）——
   *      WAITING/ERROR 依旧不被任何"在跑"的会话抢走，SUCCESS 也不会和 WORKING 混。
   *   ② **同等级合并**：该等级里达到 `MERGE_MIN_SESSIONS` 个会话时，对外显示的状态
   *      在这一段"该等级占据最高位"的期间**只升不降**（`#levelStateOf`）——
   *      两边轮流开合工具不再让图标在 运行中/思考中 之间回跳。
   *   ③ **代表会话粘性**：只要 `focusSessionId` 还在这个等级里，就继续由它代表；
   *      只有它离开该等级（结束/被淘汰/换等级）时才重新挑一个。
   *
   * @returns {{record: object, state: string, merged: boolean, members: number}}
   *   `state` 是**对外显示的状态**（可能与 `record.state` 不同：合并时取等级的天花板）；
   *   `record` 是代表会话，只用来取**不可相加**的量。
   */
  #select() {
    if (this.sessions.size === 0) {
      this.focusSessionId = undefined
      this.mergeTier = undefined
      this.mergeState = undefined
      return {
        record: {
          id: 'dsh-host',
          state: this.hostState,
          activity: undefined,
          task: undefined,
          project: undefined,
          progress: undefined,
          tokens: undefined,
          startedAt: 0,
          updatedAt: 0,
        },
        state: this.hostState,
        merged: false,
        members: 0,
      }
    }
    // compareRecords 已按 (rank 降序, updatedAt 降序, id 升序) 排好 ⇒ [0] 就是"最需要人注意"的那个。
    const records = [...this.sessions.values()].sort(compareRecords)
    const tier = tierOfState(records[0].state)
    // 等级内的成员（保持 compareRecords 的顺序 ⇒ members[0] 是等级内 rank 最高者）。
    const members = records.filter((record) => tierOfState(record.state) === tier)
    // **合并只在"不同对话之间"生效**：用户报的是"开多个会话相互抢夺页面"，
    // 那是**多个对话**争一个图标。同一个对话内部（主代理 vs 它的子代理）的取舍是
    // **刻意的原有行为**（"子代理会抢焦点"：子代理卡在 WAITING/ERROR 时图标必须变红提醒人），
    // 不属于"两个会话抢一个页面"，所以一字不改。
    const roots = new Set(members.map((record) => this.#conversationRootId(record)))
    const merge = MERGE_TIERS.has(tier) && members.length >= MERGE_MIN_SESSIONS && roots.size >= MERGE_MIN_SESSIONS
    // ⚠️ 必须在 `#levelStateOf` **改 `this.mergeTier` 之前**读："上一次就已经在同一个等级里合并了"
    //    才是"沿用代表"的唯一条件（换等级 = 真实事件，那时该重挑）。
    const wasMergingThisTier = merge && this.mergeTier === tier
    const state = this.#levelStateOf(tier, members, merge)
    // 代表会话的候选 = **状态与显示状态相同**的那些成员。
    // ⚠️ 必须按 state 而不是按 tier 取候选：等级内 WORKING(30) 与 THINKING(20) 虽同属 BUSY，
    //    但"谁在跑工具"是不同的灯 —— 若按 tier 取候选，代表会停在一个 THINKING 会话上，
    //    而另一个会话明明在 WORKING（`test/reducer-priority.test.js` 钉住了这条）。
    let candidates = members.filter((record) => record.state === state)
    if (candidates.length === 0) candidates = members
    // 代表**粘性**（只在合并时）：等级没变就沿用当前代表 —— 焦点不再由 `updatedAt`、
    // 也不由"这一瞬间谁手上开着工具"决定。这正是"两边轮流干活时图标来回换人"的根治点。
    //   · 实测（修复前 `test/measure-flicker.mjs`）：两个根会话轮流开合工具时，
    //     图标 session 在 root-a / root-b 之间**每个事件换一次**，state 值也跳 6 次。
    //   · 只有**最高位换等级**时才允许重挑（"等待/错误被处理掉了""有人开始干活了"——
    //     那是真实事件，不是两边轮流）。
    //   · 合并刚开始的那一次也优先沿用旧代表（前提：它仍在候选里），避免"第二个会话一开
    //     就把图标换人"这种无谓的切换。
    let representative
    if (!merge) {
      // 不合并（只有一个会话 / 全在同一个对话内 / 等级是 DONE·IDLE）：
      // **与修复前逐字节一致** —— 取候选最靠前的一个（rank 最高 → 最近活跃）。
      representative = candidates[0]
    } else if (wasMergingThisTier) {
      // 同一等级内继续合并：代表只要还在这个等级里就不换（这是"不回跳"的核心）。
      representative = members.find((record) => record.id === this.focusSessionId) ?? candidates[0]
    } else {
      // 刚开始合并 / 换了等级：能沿用旧代表就沿用（避免"第二个会话一开就换人"），否则重挑。
      representative = candidates.find((record) => record.id === this.focusSessionId) ?? candidates[0]
    }
    this.focusSessionId = representative.id
    return { record: representative, state, merged: merge, members: members.length }
  }

  /**
   * 等级内**对外显示的状态**。
   *
   * - 不合并（只有一个成员，或成员全在同一个对话内）⇒ **原样返回**（旧行为逐字节一致）；
   * - 合并 ⇒ 本段期间只升不降（"指标只往上走"，不再随两边轮流开合工具回跳）。
   *
   * 天花板是**缓存**而不是真相：成员掉到 1 个、或最高位换成另一个等级时立刻重置，
   * 所以它不会把一个已经过去的等级粘住。
   */
  #levelStateOf(tier, members, merge) {
    const levelState = members[0].state
    if (!merge) {
      this.mergeTier = undefined
      this.mergeState = undefined
      return levelState
    }
    if (this.mergeTier !== tier || this.mergeState === undefined) {
      this.mergeTier = tier
      this.mergeState = levelState
      return levelState
    }
    if ((STATE_RANK[levelState] ?? 0) > (STATE_RANK[this.mergeState] ?? 0)) this.mergeState = levelState
    return this.mergeState
  }

  #stateMessage(record, selection) {
    const message = {
      // ⚠️ 用 selection.state（**等级合并后的显示状态**），不是 record.state：
      //    多会话同等级时 record.state 只是代表会话自己的状态，
      //    直接用它会让图标随两边轮流开合工具在 运行中/思考中 之间回跳（实测 6 次）。
      state: selection.state,
      activity: record.activity,
      task: record.task,
      session: record.id === 'dsh-host' ? undefined : record.id,
      // ⚠️ 这里**不能**再放旧版 `progress: {completed,total,current}`：
      //    它的字段名与新载荷不同，会产出一个"有 total 没有 done"的半截对象
      //    （JSON.stringify 会把 undefined 丢掉，窗口只看到 {"total":3}）—— 正是"假数字"的来源。
      //    计划进度统一走下面按能力门控的 `progress`。
      // ⚠️ 耗时**不可相加**（两个会话同时跑，加起来不是任何真实的东西）⇒ 代表会话的单值。
      elapsedMs: this.#elapsedMs(record),
      // ⚠️ token **可相加** ⇒ 跨全部会话合计（用户拍板："统计 = 跨全部会话的总计"）。
      tokens: this.tokensSnapshot(),
      // 以下为 SPEC 之外的附加字段，窗口侧可以忽略。
      project: record.project,
      title: record.title,
      toolName: record.toolName,
      reasoningEffort: record.reasoningEffort,
      reasonKind: record.reasonKind,
      errorCode: record.errorCode,
    }
    // v2 字段只在窗口声明了对应能力时才追加（老窗口收到的字节与 v1 完全一致）。
    // ⚠️ 计划相关的三件套（todos / progress / metrics）一律取**根会话**：
    //    焦点落到子代理身上时，它不写 todo，用它自己的空计划会把主代理的计划整条盖掉。
    const root = this.#rootRecordOf(record)
    if (this.capabilities.has(Capability.TODOS) && root?.todos) {
      message.todos = root.todos
    }
    // ⚠️ 花费**可相加** ⇒ 下发的是跨全部会话的**全局总量**（`setCost` 写入），
    //    不再挂"当前代表会话"身上（那样多会话时焦点一换花费就会消失/跳变）。
    if (this.capabilities.has(Capability.COST) && this.totalCost) {
      message.cost = this.totalCost
    }
    // 计划进度（**真进度**）。`applicable:false` 是显式信号：窗口据此不画条（不是 0%）。
    if (this.capabilities.has(Capability.PROGRESS)) {
      message.progress = this.#planOf(record) ?? { applicable: false, reason: 'no-todos' }
      // 活动量单独一个字段名，**绝不混进 progress**（它没有分母）。
      message.metrics = this.metricsSnapshot()
    }
    // 上下文占用（**资源指标**，独立字段名）。
    // 有真实分母（pressureTokens/contextWindow）→ 可以画环/条，
    // 但它是"上下文占用"**不是**"工作进度"，绝不出现在 progress 里。
    // 没有分母/分子 → `applicable:false`，窗口据此不画环（**不是 0%**）。
    if (this.capabilities.has(Capability.CONTEXT)) {
      message.context = record.context ?? { applicable: false, reason: ContextReason.NO_LIMIT }
    }
    if (this.capabilities.has(Capability.SUBAGENTS)) {
      const subagents = this.subagentsSnapshot()
      if (subagents && subagents.total > 0) message.subagents = subagents
    }
    if (this.capabilities.has(Capability.SESSIONS)) {
      message.sessions = this.mainSessionsSnapshot({ limit: TEXT_CAPS.sessions })
    }
    return createMessage(MessageKind.STATE, message)
  }

  /**
   * 无视去重签名，直接给出"当前状态的 state 消息"。
   * 给"花费变了但工作状态没变"这种外部数据变化用（花费来自账本，不在事件签名里）。
   */
  currentStateMessage() {
    const selection = this.#select()
    return this.#stateMessage(selection.record, selection)
  }

  #render() {
    const selection = this.#select()
    const record = selection.record
    const root = this.#rootRecordOf(record)
    const signature = signatureOf(
      record,
      this.#planOf(record),
      root?.todos,
      this.#subagentDigest(record),
      this.#sessionsDigest(),
      this.#contextDigest(record),
      // 显示状态与两个"可相加总量"的指纹。
      // ⚠️ 它们必须进签名：**另一个会话**的工具调用/轮数/token 变化时，
      //    签名里的 record.* 与 sessionsDigest 都可能一个字都不变
      //    （sessionsDigest 只含 id:state:turnActive:progress，不含计数），
      //    于是去重会把这条 state 吃掉 ⇒ 图标上的合计数字永远停在旧值。
      selection.state,
      this.#totalsDigest(record),
    )
    if (signature === this.signature) return []
    this.signature = signature
    return [this.#stateMessage(record, selection)]
  }

  /**
   * "可相加总量"里**不属于代表会话**的那部分指纹（工具数 / 轮数 / token）。
   *
   * 为什么是"不属于代表"的增量而不是总量本身：
   *   代表会话**自己**的贡献变化，本来就走它自己的字段（state/activity/toolName/…）；
   *   而**别的会话**的贡献变化时，`record.*` 与 `sessionsDigest` 都可能一个字都不变
   *   （sessionsDigest 只含 id:state:turnActive:progress，不含计数）⇒ 必须靠这条指纹
   *   把图标叫醒，否则合计数字永远停在旧值。
   *
   * 取增量的第二个理由，也是它能做到**零回归**的原因：
   *   只有一个会话时增量恒为 `0:0|0` —— 一个常量，签名与修复前完全等价，
   *   旧窗口"占用变了也不多发一条 state"的行为原样保留
   *   （`test/context.test.js` 与 `test/reducer-priority.test.js` 各自钉住了这条）。
   *
   * 按能力门控：工具数与轮数走 PROGRESS（`metrics` 只在声明了该能力时下发），
   * token 是 v1 字段、一直都在，所以不做门控。
   */
  #totalsDigest(record) {
    const withMetrics = this.capabilities.has(Capability.PROGRESS)
    let turns = 0
    let toolCalls = 0
    let tokens = 0
    for (const other of this.sessions.values()) {
      if (other === record) continue
      if (withMetrics) {
        if (other.subagent !== true) turns += other.metrics?.turns ?? 0
        toolCalls += other.metrics?.toolCalls ?? 0
        const subs = this.subagentLedger.snapshot(normalizeSessionId(other.id))
        toolCalls += (subs.items ?? []).reduce((sum, item) => sum + (item.toolCalls ?? 0), 0)
      }
      tokens += other.tokens?.total ?? 0
    }
    return `${withMetrics ? `${turns}:${toolCalls}` : ''}|${tokens}`
  }

  /**
   * 上下文占用的指纹（**按能力门控**）。
   * 只有声明了 `context` 能力的窗口才需要"占用变了也推一条"；
   * 老窗口签名为空串，字节与 v1 完全一致（不因占用变化多发它读不懂的 state）。
   */
  #contextDigest(record) {
    if (!this.capabilities.has(Capability.CONTEXT)) return ''
    return contextDigest(record.context)
  }

  /** 选中会话的子代理计数指纹（进签名用；时间戳刻意不入指纹）。 */
  #subagentDigest(record) {
    if (record.id === 'dsh-host') return ''
    return subagentsDigest(this.subagentLedger.snapshot(normalizeSessionId(record.id)))
  }

  /**
   * 全部对话的指纹：别的对话开了/关了/换状态/进度变了 → 面板必须重推。
   * 子代理不入（它们走 subagents 那一行）。不含时间戳，避免每秒抖动。
   */
  #sessionsDigest() {
    // 只有声明了 sessions 能力的窗口才需要"别的对话变了也推一条"。
    // 老窗口保持 v1 行为：签名只跟选中会话有关，字节不变。
    if (!this.capabilities.has(Capability.SESSIONS)) return ''
    if (this.sessions.size === 0) return ''
    const parts = []
    for (const record of this.sessions.values()) {
      if (record.subagent === true) continue
      parts.push(`${record.id}:${record.state}:${record.turnActive === true ? 1 : 0}:${progressDigest(record.progress)}`)
    }
    parts.sort()
    return parts.join(',')
  }
}

export { compareRecords, progressOf, signatureOf, reasonKindOf }
