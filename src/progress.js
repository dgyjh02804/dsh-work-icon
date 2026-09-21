/**
 * dsh-work-icon · 进度计算（宿主侧数据层）
 *
 * 纪律（用户明确要求，吃过"显示 0 而不是真实值"的亏）：
 *   1. **没有 todo 时不许显示 0%** —— 返回 `applicable: false`，窗口据此**不画进度条**；
 *   2. **分母跳变不单调化** —— 模型中途新增 todo 时完成度确实会下降，抹平就是撒谎；
 *      但把"总数变化"作为 `planChange` 一并给出去，让 UI 能写「计划已更新 6→11」；
 *   3. **只有计划进度进这里** —— 轮数/步数/工具数/耗时是"活动量"，走 `metrics`，不进 `progress`。
 *
 * 两套预设各自的真相来源（已核对源码）：
 *   - `standard` 预设 → 扁平工具 → `todo/write { todos: [{ content, status }] }`
 *   - `coding-tree` 预设 → 树形工具 → **`todo/tree` { todos: [{ content, status, children? }] }**
 *     （`dsh-tool-todo-tree/lib/index.js:249`；它明确拒绝与扁平工具共存）
 *   两条都必须支持，否则在用户的实际预设下进度永远为空。
 */

import { TEXT_CAPS, oneLine } from './text.js'

/** 计划进度的计数单位：树形按**叶节点**，扁平按条目。 */
export const ProgressUnit = Object.freeze({ LEAF: 'leaf', ITEM: 'item' })

const DONE = 'completed'
const ACTIVE = 'in_progress'

function statusOf(node) {
  const value = String(node?.status ?? '').trim().toLowerCase()
  if (value === 'completed' || value === 'complete' || value === 'done') return DONE
  if (value === 'in_progress' || value === 'in-progress' || value === 'active') return ACTIVE
  return 'pending'
}

/**
 * 这算不算一条 todo？
 * 要求 `content` 是字符串、或带非空 `children`。
 * 垃圾节点（null / {} / 数字）**不计数** —— 否则一份畸形快照会渲染出"0/1 = 0%"的假进度条。
 */
function isTodoNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  if (typeof node.content === 'string') return true
  return Array.isArray(node.children) && node.children.length > 0
}

/**
 * 树形 todo（`todo/tree`）→ 叶子计数。
 *
 * 为什么按叶子：`completed 父节点 ⇒ 子节点全 completed` 是树形工具的**硬不变式**
 * （`dsh-tool-todo-tree/lib/index.js:129` 会直接拒绝违反的输入），
 * 所以父节点是推导出来的，不算额外交付；按叶子计数才贴近真实工作量。
 *
 * `inProgress` 取**最深**的那个 in_progress 节点（"子代理账本"比"阶段二：实现"更有信息量）；
 * 若只有父节点在跑（子节点都还没开始），那就是父节点本身。
 * 计数是**结构化**的：只要有节点就算一条（与该工具自己的 countStatus 口径一致），
 * 空文案不改变计数（真实输入下工具已保证 content 非空）。
 *
 * @param todos `todo/tree` 事件的 data.todos（嵌套 `{content,status,children?}`）
 * @returns `{ done, total, inProgress }`；没有可计数节点时 `total = 0`
 */
export function countTreeLeaves(todos) {
  let done = 0
  let total = 0
  let inProgress
  let inProgressDepth = -1
  const noteActive = (node, depth) => {
    if (statusOf(node) !== ACTIVE) return
    if (depth < inProgressDepth) return
    inProgressDepth = depth
    inProgress = oneLine(node.content, TEXT_CAPS.todoContentChars)
  }
  const walk = (nodes, depth) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isTodoNode(node)) continue
      const children = Array.isArray(node.children) ? node.children : undefined
      if (children && children.length > 0) {
        noteActive(node, depth)
        walk(children, depth + 1)
        continue
      }
      total += 1
      if (statusOf(node) === DONE) done += 1
      else noteActive(node, depth)
    }
  }
  walk(todos, 1)
  return { done, total, inProgress }
}

/** 扁平 todo（`todo/write`）→ 条目计数。 */
export function countFlatItems(todos) {
  let done = 0
  let total = 0
  let inProgress
  if (!Array.isArray(todos)) return { done, total, inProgress }
  for (const todo of todos) {
    if (!isTodoNode(todo)) continue
    total += 1
    const status = statusOf(todo)
    if (status === DONE) done += 1
    else if (status === ACTIVE && inProgress === undefined) {
      inProgress = oneLine(todo.content, TEXT_CAPS.todoContentChars)
    }
  }
  return { done, total, inProgress }
}

/** 从计划里取"接下来还没做完的那一条"（做活动行兜底用）。 */
export function nextPendingLabel(todos, tree) {
  const list = []
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      list.push(node)
      if (Array.isArray(node.children)) walk(node.children)
    }
  }
  if (tree) walk(todos)
  else if (Array.isArray(todos)) list.push(...todos)
  const pending = list.find((node) => statusOf(node) === 'pending')
  return pending ? oneLine(pending.content, TEXT_CAPS.todoContentChars) : undefined
}

/**
 * 组装上线路的 plan 进度载荷。
 *
 * @param snapshot `{ applicable, done, total, unit, inProgress, mode, planChange }`
 * @returns 稳定的线上形状；`applicable: false` 时**只有** applicable/reason，
 *          **绝不出现 done/total** —— 免得下游把 undefined 当 0 渲染成 "0%"。
 */
export function progressPayload({
  mode,
  todos,
  previous,
  now = Date.now(),
} = {}) {
  const tree = mode === 'tree'
  const counted = tree ? countTreeLeaves(todos) : countFlatItems(todos)
  if (!counted || counted.total <= 0) {
    // 没有 todo / 任务被清空 → 不适用（不是 0%）
    return { applicable: false, reason: 'no-todos' }
  }
  const payload = {
    applicable: true,
    mode: tree ? 'tree' : 'flat',
    unit: tree ? ProgressUnit.LEAF : ProgressUnit.ITEM,
    done: counted.done,
    total: counted.total,
  }
  if (counted.inProgress) payload.inProgress = counted.inProgress
  // 分母跳变：如实上报，交给 UI 写「计划已更新 6→11」。刻意**不**单调化。
  const previousTotal = Number(previous?.total)
  if (Number.isFinite(previousTotal) && previousTotal > 0 && previousTotal !== counted.total) {
    payload.planChange = { from: previousTotal, to: counted.total, at: now }
  }
  return payload
}

/**
 * 树形 todo → 上线载荷（前序扁平化，带 depth，供窗口画缩进树）。
 * 保持与扁平 `todosPayload` 同形（`{items, more}`），只是每项多了 `depth`。
 */
export function treeTodosPayload(todos, max = TEXT_CAPS.todoItems) {
  const items = []
  let seen = 0
  const walk = (nodes, depth) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      seen += 1
      if (items.length < max) {
        const content = oneLine(node.content, TEXT_CAPS.todoContentChars)
        if (content) items.push({ content, status: statusOf(node), depth })
      }
      if (Array.isArray(node.children)) walk(node.children, depth + 1)
    }
  }
  walk(todos, 1)
  return { items, more: Math.max(0, seen - items.length) }
}

/** 进度指纹：参与 state 去重签名（分母/完成数/在做的哪一条变了都要重推）。 */export function progressDigest(progress) {
  if (!progress) return ''
  if (progress.applicable !== true) return 'na'
  return `${progress.done}/${progress.total}:${progress.inProgress ?? ''}:${progress.planChange ? `${progress.planChange.from}->${progress.planChange.to}` : ''}`
}

/** 供窗口直接判断"该不该画条"——真进度（计划完成度）之外的任何东西都不许用这个。 */
export function isRealProgress(progress) {
  return progress?.applicable === true && Number.isFinite(progress.total) && progress.total > 0
}

export { statusOf }
