/**
 * dsh-work-icon · 文本抽取与截断（宿主侧，协议 v2 第 ① ② 步）
 *
 * 这一层只做三件事，全部是**纯函数 + 一个环形缓冲**，不碰任何运行时状态：
 *   1. `tool/call` 的 `name` + `arguments`（原始 JSON 字符串）→ 一行"正在执行 X"；
 *   2. `todo/write` 的完整 `todos[]` → 上线路的紧凑载荷（≤12 条 / 每条 ≤60 字符）；
 *   3. 流式推理/正文文本 → 固定容量环形缓冲，只取尾部 N 字符。
 *
 * 硬约束（来自调研结论：实测 152 块/秒、均值 3 字符）：
 *   **事件路径必须是 O(1)**。所以这里：
 *     - 追加文本 = `TextRing.append`（纯 push，无正则、无 JSON、无重建）；
 *     - 正则/JSON.parse/裁剪**只在节流点**发生（≤6 Hz），绝不在每个增量上发生。
 * 任何一处解析失败都降级（返回 undefined / 用原始短名），**绝不抛异常**——
 * 会话总线上的监听器抛异常会波及其它订阅者。
 */

/** 上线路的体积上限（协议 v2 契约，改这里等于改协议）。 */
export const TEXT_CAPS = Object.freeze({
  /** 活动行总长（含"正在执行 xxx: "前缀）。 */
  activityChars: 60,
  /** 一次最多带几条 todo。 */
  todoItems: 12,
  /** 单条 todo 正文长度。 */
  todoContentChars: 60,
  /** 思考尾串上线路长度（窗口只渲染尾部 2 行）。 */
  thoughtTailChars: 200,
  /** 正文尾串上线路长度；比思考更短，因为正文往往很长。 */
  bodyTailChars: 200,
  /** 宿主内部环形缓冲容量（2 KB）。 */
  ringCapacity: 2048,
  /** 子代理 label（委派时的 short description）上线路长度。 */
  subagentLabelChars: 40,
  /** 一次最多带几个子代理节点（其余用 hidden 计数表达）。 */
  subagentNodes: 12,
  /** 一次最多带几个会话（窗口侧决定面板里显示几行，这里只保证有界）。 */
  sessions: 8,
})

const WHITESPACE = /\s+/gu
const TRUNCATION_MARK = '…'

/** 折叠所有空白成单空格并裁剪：单行文本是上屏前提（换行会把窗口撑高）。 */
export function oneLine(value, max = Number.POSITIVE_INFINITY) {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : String(value)
  if (text.length === 0) return ''
  const collapsed = text.replace(WHITESPACE, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(0, max - 1))}${TRUNCATION_MARK}`
}

/** 裁剪（不折叠空白），超长补省略号。 */
export function clip(value, max) {
  if (typeof value !== 'string') return ''
  if (!Number.isFinite(max) || max <= 0) return ''
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}${TRUNCATION_MARK}`
}

/**
 * 定长文本环形缓冲。
 *
 * `append` 是 O(1)（分块 push + 必要时从头部丢弃整块），
 * 只在**读取**尾部时才做拼接与裁剪 —— 读取频率由节流器控制（≤6 Hz）。
 */
export class TextRing {
  constructor(capacity = TEXT_CAPS.ringCapacity) {
    this.capacity = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : TEXT_CAPS.ringCapacity
    this.chunks = []
    this.length = 0
  }

  /** 追加一段增量文本；空串是 no-op（实测有 0 长度增量）。 */
  append(text) {
    if (typeof text !== 'string' || text.length === 0) return
    this.chunks.push(text)
    this.length += text.length
    this.#trim()
  }

  /** 整段替换（落定块/权威快照用，每轮最多几次，不是热路径）。 */
  set(text) {
    this.reset()
    this.append(text)
  }

  reset() {
    this.chunks.length = 0
    this.length = 0
  }

  /** 尾部至多 max 个字符（不足则返回全部）。 */
  tail(max = this.capacity) {
    if (this.length === 0 || max <= 0) return ''
    let out = ''
    for (let index = this.chunks.length - 1; index >= 0; index -= 1) {
      out = this.chunks[index] + out
      if (out.length >= max) break
    }
    return out.length > max ? out.slice(-max) : out
  }

  #trim() {
    if (this.length <= this.capacity) return
    // 先整块丢头（只要丢了之后还剩得下 capacity 那么多）。
    while (this.chunks.length > 1 && this.length - this.chunks[0].length >= this.capacity) {
      this.length -= this.chunks[0].length
      this.chunks.shift()
    }
    if (this.length <= this.capacity) return
    // 剩下的部分仍超容量：从头块切掉多余的部分（含"单块本身就超容量"的情况）。
    const excess = this.length - this.capacity
    const head = this.chunks[0]
    this.chunks[0] = head.slice(excess)
    this.length -= excess
    if (this.chunks[0].length === 0) this.chunks.shift()
  }
}

/**
 * 各工具"最该显示的那一个参数"。表里没有的工具走 {@link GENERIC_FIELDS} 兜底，
 * 所以新增工具不会导致活动行变空（最差退化成"正在执行 xxx"）。
 */
const TOOL_FIELDS = Object.freeze({
  pwsh: ['command'],
  bash: ['command'],
  shell: ['command'],
  execute: ['command'],
  read: ['file_path', 'path', 'filePath'],
  write: ['file_path', 'path', 'filePath'],
  edit: ['file_path', 'path', 'filePath'],
  multi_edit: ['file_path', 'path', 'filePath'],
  grep: ['pattern'],
  glob: ['pattern'],
  task: ['description', 'prompt'],
  subagent: ['description', 'prompt'],
  webfetch: ['url'],
  web_search: ['url', 'query'],
  browser_open: ['url'],
  todowrite: ['description'],
})

/** 兜底取值顺序：按"信息量"排，命中即用。 */
const GENERIC_FIELDS = Object.freeze([
  'command', 'file_path', 'path', 'pattern', 'description', 'query', 'url', 'prompt', 'name', 'key', 'value',
])

/** 工具名 → 表键：小写、去掉分隔符（`multi_edit` / `multi-edit` 视为同一工具）。 */
function toolKey(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

function firstStringField(source, fields) {
  for (const field of fields) {
    const value = source[field]
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

/**
 * `tool/call` → 一行活动文本。
 *
 * @param name 工具名（`data.name`）
 * @param args `data.arguments`：**原始 JSON 字符串**，也可能是已经被解析过的对象（测试/未来适配器）
 * @returns 形如 `正在执行 pwsh: npm test`，最长 {@link TEXT_CAPS.activityChars} 字符；
 *          无法解析时降级为 `正在执行 pwsh`（不抛）
 */
export function activityLineFor(name, args) {
  const label = oneLine(name, 24) || 'tool'
  const prefix = `正在执行 ${label}`
  const detail = detailOf(label, args)
  if (!detail) return clip(prefix, TEXT_CAPS.activityChars)
  const separator = ': '
  const room = TEXT_CAPS.activityChars - prefix.length - separator.length
  if (room <= 4) return clip(prefix, TEXT_CAPS.activityChars)
  return `${prefix}${separator}${clip(detail, room)}`
}

/** 抽取"那一个"参数值；解析失败/没有可用字段 → undefined。 */
function detailOf(label, args) {
  let source = args
  if (typeof args === 'string') {
    const text = args.trim()
    if (text.length === 0) return undefined
    try {
      source = JSON.parse(text)
    } catch {
      // 不是合法 JSON（截断的流式参数、纯文本命令）：按纯文本用。
      return oneLine(text, 120)
    }
  }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return typeof source === 'string' ? oneLine(source, 120) : undefined
  }
  const preferred = TOOL_FIELDS[toolKey(label)]
  const value = preferred ? firstStringField(source, preferred) : undefined
  const chosen = value ?? firstStringField(source, GENERIC_FIELDS)
  if (chosen === undefined) return undefined
  // 命令只显示第一行：多行 heredoc/脚本会把活动行冲爆。
  return oneLine(chosen.split('\n')[0], 120)
}

/** 三种生命周期状态（权威类型 TodoItem.status）。别的一律按 pending 处理。 */
const STATUS_ALIASES = Object.freeze({
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  active: 'in_progress',
  running: 'in_progress',
  pending: 'pending',
  todo: 'pending',
  open: 'pending',
})

export function normalizeTodoStatus(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/gu, '_')
  return STATUS_ALIASES[key] ?? STATUS_ALIASES[key.replace(/_/gu, '')] ?? 'pending'
}

/**
 * `todo/write` 的完整数组 → 上线路载荷。
 *
 * 权威类型保证这是**全量快照**（每次写入 last-write-wins），所以这里不需要增量重建。
 * 超出 {@link TEXT_CAPS.todoItems} 条时按顺序保留前 N 条，并附 `more` 计数
 * （顺序本身有语义，不按状态重排）。
 */
export function todosPayload(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return { items: [], more: 0 }
  // 先把"能显示的"条目挑出来（没有正文的条目不算数），再截断。
  // 这样 `more` 表达的是"还有几条没显示"，而不是"数组里有几个空壳"。
  const usable = []
  for (const todo of todos) {
    const content = oneLine(todo?.content, TEXT_CAPS.todoContentChars)
    if (!content) continue
    usable.push({ content, status: normalizeTodoStatus(todo?.status) })
  }
  const items = usable.slice(0, TEXT_CAPS.todoItems)
  return { items, more: Math.max(0, usable.length - items.length) }
}

/**
 * todos 的廉价指纹：参与 state 去重签名，让"某条 todo 文案变了但计数没变"也能推一次。
 * 只在 state 渲染时调用（渲染本身是低频事件驱动的），不在增量路径上。
 */
export function todosDigest(payload) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return ''
  let out = String(payload.more ?? 0)
  for (const item of payload.items) out += `|${item.status[0]}${item.content}`
  return out
}

/**
 * 文本节流指纹：把三块可见文本拼起来。
 * 只有节流点（≤6 Hz）才调用它 —— 这是"可见尾串变化才发"的判定依据。
 */
export function textSignature(payload) {
  if (!payload) return ''
  return `${payload.activityText ?? ''}\u0000${payload.thoughtTail ?? ''}\u0000${payload.bodyTail ?? ''}`
}
