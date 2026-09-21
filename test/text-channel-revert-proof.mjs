#!/usr/bin/env node
/* text-channel-revert-proof.mjs —— 「改动的断言在改动前确实是红的」反证装置（一次性取证工具）
 *
 * 为什么不用 `git stash` / `git checkout HEAD`：
 *   本仓库工作区**不是干净基线**（HEAD 比当前少了最近几轮改动：main.js / index.html / reducer.js /
 *   多个 tests 都是 modified）。拿 HEAD 当对照会把**别人的改动**一起回滚 ⇒ 红因不纯。
 *   ⇒ 这里走**机械反向还原**：把本轮 text 通道的两处产品改动，用**精确字符串替换**还原成改前形态；
 *     **任何一处没命中就抛错退出**（绝不静默半还原）。
 *
 * 它同时把两类东西分开标注（用户要求）：
 *   A【证明改动的断言】—— 改动前必须红、改动后必须绿（v2-fields.mjs 的 ⑥/⑥b + 契约守卫测试）
 *   B【守恒型守卫】—— 改动前后**都该绿**（用来证明"我没有为了修这个而弄坏别的"）
 *
 * 红线遵守：不碰生产图标进程（只 spawn 自己的 --hidden 实例，由 harness 按本轮 PID/home 清理）；
 *          不 commit / 不 git add / 不同步 profile；不删除任何套件锁。
 * 用法: node test/text-channel-revert-proof.mjs
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = path.join(ROOT, 'runtime', 'electron', 'main.js')
const HTML = path.join(ROOT, 'runtime', 'electron', 'index.html')
const TARGETS = [MAIN, HTML]

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
const hr = (t) => console.log('\n================ ' + t + ' ================')

/* ----------------------------------------------------- 机械替换（未命中即抛错） */
function cut (src, startMarker, endMarker, file) {
  const a = src.indexOf(startMarker)
  const b = src.indexOf(endMarker)
  if (a < 0) throw new Error('反向还原失败：' + file + ' 里找不到起始标记 ' + JSON.stringify(startMarker.slice(0, 60)))
  if (b < 0 || b <= a) throw new Error('反向还原失败：' + file + ' 里找不到结束标记 ' + JSON.stringify(endMarker.slice(0, 60)))
  return src.slice(0, a) + src.slice(b)
}
function swap (src, from, to, file) {
  const n = src.split(from).length - 1
  if (n === 0) throw new Error('反向还原失败：' + file + ' 里找不到要替换的片段 ' + JSON.stringify(from.slice(0, 80)))
  if (n > 1) throw new Error('反向还原失败：' + file + ' 里该片段出现 ' + n + ' 次（不唯一，拒绝盲替换） ' + JSON.stringify(from.slice(0, 80)))
  return src.split(from).join(to)
}

/* 改前的两处产品形态（逐字抄自本轮改动前的原文） */
const OLD_MAIN_CASE = `    case 'text':
      /* text 走 kind（宿主协议 v2 只增补了它）：原样转给渲染进程，revision 交给渲染层驱动跳动 */
      if (msg.text && typeof msg.text === 'object') {
        sendToRenderer({ kind: 'text', revision: msg.text.revision, activityText: msg.text.activityText,
          thoughtTail: msg.text.thoughtTail, bodyTail: msg.text.bodyTail })
        log('text -> renderer revision=' + JSON.stringify(msg.text.revision))
      } else log('WARN text 载荷非对象，忽略')
      break`
const NEW_MAIN_CASE = `    case 'text':
      handleTextMessage(msg)
      break`

const OLD_HTML_DECL = '  todos: null, cost: null, context: null, tokens: null, text: null, textRev: -1 }'
const OLD_HTML_RENDER = `function v2RenderText () {
  var s2 = V2.text, s = ''
  if (s2) {
    var out = ''
    if (s2.activityText) out += '<div class="tx">' + String(s2.activityText).slice(0, 80) + '</div>'
    if (s2.thoughtTail) out += '<div class="tx dim2">' + String(s2.thoughtTail).slice(0, 80) + '</div>'
    if (s2.bodyTail) out += '<div class="tx">' + String(s2.bodyTail).slice(0, 80) + '</div>'
    if (out) s = '<div class="v2sec"><div class="sh">文本 · 第 ' + V2.textRev + ' 次更新</div>' + out + '</div>'
  }
  sec('text', s)
  return s
}`
const OLD_HTML_BRANCH = `  } else if (msg.kind === 'text') {
    /* revision 单调递增：变化才重画（用它驱动"跳动"，不自己造时间戳） */
    if (typeof msg.revision !== 'number' || msg.revision !== V2.textRev) {
      V2.textRev = typeof msg.revision === 'number' ? msg.revision : V2.textRev
      V2.text = { activityText: msg.activityText, thoughtTail: msg.thoughtTail, bodyTail: msg.bodyTail }
      V2.caps.text = true; V2.any = true
      BRIDGE.log('v2 text revision=' + V2.textRev + ' thought=' + String(msg.thoughtTail || '').slice(0, 24))
      if (V2.panelOpen) (function(){try{v2RenderPanel()}catch(e){BRIDGE.log('v2RP ERR: '+(e&&e.message?e.message:String(e)))}})(); else if (V2.hot) { v2RenderHover(); v2LogRender() }
    }`

function revertProduct () {
  /* main.js：① 去掉新加的 text 通道辅助块 ② text 分支配回旧判据 */
  let main = fs.readFileSync(MAIN, 'utf8')
  main = cut(main,
    '/* -------------------------------------------------------------- text 通道',
    '/* ------------------------------------------------------------------ stdio */', MAIN)
  main = swap(main, NEW_MAIN_CASE, OLD_MAIN_CASE, MAIN)
  fs.writeFileSync(MAIN, main)

  /* index.html：① V2 声明 ② v2RenderText ③ text 消息分支 */
  let html = fs.readFileSync(HTML, 'utf8')
  html = swap(html, '  todos: null, cost: null, context: null, tokens: null, text: null, textRev: -1, textDegraded: null }', OLD_HTML_DECL, HTML)
  /* 新版 v2RenderText 用"首尾标记切"（注释较长，避免逐字复制出错） */
  html = cut(html, 'function v2RenderText () {', '/* ---------- 消息接入（独立监听器） ---------- */', HTML)
  /* cut 会连注释头一起切掉，这里补回函数与注释头之间的空行结构 */
  html = swap(html, '/* ---------- 消息接入（独立监听器） ---------- */',
    OLD_HTML_RENDER + '\n/* ---------- 消息接入（独立监听器） ---------- */', HTML)
  html = cut(html, "  } else if (msg.kind === 'text') {", "  } else if (msg.kind === 'theme') {", HTML)
  html = swap(html, "  } else if (msg.kind === 'theme') {", OLD_HTML_BRANCH + "\n  } else if (msg.kind === 'theme') {", HTML)
  fs.writeFileSync(HTML, html)
}

/* ----------------------------------------------------- 跑命令并抓原始输出 */
function run (label, argv) {
  const r = spawnSync('node', argv, { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const out = (r.stdout || '') + (r.stderr || '')
  return { label, code: r.status, out, err: r.error ? String(r.error) : '' }
}
const nameLines = (out, tag) => (out.match(new RegExp('^\\[(?:' + tag + ')\\] [^\\n]*', 'gm')) || [])
/* ⚠️ 两套输出格式都要认：本项目的 report() 打 `[FAIL] 名称`；`node --test` 打 TAP 的
   `not ok N - 名称` / `✖ 名称`。只认前者会把 A1 的失败漏成"无 [FAIL] 行"（实测踩过）。 */
const failNames = (out) => {
  const a = nameLines(out, 'FAIL')
  const b = out.match(/^not ok \d+ - [^\n]*/gm) || []
  const c = out.match(/^\s*✖ [^\n]*/gm) || []
  return [...a, ...b, ...c]
}

/* A：证明改动的断言（改前必须红） */
const ASSERTS = [
  ['A1 跨侧契约守卫（node --test test/text-channel-contract.test.js）', ['--test', 'test/text-channel-contract.test.js']],
  ['A2 窗口侧行为（node runtime/electron/tests/v2-fields.mjs）', ['runtime/electron/tests/v2-fields.mjs']],
]
/* B：守恒型守卫（改前改后都该绿） */
const GUARDS = [
  ['B1 宿主套件子集（protocol/text/reducer/panel-wire）', ['--test', 'test/protocol.test.js', 'test/text.test.js', 'test/reducer-states.test.js', 'test/panel-wire.test.js']],
  ['B2 面板留痕防退化（node runtime/electron/tests/log-dedup.mjs）', ['runtime/electron/tests/log-dedup.mjs']],
  ['B3 stdio 协议（node runtime/electron/tests/protocol.mjs）', ['runtime/electron/tests/protocol.mjs']],
]
/* C：**归因用**（不是我的守卫）：黄金样本比对在整轮 run-all 里是红的。
   要回答"是不是我改坏的"，只能在两态各跑一次 —— 两态都红 ⇒ 与本次改动无关。
   （另有旁证：golden/refs/* 的 mtime 是 2026-09-12，比本轮所有渲染改动都早 8 天。） */
const ATTRIB = [
  ['C1 黄金样本比对（归因：它与本次改动是否相关）', ['runtime/electron/tests/compare-golden.mjs']],
]
const goldLines = (out) => (out.match(/^\s+(?:IDLE|THINKING|WORKING|WAITING|SUCCESS|ERROR|DISCONNECTED)\s+[\d.]+%\s+\w+/gm) || [])
  .concat(out.match(/^\s+最大 [\d.]+%[^\n]*/gm) || [])
const report = (set, r) => {
  const fails = failNames(r.out)
  console.log('  ' + r.label)
  console.log('    exit=' + r.code + (r.err ? '  spawnErr=' + r.err : ''))
  if (fails.length) { console.log('    失败项（原文名称）：'); for (const l of fails) console.log('      ' + l.trim()) }
  else console.log('    无失败项')
}

/* ----------------------------------------------------- 主流程 */
const before = new Map(TARGETS.map((p) => [p, sha(p)]))
hr('0) 基线哈希（改动后 = 期望的最终状态）')
for (const [p, h] of before) console.log('  ' + h + '  ' + path.relative(ROOT, p))

const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'textproof-'))
for (const p of TARGETS) fs.copyFileSync(p, path.join(backup, path.basename(p)))
let restored = false
const restore = () => {
  if (restored) return
  for (const p of TARGETS) fs.copyFileSync(path.join(backup, path.basename(p)), p)
  restored = true
}

let rs = new Map()
const baseResults = []
const fixedResults = []
let baseGold = null
let fixedGold = null
try {
  hr('1) 机械反向还原两处产品改动（精确替换，未命中即抛错）')
  revertProduct()
  console.log('  已还原。还原后哈希：')
  for (const p of TARGETS) console.log('    ' + sha(p) + '  ' + path.relative(ROOT, p) + (sha(p) === before.get(p) ? '  ⚠️ 与改动后相同 ⇒ 还原没生效' : '  ✓ 与改动后不同'))
  for (const p of TARGETS) if (sha(p) === before.get(p)) throw new Error('还原没有生效：' + p)

  hr('2) 在【还原后的基线】上跑 A（证明改动的断言：这里必须红）与 B（守恒守卫：这里必须绿）')
  for (const [label, argv] of ASSERTS) { const r = run(label, argv); baseResults.push(r); report('A', r) }
  for (const [label, argv] of GUARDS) { const r = run(label, argv); rs.set(label, r); report('B', r) }
  for (const [label, argv] of ATTRIB) {
    const r = run(label, argv); baseGold = r
    console.log('  ' + r.label + '   exit=' + r.code + '（基线）')
    for (const l of goldLines(r.out)) console.log('      ' + l.trim())
  }
} finally {
  restore()
  hr('3) 已还原为【改动后】状态，哈希复核')
  for (const p of TARGETS) {
    const h = sha(p)
    console.log('  ' + h + '  ' + path.relative(ROOT, p) + (h === before.get(p) ? '  ✓ 与改动后一致' : '  ❌ 与改动后不一致！'))
  }
  for (const p of TARGETS) if (sha(p) !== before.get(p)) { console.error('❌ 复原失败：' + p); process.exitCode = 3 }
}

hr('4) 在【改动后】的树上再跑一遍同一批 A 与 B（A 必须转绿）')
for (const [label, argv] of ASSERTS) { const r = run(label, argv); fixedResults.push(r); report('A', r) }
const fixedGuards = []
for (const [label, argv] of GUARDS) { const r = run(label, argv); fixedGuards.push(r); report('B', r) }
for (const [label, argv] of ATTRIB) {
  const r = run(label, argv); fixedGold = r
  console.log('  ' + r.label + '   exit=' + r.code + '（改动后）')
  for (const l of goldLines(r.out)) console.log('      ' + l.trim())
}

hr('5) 结论')
let ok = true
const verdict = (n, v) => { console.log((v ? '  ✓ ' : '  ❌ ') + n); ok = ok && v }
verdict('A 在改动前是红的（每条 A 都 exit!=0）', baseResults.every((r) => r.code !== 0))
verdict('A 在改动后是绿的（每条 A 都 exit==0）', fixedResults.every((r) => r.code === 0))
verdict('B 是守恒型守卫：还原基线也绿', [...rs.values()].every((r) => r.code === 0))
verdict('B 在改动后也绿', fixedGuards.every((r) => r.code === 0))
verdict('C 黄金样本比对在【两态】都是红的 ⇒ 这一项与本次改动无关（归因，不是我的守卫）',
  !!baseGold && !!fixedGold && baseGold.code !== 0 && fixedGold.code !== 0)
fs.rmSync(backup, { recursive: true, force: true })
console.log(ok ? '\n反证成立：改动前红、改动后绿，且守恒守卫两态皆绿。' : '\n反证不成立 —— 见上面逐项。')
process.exit(ok ? 0 : 1)
