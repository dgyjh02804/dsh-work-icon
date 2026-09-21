/**
 * dsh-work-icon · 上下文占用（**资源指标**，宿主侧数据层）
 *
 * 与 `progress.js`（工作进度）严格分开出境。三类字段各自独立、互不冒充：
 *   progress → 真进度（有计划分母：done/total）
 *   metrics  → 活动量（无分母：轮/步/工具数/耗时）
 *   context  → **资源指标**（有资源分母：used/limit = pressureTokens/contextWindow）
 *
 * ── 数据通道（源码级核对，不是推断）─────────────────────────────────────
 * 分子与分母**都在本插件已经订阅的 `session/event` 总线上**：
 * 不需要读 `llm` 服务的模型路由信息，**不需要新增任何订阅**（零额外订阅成本）。
 *
 *   分母 `contextWindow` ← `request/context` 会话事件的 `data.contextWindow`
 *     · `dsh-session/lib/types/types.d.ts:202-209`
 *         RequestContext = { provider, model, contextWindow? }  // 「Maximum combined request and response context in tokens, when advertised」
 *     · `dsh-session/lib/types/types.d.ts:335`  'request/context': RequestContext
 *         → **data 就是 RequestContext 本身，没有 header 之类的嵌套**
 *     · 官方注释：该事件「logged only when the route or capacity changes」→ 很稀
 *
 *   分子 `pressureTokens` ← usage 样本（两条路径都认）
 *     · `dsh-token-meter/lib/types/usage-projection.js:55-62`
 *         usageOf: 'assistant/chunk' 且 chunk.type === 'usage' → data.chunk.usage
 *                  'assistant/message'                        → data.usage
 *         pressureFrom: pressureTokens = inputTokens + cacheReadTokens + cacheWriteTokens
 *         （prompt 侧：**不含 outputTokens**，因为占用的是"下一次请求的输入"）
 *
 * 口径**逐行照抄** dsh-token-meter 官方的 `contextPressure` 投影
 * （`usage-projection.js:142-189`，key = 'contextPressure'）；宿主绝不自己发明近似量。
 *
 * ── 纪律（与 progress.js 同款，吃过"显示 0 而不是真实值"的亏）───────────
 *   1. **没有分母就不下发字段** —— `applicable:false`，且**绝不出现 used/limit/ratio**。
 *      没有分母时给 0% 就是撒谎（用户原话：「没有分母我不会给百分比」）。
 *   2. **不 clamp、不取整** —— `used > limit` 是真事（压缩尚未发生），ratio 如实给（可 > 1），
 *      画不画满交给窗口。抹平就是撒谎。
 *   3. **绝不估算** —— 没有官方 usage 样本就没有 used；
 *      **绝不拿 tokens 累加（那是全程累计量）冒充上下文占用（那是当前 prompt 大小）**。
 */

import { TEXT_CAPS, oneLine } from './text.js'

/** 拿不到分母/分子时的**显式**原因（窗口据此不画环，而不是画 0%）。 */
export const ContextReason = Object.freeze({
  /** 还没有 `request/context` → 不知道上下文窗口多大（**最常见的起步态**）。 */
  NO_LIMIT: 'no-limit',
  /** 有窗口但还没有任何 usage 样本（例如刚建会话、还没发过请求）。 */
  NO_USAGE: 'no-usage',
  /** 字段存在但值非法（NaN / 负 / 零 / 非整数）—— 宁可不下发也不给脏数字。 */
  INVALID: 'invalid',
})

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : undefined)

/**
 * 取一条会话事件里**官方口径**的 TokenUsage。
 * 两条路径与 `dsh-token-meter/lib/types/usage-projection.js:58-62` 逐行一致：
 *   - `assistant/chunk` 且 `chunk.type === 'usage'` → `data.chunk.usage`
 *   - `assistant/message`                         → `data.usage`
 *
 * ⚠️ 注意 reducer 里 `tokens` 累加用的 `usageOf` **只认 `data.usage`**（漏了 chunk 那条），
 *    那是 tokens 字段自己的历史缺口，本模块不共用它 —— 上下文占用两条路径都要认，
 *    否则一次"请求失败但只留下 usage chunk"的回合会让环直接不动。
 *
 * @param event `session/event` 事件对象（`{ type, seq, time, data }`）
 * @returns 原始 TokenUsage，或 undefined
 */
export function usageSampleOf(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return undefined
  if (event?.type === 'assistant/chunk' && data.chunk?.type === 'usage') {
    const usage = data.chunk.usage
    return usage && typeof usage === 'object' ? usage : undefined
  }
  if (event?.type === 'assistant/message') {
    const usage = data.usage
    return usage && typeof usage === 'object' ? usage : undefined
  }
  return undefined
}

/**
 * TokenUsage → prompt 侧压力（上下文占用的**分子**）。
 * 公式照抄 `dsh-token-meter` 的 `pressureFrom`（usage-projection.js:56）：
 *   `pressureTokens = inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)`
 *
 * 三个字段**全缺**时返回 undefined（不是 0）—— 0 是一个具体的断言，这里没有依据。
 *
 * @param usage 原始 TokenUsage（`{ inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`）
 * @returns 非负整数，或 undefined
 */
export function pressureTokensOf(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const input = num(usage.inputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  if (input === undefined && cacheRead === undefined && cacheWrite === undefined) return undefined
  return (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
}

/**
 * 校验分子/分母。**只接受**真值：
 *   - `limit` 必须存在、有限、整数、> 0（官方 schema 就是 `z.number().int().positive().optional()`）
 *   - `used`  必须存在、有限、整数、>= 0（官方 `z.number().int().nonnegative().optional()`）
 *
 * 字段**缺失**（undefined/null）→ 报对应的"缺哪一项"原因；
 * 字段**存在但非法**（NaN/负/零/小数）→ 一律 `INVALID`，绝不静默当 0。
 *
 * @returns `{ ok: true, used, limit }` 或 `{ ok: false, reason }`
 */
export function normalizeContext({ used, limit } = {}) {
  // 分母优先：哲学上"没有分母不给百分比"，所以缺分母时先报它。
  if (limit === undefined || limit === null) return { ok: false, reason: ContextReason.NO_LIMIT }
  if (used === undefined || used === null) return { ok: false, reason: ContextReason.NO_USAGE }

  const limitValue = Number(limit)
  const usedValue = Number(used)
  if (!Number.isFinite(limitValue) || !Number.isInteger(limitValue) || limitValue <= 0) {
    return { ok: false, reason: ContextReason.INVALID }
  }
  if (!Number.isFinite(usedValue) || !Number.isInteger(usedValue) || usedValue < 0) {
    return { ok: false, reason: ContextReason.INVALID }
  }
  return { ok: true, used: usedValue, limit: limitValue }
}

/**
 * 组装上线路的 `context` 载荷（**独立字段，绝不混进 `progress`**）。
 *
 * `applicable:false` 时**只有** applicable/reason —— `used`/`limit`/`ratio` 一个都不出现，
 * 免得下游把 undefined 当 0 渲染成 "0%"（那正是"假数字"的来源）。
 *
 * `ratio` **不做 clamp**：`used > limit`（待压缩）如实 > 1。
 *
 * @param snapshot `{ used, limit }`（`used` = pressureTokens，`limit` = contextWindow）
 * @returns 稳定的线上形状
 */
export function contextPayload({ used, limit } = {}) {
  const normalized = normalizeContext({ used, limit })
  if (!normalized.ok) return { applicable: false, reason: normalized.reason }
  return {
    applicable: true,
    used: normalized.used,
    limit: normalized.limit,
    ratio: normalized.used / normalized.limit,
  }
}

/**
 * 从 `request/context` 事件取分母。
 * **data 就是 RequestContext 本身**（`types.d.ts:335`），没有嵌套：
 *   `{ provider, model, contextWindow? }`
 *
 * `provider`/`model` 一并取回，只为给日志和**分母变了**的判断提供身份；
 * 它们**不进线上载荷**（窗口只要 used/limit/ratio 三件套即可画环）。
 *
 * @param event `request/context` 事件对象
 * @returns `{ limit, provider, model }`；limit 可能为 undefined（该路由没公布容量）
 */
export function routeOf(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return { limit: undefined, provider: undefined, model: undefined }
  const limit = num(data.contextWindow)
  return {
    limit: limit !== undefined && Number.isInteger(limit) && limit > 0 ? limit : undefined,
    provider: oneLine(data.provider, TEXT_CAPS.todoContentChars),
    model: oneLine(data.model, TEXT_CAPS.todoContentChars),
  }
}

/** 上下文占用的指纹（进 state 去重签名；不含时间戳，避免抖动）。 */
export function contextDigest(context) {
  if (!context) return ''
  if (context.applicable !== true) return `na:${context.reason ?? ''}`
  return `${context.used}/${context.limit}`
}

/**
 * 供窗口直接判断"该不该画环"。
 * **只有本函数为 true 才允许把 used/limit 画成环/条** ——
 * 真进度之外的任何东西都不许用这个（那是 `isRealProgress`）。
 */
export function isRealContext(context) {
  return context?.applicable === true
    && Number.isFinite(context.used)
    && Number.isFinite(context.limit)
    && context.limit > 0
}

export { num }
