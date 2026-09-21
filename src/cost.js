/**
 * dsh-work-icon · 花费读取器（协议 v2 第 ③ 步）
 *
 * 数据源：**不是外部 API，也不做任何估算**，而是只读 `dsh-bottom-info-bar` 自己记的账本：
 *   %USERPROFILE%\.dsh\dsh-bottom-info-bar\usage-records.journal.jsonl   ← 它的注释原文是 "the source of truth"
 *   %USERPROFILE%\.dsh\dsh-bottom-info-bar\usage-records.json            ← 紧凑快照（兜底）
 *
 * 口径（逐条核对过它的实现）：
 *   - 每条记录自带 `cost`（它按价目表算好写下来的）与 `currency`；本模块**只做求和**，绝不重算；
 *   - 只累加 `pricingStatus === 'priced'` 的记录（unpriced 没有金额，硬算就是假数字）；
 *   - 本会话花费 = **当前会话 + 它 origin=subagent 的后代**（对齐底栏 "ui.sessionIncludingSubagents"）；
 *   - 币种分桶（底栏同样分 `costs.CNY` / `costs.USD`），不做汇率换算。
 *
 * 健壮性（私有 schema，必须有防线）：
 *   - 逐行容错解析：坏行只计数，不抛；
 *   - 增量读：按偏移只读新增字节；发现文件被重写（变短 / 尾部对不上）就整体重来；
 *   - 读不到 / 解析不出 / 没有 priced 记录 → 状态 `unavailable`，调用方降级为"只显示 tokens"。
 */

import { existsSync, openSync, closeSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeSessionId } from './reducer.js'

export { normalizeSessionId }

/** 账本目录（与 dsh-bottom-info-bar 保持一致，含它的环境变量覆盖位）。 */
export function ledgerDir(env = process.env) {
  const override = env?.DSH_BOTTOM_INFO_BAR_DATA_DIR
  if (typeof override === 'string' && override.trim().length > 0) return override
  return join(homedir(), '.dsh', 'dsh-bottom-info-bar')
}

export function journalPath(env = process.env) {
  return join(ledgerDir(env), 'usage-records.journal.jsonl')
}

export function snapshotPath(env = process.env) {
  return join(ledgerDir(env), 'usage-records.json')
}

export function summariesPath(env = process.env) {
  return join(ledgerDir(env), 'usage-summaries.json')
}

/**
 * 会话 id 归一化：见 `reducer.normalizeSessionId`（账本里 `session-<uuid>` 与裸 `<uuid>`
 * 两种写法并存，比对前必须抹平）。这里再导出一次，方便只依赖 cost 模块的调用方。
 */

function finiteNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

/**
 * 解析一条账本记录。形状不认识 → null（调用方计数跳过）。
 * 只读需要的字段，不做结构化克隆。
 */
export function parseRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const sessionId = String(value.sessionId ?? '').trim()
  if (sessionId.length === 0) return null
  const ts = finiteNumber(value.ts)
  const cost = finiteNumber(value.cost)
  const currency = typeof value.currency === 'string' && value.currency.trim().length > 0
    ? value.currency.trim().toUpperCase()
    : ''
  return {
    sessionId: normalizeSessionId(sessionId),
    ts: ts ?? 0,
    cost,
    currency,
    /** 只认它自己的判定：'priced' 才有金额可言。 */
    priced: String(value.pricingStatus ?? '').toLowerCase() === 'priced' && cost !== undefined,
    pricingVersion: typeof value.pricingVersion === 'string' ? value.pricingVersion : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    provider: typeof value.provider === 'string' ? value.provider : undefined,
    input: finiteNumber(value.input) ?? 0,
    cacheRead: finiteNumber(value.cacheRead) ?? 0,
    cacheWrite: finiteNumber(value.cacheWrite) ?? 0,
    output: finiteNumber(value.output) ?? 0,
  }
}

/** 逐行解析一段文本；返回记录数组与坏行数。不抛。 */
export function parseRecords(text) {
  const records = []
  let broken = 0
  if (typeof text !== 'string' || text.length === 0) return { records, broken }
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    let value
    try {
      value = JSON.parse(line)
    } catch {
      broken += 1
      continue
    }
    const record = parseRecord(value)
    if (record === null) broken += 1
    else records.push(record)
  }
  return { records, broken }
}

/** 一个会话的累计：按币种分桶 + 计数。 */
function emptyBucket() {
  return { cost: new Map(), records: 0, priced: 0, unpriced: 0, lastTs: 0, pricingVersion: undefined }
}

/** 尾部重合校验长度：重写检测用它，够短也不贵。 */
const OVERLAP_BYTES = 64
/** 会话表上限：只为了不让长跑进程的记忆无界增长。 */
const MAX_TRACKED_SESSIONS = 512

/**
 * 账本读取器（有状态、增量）。
 *
 * 生命周期：`refresh()` 按需调用（建议 1-2 s 一次），每次只读新增字节；
 * 单次调用的开销与"新增记录数"成正比，与会话总时长无关。
 */
export class CostLedger {
  constructor({ dir, file, logger, env = process.env } = {}) {
    this.dir = dir ?? ledgerDir(env)
    this.journalFile = file ?? join(this.dir, 'usage-records.journal.jsonl')
    this.snapshotFile = join(this.dir, 'usage-records.json')
    this.summariesFile = join(this.dir, 'usage-summaries.json')
    this.logger = logger ?? console
    /** 偏移式增量读的状态。 */
    this.offset = 0
    this.overlap = ''
    this.pending = ''
    /** sessionId → bucket */
    this.sessions = new Map()
    this.stats = { refreshes: 0, bytesRead: 0, records: 0, broken: 0, resets: 0, source: undefined }
    this.warned = new Set()
    /** 读盘失败原因（给降级判断与日志用）。 */
    this.lastError = undefined
  }

  #warnOnce(key, message) {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.logger.warn?.(`dsh-work-icon: ${message}`)
  }

  /** 从偏移处增量读；返回本次读到的文本（可能为空串）。 */
  #readNewBytes() {
    let stat
    try {
      stat = statSync(this.journalFile)
    } catch {
      return undefined
    }
    if (!stat.isFile()) return undefined
    const size = stat.size
    if (size === this.offset) return ''
    if (size < this.offset) {
      // 文件被重写/折叠过：整体重来。
      this.#reset()
      this.stats.resets += 1
    } else if (this.offset > 0 && this.overlap.length > 0) {
      // 声称是追加，但尾部对不上 → 其实是重写：整体重来（宁可多读一遍，不可算错）。
      const tail = this.#readRange(Math.max(0, this.offset - this.overlap.length), this.offset)
      if (tail !== null && tail !== this.overlap) {
        this.#reset()
        this.stats.resets += 1
      }
    }
    const chunk = this.#readRange(this.offset, size)
    if (chunk === null) return ''
    this.offset = size
    this.overlap = chunk.length > 0 ? chunk.slice(-OVERLAP_BYTES) : this.overlap
    this.stats.bytesRead += Buffer.byteLength(chunk)
    return chunk
  }

  #readRange(from, to) {
    if (to <= from) return ''
    let fd
    try {
      fd = openSync(this.journalFile, 'r')
    } catch {
      return null
    }
    try {
      const length = to - from
      const buffer = Buffer.allocUnsafe(length)
      const read = readSync(fd, buffer, 0, length, from)
      return buffer.subarray(0, read).toString('utf8')
    } catch {
      return null
    } finally {
      try {
        closeSync(fd)
      } catch {
        // 关不掉也不能抛
      }
    }
  }

  #reset() {
    this.offset = 0
    this.overlap = ''
    this.pending = ''
    this.sessions.clear()
  }

  #absorb(records) {
    for (const record of records) {
      let bucket = this.sessions.get(record.sessionId)
      if (bucket === undefined) {
        if (this.sessions.size >= MAX_TRACKED_SESSIONS) this.sessions.delete(this.sessions.keys().next().value)
        bucket = emptyBucket()
        this.sessions.set(record.sessionId, bucket)
      }
      bucket.records += 1
      bucket.lastTs = Math.max(bucket.lastTs, record.ts)
      if (record.priced) {
        bucket.priced += 1
        if (record.pricingVersion) bucket.pricingVersion = record.pricingVersion
        if (record.currency) {
          bucket.cost.set(record.currency, (bucket.cost.get(record.currency) ?? 0) + record.cost)
        }
      } else {
        bucket.unpriced += 1
      }
      this.stats.records += 1
    }
  }

  /** 快照兜底：journal 缺失/为空时读一次 usage-records.json（整文件重读，低频）。 */
  #absorbSnapshot() {
    if (!existsSync(this.snapshotFile)) return false
    let raw
    try {
      raw = statSync(this.snapshotFile)
    } catch {
      return false
    }
    // 只在会话表还空着时兜底（正常路径下 journal 就是权威）。
    if (this.stats.records > 0 || raw.size === 0) return false
    let text
    try {
      text = readFileSync(this.snapshotFile, 'utf8')
    } catch {
      return false
    }
    let value
    try {
      value = JSON.parse(text)
    } catch {
      return false
    }
    const list = Array.isArray(value) ? value : (Array.isArray(value?.records) ? value.records : null)
    if (!list) return false
    const records = []
    let broken = 0
    for (const item of list) {
      const record = parseRecord(item)
      if (record === null) broken += 1
      else records.push(record)
    }
    this.#absorb(records)
    this.stats.broken += broken
    this.stats.source = 'snapshot'
    this.#warnOnce('snapshot', '账本 journal 为空，已回退到 usage-records.json 快照')
    return records.length > 0
  }

  /**
   * 刷新账本（增量）。
   * @returns {{ok: boolean, reason?: string}}
   */
  refresh() {
    this.stats.refreshes += 1
    const chunk = this.#readNewBytes()
    if (chunk === undefined) {
      this.lastError = 'journal-missing'
      this.stats.source = undefined
      this.#warnOnce('missing', `读不到账本 ${this.journalFile}（花费将降级为只显示 tokens）`)
      return { ok: false, reason: 'journal-missing' }
    }
    this.lastError = undefined
    const text = this.pending + chunk
    const cut = text.lastIndexOf('\n')
    if (cut < 0) {
      // 一行都还没写完整：留着下次拼（避免把半行当坏行）。
      this.pending = text
      this.stats.source = 'journal'
      return { ok: true }
    }
    this.pending = text.slice(cut + 1)
    const { records, broken } = parseRecords(text.slice(0, cut))
    this.stats.broken += broken
    this.#absorb(records)
    this.stats.source = 'journal'
    if (this.stats.records === 0) this.#absorbSnapshot()
    return { ok: true }
  }

  /**
   * 查询若干会话的累计花费。
   *
   * @param sessionIds 归一化前后的会话 id 集合（本模块内部再归一化一次）
   * @returns {{
   *   status: 'ok'|'empty'|'unavailable',
   *   cost?: Record<string, number>, priced?: number, unpriced?: number, records?: number,
   *   partial?: boolean, pricingVersion?: string, reason?: string
   * }}
   *   - `ok`          ：至少有一条 priced 记录（**金额可以是 0**，这是真 0）
   *   - `empty`       ：查到记录但一条都没定价 → 等价于"没有可信金额"
   *   - `unavailable` ：账本读不到/解析不出来 → 调用方只显示 tokens
   *   `partial: true` 表示历史明细被折叠过（金额可能偏小）。
   */
  total(sessionIds) {
    if (this.lastError === 'journal-missing' && this.stats.records === 0) {
      return { status: 'unavailable', reason: 'journal-missing' }
    }
    const wanted = new Set()
    for (const id of sessionIds ?? []) {
      const normalized = normalizeSessionId(id)
      if (normalized.length > 0) wanted.add(normalized)
    }
    if (wanted.size === 0) return { status: 'unavailable', reason: 'no-session' }

    let records = 0
    let priced = 0
    let unpriced = 0
    const cost = new Map()
    let pricingVersion
    for (const id of wanted) {
      const bucket = this.sessions.get(id)
      if (bucket === undefined) continue
      records += bucket.records
      priced += bucket.priced
      unpriced += bucket.unpriced
      if (bucket.pricingVersion) pricingVersion = bucket.pricingVersion
      for (const [currency, amount] of bucket.cost) cost.set(currency, (cost.get(currency) ?? 0) + amount)
    }
    if (records === 0) return { status: 'unavailable', reason: 'no-records' }
    if (priced === 0) return { status: 'empty', records, unpriced, reason: 'no-priced-records' }
    return {
      status: 'ok',
      cost: Object.fromEntries(cost),
      priced,
      unpriced,
      records,
      partial: this.#hasFoldedHistory(),
      pricingVersion,
    }
  }

  /** 折叠检测：summaries 文件存在即表示"已折叠天"有内容（本机实测为不存在）。 */
  #hasFoldedHistory() {
    try {
      return existsSync(this.summariesFile)
    } catch {
      return false
    }
  }

  /** 只读快照，给测试与日志用。 */
  snapshot() {
    const sessions = {}
    for (const [id, bucket] of this.sessions) {
      sessions[id] = {
        records: bucket.records,
        priced: bucket.priced,
        unpriced: bucket.unpriced,
        cost: Object.fromEntries(bucket.cost),
        lastTs: bucket.lastTs,
      }
    }
    return { ...this.stats, offset: this.offset, sessions, lastError: this.lastError }
  }
}
