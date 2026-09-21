#!/usr/bin/env node
/* hover-rows-revert-proof.mjs —— 「改动 **前** 这些断言确实是红的」反证装置（任务 B，2026-09-20）
 *
 * 为什么不用 `git stash` / `git checkout HEAD`：
 *   本仓库工作区**不是干净基线**（`git status` 里 main.js / index.html / reducer.js / 多个 tests 都是
 *   modified，还有 -f 未跟踪的新文件）。拿 HEAD 当对照会把**别人那几轮的改动**一起回滚 ⇒ 红因不纯。
 *   ⇒ 走**机械反向还原**：把本轮"删三行文字"的那一处产品改动，用**精确字符串替换**还原成改前形态；
 *     **任何一处没命中就抛错退出**，绝不静默半还原。
 *
 * 还原的粒度刻意选成"**只翻一个 token**"（`V2ROWS = 'off'` → `V2ROWS = 'on'`）：
 *   · 它只改**行为**，不删新加的留痕通道 ⇒ 断言红了就只能是"行为不对"，不会是"装置没插上"；
 *   · 这与 hover-plate.mjs 里那个 `V2PLATE = 'on' → 'off'` 的基线还原是同一套做法（先例）。
 *
 * 两类东西**分开标注**（用户要求）：
 *   A【证明改动的断言】—— 还原后必须红、改回来后必须绿
 *   B【守恒型守卫】—— 两个形态**都该绿**（证明"为了删文字没把别的东西弄坏"）
 *
 * 红线遵守：不碰生产图标进程（只 spawn 自己的 --hidden 实例，由 harness 按本轮 PID/home 清理）；
 *          不 commit / 不 git add / 不同步 profile；不删除任何套件锁（.run-all.lock 一律不碰）。
 * 用法: node test/hover-rows-revert-proof.mjs
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HTML = path.join(ROOT, 'runtime', 'electron', 'index.html')
const MAIN = path.join(ROOT, 'runtime', 'electron', 'main.js')
const TARGETS = [MAIN, HTML]

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
const hr = (t) => console.log('\n================ ' + t + ' ================')

/** 精确替换：出现 0 次或 >1 次都抛错（拒绝盲替换） */
function swap (src, from, to, file) {
  const n = src.split(from).length - 1
  if (n === 0) throw new Error('反向还原失败：' + path.basename(file) + ' 里找不到要替换的片段 ' + JSON.stringify(from.slice(0, 90)))
  if (n > 1) throw new Error('反向还原失败：' + path.basename(file) + ' 里该片段出现 ' + n + ' 次（不唯一，拒绝盲替换） ' + JSON.stringify(from.slice(0, 90)))
  return src.split(from).join(to)
}

/* 改后 / 改前（逐字抄自本轮改动的那两处；改前 = 把默认值那个 token 翻回 'on'）
 *
 * ⚠️ **为什么必须两处一起翻**（这是本装置第一版**自己错了**、被真跑抓出来的）：
 *   第一版只翻 index.html 的 `V2ROWS = 'off'`，结果 A1 在"还原后"**依然是绿的** —— 反证没成立。
 *   原因：渲染层的 `V2ROWS` 会被主进程发来的 `hover-rows` 消息**覆盖**成 `cfg.hoverRows`，
 *   而 `cfg.hoverRows` 来自 main.js 的 `DEFAULTS.hoverRows`。⇒ 真正的默认值在 **main.js**，
 *   index.html 那个初始化 token 只是"消息还没到时的初值"。
 *   （教训：**检查器自己的假设也可能错** —— 只跑一次反证就把它抓出来了，别信"看起来应该会红"。） */
const NEW_MAIN = "  hoverRows: 'off',"
const OLD_MAIN = "  hoverRows: 'on',"

function revertProduct () {
  /* ① main.js：真正的默认值（它经 kind:'hover-rows' 消息覆盖渲染层的初值） */
  const main = fs.readFileSync(MAIN, 'utf8')
  fs.writeFileSync(MAIN, swap(main, NEW_MAIN, OLD_MAIN, MAIN))
  /* ② index.html：渲染层的初值（消息到达之前用它） */
  const html = fs.readFileSync(HTML, 'utf8')
  fs.writeFileSync(HTML, swap(html, "V2ROWS = 'off'", "V2ROWS = 'on'", HTML))
}

/* ----------------------------------------------------- 跑命令并抓原始输出 */
function run (label, argv) {
  const r = spawnSync('node', argv, { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return { label, code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.error ? String(r.error) : '' }
}
/* 两套输出格式都要认：本项目的 report() 打 `[FAIL] 名称`；`node --test` 打 TAP 的 `not ok N - 名称`。
   只认前者会把 host 侧的失败漏成"无 [FAIL] 行"（A 那轮实测踩过）。 */
const failNames = (out) => [
  ...(out.match(/^\[FAIL\] [^\n]*/gm) || []),
  ...(out.match(/^not ok \d+ - [^\n]*/gm) || []),
  ...(out.match(/^\s*✖ [^\n]*/gm) || []),
]
const report = (label, r) => {
  const fails = failNames(r.out)
  console.log('  ' + label)
  console.log('    exit=' + r.code + (r.err ? '  spawnErr=' + r.err : ''))
  if (fails.length) { console.log('    失败项（原文名称）：'); for (const l of fails) console.log('      ' + l.trim()) }
  else console.log('    无失败项')
}

/* A：证明改动的断言（改前必须红） */
const ASSERTS = [
  ['A1 三行文字已删/图形全留（node runtime/electron/tests/hover-rows.mjs）', ['runtime/electron/tests/hover-rows.mjs']],
  /* A2 是**跨侧默认值绊线**：还原后窗口侧 DEFAULTS 变 'on'、宿主仍是 'off' ⇒ 立即红。
     ⚠️ 它**不是守恒守卫**（守恒守卫必须两态皆绿）—— 实测就是这么把它从 B 挪到 A 的：
     第一版把它放在 GUARDS 里，还原后它红了 ⇒ 反证被判"不成立"。分类错了，不是产品错了。 */
  ['A2 跨侧窗口键默认值绊线（node --test test/config.test.js）', ['--test', 'test/config.test.js']],
]
/* B：守恒型守卫（改前改后都该绿） */
const GUARDS = [
  ['B1 图标下两行 + 计划条守恒（node runtime/electron/tests/hover-metrics-row.mjs）', ['runtime/electron/tests/hover-metrics-row.mjs']],
  ['B2 日志去重守恒（node runtime/electron/tests/log-dedup.mjs）', ['runtime/electron/tests/log-dedup.mjs']],
]

const before = new Map(TARGETS.map((p) => [p, sha(p)]))
hr('0) 基线哈希（改动后 = 期望的最终状态）')
for (const [p, h] of before) console.log('  ' + h + '  ' + path.relative(ROOT, p))

const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'rowsproof-'))
for (const p of TARGETS) fs.copyFileSync(p, path.join(backup, path.basename(p)))
let restored = false
const restore = () => {
  if (restored) return
  for (const p of TARGETS) fs.copyFileSync(path.join(backup, path.basename(p)), p)
  restored = true
}

const baseResults = []
const fixedResults = []
const guardBase = []
let guardFixed = []
try {
  hr("1) 机械反向还原：两处默认值 token 'off' → 'on'（精确替换，未命中即抛错）")
  revertProduct()
  console.log('  已还原。还原后哈希：')
  for (const p of TARGETS) {
    const h = sha(p)
    console.log('    ' + h + '  ' + path.relative(ROOT, p) + (h === before.get(p) ? '  ⚠️ 与改动后相同 ⇒ 还原没生效' : '  ✓ 与改动后不同'))
    if (h === before.get(p)) throw new Error('还原没有生效：' + p)
  }

  hr('2) 在【还原后的基线】上跑 A（证明改动的断言：这里必须红）与 B（守恒守卫：这里必须绿）')
  for (const [label, argv] of ASSERTS) { const r = run(label, argv); baseResults.push(r); report(label, r) }
  for (const [label, argv] of GUARDS) { const r = run(label, argv); guardBase.push(r); report(label, r) }
} finally {
  restore()
  hr('3) 已还原为【改动后】状态，哈希复核')
  let same = true
  for (const p of TARGETS) {
    const h = sha(p)
    console.log('  ' + h + '  ' + path.relative(ROOT, p) + (h === before.get(p) ? '  ✓ 与改动后一致' : '  ❌ 与改动后不一致！'))
    same = same && h === before.get(p)
  }
  if (!same) { console.error('❌ 复原失败'); process.exitCode = 3 }
}

hr('4) 在【改动后】的树上再跑一遍同一批 A 与 B（A 必须转绿）')
for (const [label, argv] of ASSERTS) { const r = run(label, argv); fixedResults.push(r); report(label, r) }
guardFixed = []
for (const [label, argv] of GUARDS) { const r = run(label, argv); guardFixed.push(r); report(label, r) }

hr('5) 结论')
let ok = true
const verdict = (n, v) => { console.log((v ? '  ✓ ' : '  ❌ ') + n); ok = ok && v }
verdict('A 在改动前是红的（每条 A 都 exit!=0）', baseResults.every((r) => r.code !== 0))
verdict('A 在改动后是绿的（每条 A 都 exit==0）', fixedResults.every((r) => r.code === 0))
verdict('B 是守恒型守卫：还原基线也绿', guardBase.every((r) => r.code === 0))
verdict('B 在改动后也绿', guardFixed.every((r) => r.code === 0))
fs.rmSync(backup, { recursive: true, force: true })
console.log(ok ? '\n反证成立：改动前红、改动后绿，且守恒守卫两态皆绿。' : '\n反证不成立 —— 见上面逐项。')
process.exit(ok ? 0 : 1)
