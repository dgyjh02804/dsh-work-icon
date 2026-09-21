/**
 * dsh-work-icon · 子代理账本（宿主侧数据层）
 *
 * 目标（用户原话）："总共 12 个子代理，7 个已完成，当前正在跑 XXX"。
 *
 * 三个真相来源，**都不靠猜**：
 *   1. 名字/模式：`subagent/descriptor`（SessionEventMap 事件，走 session/event 一定能收到）
 *      载荷 `{ version, mode: 'one-shot'|'continuable', provider, label? }`，
 *      其中 `label` 就是委派时那句 short description（子代理的"任务名"）。
 *   2. 终局：`subagent/end` 的 `stopReason`（'completed'|'aborted'|'error'|'max-tokens'|'refusal'）
 *      —— 权威。收不到该事件时退化为"子会话自己最后一个 turn/end 的 reason"（同一套词汇）。
 *   3. 在世与否：子会话的 `turn/start`/`turn/end`/`session/disposed` —— 我们自己的观测。
 *
 * ⚠️ 刻意**不**用 `listChildren/listDescendants` 的 `activity` 判完成：
 *    它的文档明写 `running`/`inactive` 只是"存储活跃度"，
 *    "neither encodes a durable outcome"。拿它当"已完成"就是造数据。
 *
 * ⚠️ **已结算账本**：子会话被 dispose 后会话记录会被删掉，
 *    若只靠"活着的会话"计数，用户会看到"已完成"数字**变小**。
 *    所以终局一旦记录，就永久留在这里（有上限 LRU）。
 *
 * ⚠️ 单节点百分比：**拿不到**（实测 6/6 子代理一条 todo 都没写），
 *    协议里**不出现任何 percent 字段**，只给可验证的计数与时间戳。
 */

import { TEXT_CAPS, oneLine } from './text.js'

/** 终局归类。`max-tokens`/`aborted` 归"没做完就结束"，不算失败（与状态机口径一致）。 */
export const SubagentOutcome = Object.freeze({
  DONE: 'done',
  FAILED: 'failed',
  STOPPED: 'stopped',
})

const OUTCOME_BY_REASON = Object.freeze({
  completed: SubagentOutcome.DONE,
  refusal: SubagentOutcome.FAILED,
  error: SubagentOutcome.FAILED,
  'max-tokens': SubagentOutcome.STOPPED,
  aborted: SubagentOutcome.STOPPED,
  interrupted: SubagentOutcome.STOPPED,
})

export function outcomeOf(stopReason) {
  return OUTCOME_BY_REASON[String(stopReason ?? '').trim().toLowerCase()] ?? SubagentOutcome.STOPPED
}

/** 一个子代理的稳定身份 + 可算出来的事实。 */
function emptyNode(id) {
  return {
    id,
    parentId: undefined,
    depth: undefined,
    /** 来自 `subagent/descriptor.label`（委派时的 short description）。 */
    label: undefined,
    mode: undefined,
    provider: undefined,
    /** 终局（一旦记下就不再改）。 */
    stopReason: undefined,
    outcome: undefined,
    endedAt: undefined,
    /** 活体观测（只有会话还在时才有）。 */
    live: false,
    turnActive: false,
    startedAt: undefined,
    touchedAt: undefined,
    toolCalls: 0,
  }
}

export class SubagentLedger {
  constructor({ maxNodes = 256, now = () => Date.now() } = {}) {
    this.now = now
    this.maxNodes = Number.isFinite(maxNodes) && maxNodes > 0 ? maxNodes : 256
    this.nodes = new Map()
  }

  #node(id) {
    if (id === undefined || id === null || String(id).length === 0) return undefined
    const key = String(id)
    let node = this.nodes.get(key)
    if (node === undefined) {
      if (this.nodes.size >= this.maxNodes) {
        // 淘汰最旧的**已结算**节点；没有已结算的就淘汰最老的（保持有界）。
        const settled = [...this.nodes.entries()].filter(([, value]) => value.outcome !== undefined)
        const victim = (settled.length > 0 ? settled : [...this.nodes.entries()])
          .sort((left, right) => (left[1].endedAt ?? left[1].touchedAt ?? 0) - (right[1].endedAt ?? right[1].touchedAt ?? 0))[0]
        if (victim) this.nodes.delete(victim[0])
      }
      node = emptyNode(key)
      this.nodes.set(key, node)
    }
    return node
  }

  /** 会话身份（父/深度）：从会话 header 来。@returns 有变化才 true */
  noteSession(id, { parentId, depth } = {}) {
    const node = this.#node(id)
    if (!node) return false
    let changed = false
    if (parentId !== undefined && node.parentId !== String(parentId)) {
      node.parentId = String(parentId)
      changed = true
    }
    if (Number.isFinite(depth) && node.depth !== Number(depth)) {
      node.depth = Number(depth)
      changed = true
    }
    if (node.live !== true) changed = true
    node.live = true
    return changed
  }

  /**
   * 名字与模式。两个来源都用同一个形状：
   *   1) `subagent/descriptor` 会话事件（**只有事件真的到我们手上时**才有——它 model-hidden，
   *      生产里经常到不了，于是 mode/label 双缺）；
   *   2) `ctx.subagents.listDescendants()` 的名册（官方枚举，自己会把 descriptor 折出来）。
   * 拿不到就**留空**，绝不编名字。
   * @returns 有变化才 true
   */
  noteDescriptor(id, data) {
    const node = this.#node(id)
    if (!node || !data || typeof data !== 'object') return false
    let changed = false
    if (typeof data.label === 'string' && data.label.trim().length > 0) {
      const label = oneLine(data.label, TEXT_CAPS.subagentLabelChars)
      if (label !== node.label) {
        node.label = label
        changed = true
      }
    }
    if ((data.mode === 'one-shot' || data.mode === 'continuable') && node.mode !== data.mode) {
      node.mode = data.mode
      changed = true
    }
    if (typeof data.provider === 'string' && data.provider.trim().length > 0) {
      const provider = oneLine(data.provider, 32)
      if (provider !== node.provider) {
        node.provider = provider
        changed = true
      }
    }
    return changed
  }

  /** `subagent/start`：跑起来了。 */
  noteStart(id, at = this.now()) {
    const node = this.#node(id)
    if (!node) return
    node.live = true
    node.turnActive = true
    if (node.startedAt === undefined) node.startedAt = at
    node.touchedAt = at
  }

  /** `subagent/end`：权威终局。 */
  noteEnd(id, stopReason, at = this.now()) {
    const node = this.#node(id)
    if (!node) return
    this.#settle(node, stopReason, at)
  }

  /**
   * 退路：没有 `subagent/end` 时，用子会话自己的 `turn/end` reason settle。
   * 只在还没 settle 时生效（真终局优先）。
   */
  noteTurnEnd(id, reasonKind, at = this.now()) {
    const node = this.nodes.get(String(id))
    if (!node || node.outcome !== undefined) return
    node.turnActive = false
    node.touchedAt = at
    if (node.mode === 'continuable') return // 可续会话一轮结束 ≠ 这个子代理结束
    this.#settle(node, reasonKind, at)
  }

  #settle(node, stopReason, at) {
    if (node.outcome !== undefined) return
    node.stopReason = String(stopReason ?? 'aborted')
    node.outcome = outcomeOf(stopReason)
    node.endedAt = at
    node.live = false
    node.turnActive = false
  }

  /** 活体心跳（工具调用数 / 回合开关 / 最近活动）。 */
  noteLive(id, { turnActive, toolCalls, at = this.now() } = {}) {
    const node = this.nodes.get(String(id))
    if (!node) return
    node.live = true
    node.touchedAt = at
    if (turnActive !== undefined) node.turnActive = turnActive === true
    if (Number.isFinite(toolCalls)) node.toolCalls = toolCalls
  }

  noteToolCall(id) {
    const node = this.nodes.get(String(id))
    if (node) node.toolCalls += 1
  }

  /** 会话被回收：**保留已结算事实**，只把"活着"标记摘掉。 */
  remove(id) {
    const node = this.nodes.get(String(id))
    if (!node) return
    node.live = false
    node.turnActive = false
    if (node.outcome === undefined) {
      // 从未拿到终局就消失了：如实标成"中止"，不假装完成。
      node.stopReason = 'aborted'
      node.outcome = SubagentOutcome.STOPPED
      node.endedAt = node.endedAt ?? node.touchedAt ?? this.now()
    }
  }

  /** 某一层的直接子节点（parentId 匹配；id 归一化比较交给调用方）。 */
  childrenOf(parentId) {
    const key = String(parentId)
    return [...this.nodes.values()].filter((node) => node.parentId === key)
  }

  /** 某个节点的父 id（沿谱系向上找根时用；不知道就返回 undefined）。 */
  parentOf(id) {
    const node = this.nodes.get(String(id))
    return node?.parentId
  }

  /**
   * 以 `rootId` 为根的子树快照（**前序**，父在子前，带 depth）+ 计数。
   *
   * 计数口径（全部来自可验证事实，无估算）：
   *   total   = 账本里该子树的全部节点（含已结算的 —— 所以 dispose 后不会变少）
   *   running = 正在跑的（turnActive）
   *   done    = 终局 completed
   *   failed  = 终局 error/refusal
   *   stopped = 终局 aborted/max-tokens（没做完就结束）
   */
  snapshot(rootId, { maxNodes = TEXT_CAPS.subagentNodes } = {}) {
    const root = String(rootId)
    const byParent = new Map()
    for (const node of this.nodes.values()) {
      if (node.parentId === undefined) continue
      const list = byParent.get(node.parentId)
      if (list === undefined) byParent.set(node.parentId, [node])
      else list.push(node)
    }
    const items = []
    const counts = { total: 0, running: 0, done: 0, failed: 0, stopped: 0, unknown: 0 }
    const visit = (parentKey, depth) => {
      const children = byParent.get(parentKey) ?? []
      // 活跃优先：在跑的排前面，其次按开始时间（UI 截断时先看到的才是要紧的）
      const ordered = [...children].sort((left, right) => {
        const active = Number(right.turnActive) - Number(left.turnActive)
        if (active !== 0) return active
        return (left.startedAt ?? left.touchedAt ?? 0) - (right.startedAt ?? right.touchedAt ?? 0)
      })
      for (const node of ordered) {
        counts.total += 1
        let status
        if (node.turnActive) { status = 'running'; counts.running += 1 }
        else if (node.outcome === SubagentOutcome.DONE) { status = 'done'; counts.done += 1 }
        else if (node.outcome === SubagentOutcome.FAILED) { status = 'failed'; counts.failed += 1 }
        else if (node.outcome === SubagentOutcome.STOPPED) { status = 'stopped'; counts.stopped += 1 }
        else { status = 'unknown'; counts.unknown += 1 }
        if (items.length < maxNodes) {
          const item = {
            id: node.id,
            depth,
            status,
          }
          if (node.parentId !== undefined) item.parent = node.parentId
          if (node.label) item.label = node.label
          if (node.mode) item.mode = node.mode
          if (node.startedAt !== undefined) item.startedAt = node.startedAt
          if (node.endedAt !== undefined) item.endedAt = node.endedAt
          if (node.toolCalls > 0) item.toolCalls = node.toolCalls
          if (node.stopReason) item.stopReason = node.stopReason
          items.push(item)
        }
        visit(node.id, depth + 1)
      }
    }
    visit(root, 1)
    const runningLabels = items.filter((item) => item.status === 'running' && item.label).map((item) => item.label)
    return { ...counts, items, hidden: Math.max(0, counts.total - items.length), runningLabels }
  }
}

/** 子代理计数的指纹（参与 state 去重签名；不含时间戳，避免每秒抖动）。 */
export function subagentsDigest(snapshot) {
  if (!snapshot || snapshot.total === 0) return ''
  const head = `${snapshot.total}/${snapshot.running}/${snapshot.done}/${snapshot.failed}/${snapshot.stopped}`
  const labels = snapshot.items.map((item) => `${item.id}:${item.status}`).join(',')
  return `${head}|${labels}`
}
