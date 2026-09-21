/**
 * 心跳取证 3（判别器）：静默事件发生时，**窗口自己的定时器**还在按时跑吗？
 *   - 窗口日志里的 `topmost re-assert #N` 是窗口主进程自己的周期定时器（每 5s 左右）。
 *   - 若静默窗口附近 re-assert 也一起断档 ⇒ 窗口主进程被卡住（窗口侧问题）。
 *   - 若 re-assert 照常、只有入站消息断 ⇒ 宿主真的没发（宿主侧问题）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(process.env.USERPROFILE ?? '', '.dsh', 'work-icon', 'helper.log')
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
const ts = (line) => {
  const m = /^\[([^\]]+)\]/u.exec(line)
  return m ? Date.parse(m[1]) : Number.NaN
}

const reassert = lines.filter((l) => l.includes('topmost re-assert')).map((l) => ({ t: ts(l), line: l })).filter((x) => Number.isFinite(x.t))
const silence = lines.filter((l) => l.includes('silence:')).map((l) => ts(l)).filter(Number.isFinite)
const stateRow = lines.filter((l) => /renderer: state=/.test(l)).map((l) => ts(l)).filter(Number.isFinite)

console.log(`re-assert 条数=${reassert.length}  silence 次数=${silence.length}  渲染状态行=${stateRow.length}`)
if (reassert.length > 2) {
  const gaps = reassert.slice(1).map((x, i) => x.t - reassert[i].t)
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  const p95 = gaps[Math.floor(gaps.length * 0.95)]
  const max = gaps.at(-1)
  console.log(`re-assert 间隔: 中位 ${median}ms  p95 ${p95}ms  最大 ${max}ms（窗口自己的定时器节拍）`)
  console.log(`  超过 15s 的间隔数（=窗口主进程被卡住的迹象）: ${gaps.filter((g) => g > 15000).length}`)
}

console.log('\n--- 每次静默事件前后 ±20s 内：窗口自己的 re-assert 有没有断档？ ---')
for (const t of silence.slice(-10)) {
  const around = reassert.filter((x) => Math.abs(x.t - t) <= 20000)
  const before = reassert.filter((x) => x.t <= t).at(-1)
  const after = reassert.filter((x) => x.t > t)[0]
  const toNext = after ? Math.round((after.t - t) / 1000) : null
  const fromPrev = before ? Math.round((t - before.t) / 1000) : null
  console.log(
    `  ${new Date(t).toISOString().slice(11, 19)}  静默前后 20s 内 re-assert=${around.length} 条`
    + `  距上一条 ${fromPrev}s  距下一条 ${toNext}s`,
  )
}

console.log('\n--- 静默发生时，入站 state 行离它多远（=真的是"没有入站消息"吗）---')
for (const t of silence.slice(-10)) {
  const prev = stateRow.filter((x) => x <= t).at(-1)
  const next = stateRow.filter((x) => x > t)[0]
  console.log(
    `  ${new Date(t).toISOString().slice(11, 19)}  最近一次 state 渲染在 ${prev ? Math.round((t - prev) / 1000) + 's 前' : '无'}`
    + `，下一次在 ${next ? Math.round((next - t) / 1000) + 's 后' : '无'}`,
  )
}
