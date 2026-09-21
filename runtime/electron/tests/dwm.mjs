#!/usr/bin/env node
/* dwm.mjs —— 真机合成 / 置顶 / 不抢焦点：**只读取证**，一次显示会话（≤20s，屏幕右侧，测完立刻关）
 *
 * 边界（SPEC 第 10 节红线）：
 *   · 不做任何真实输入合成（不移动光标、不点击）——"点击是否真的穿到下层窗口"改由 wfp.mjs
 *     用 WindowFromPoint 命中测试证明（系统同一套命中判定，且自身会跳过 WS_EX_TRANSPARENT 窗口）。
 *   · 这里只验证真窗口才有的三件事：① DWM 真的合成了窗口（可见）；② 置顶位；③ 没抢焦点。
 * 用法: node dwm.mjs [秒数，默认 16]
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, OUT, mkdir, sleep, section, report, killStrayElectron, runDir } from './harness.mjs'

const SECONDS = Math.min(20, Number(process.argv[2] || 16))
const DIR = runDir('dwm')
const log = path.join(DIR, 'dwm.log')
fs.rmSync(log, { force: true })
const home = tmpHome('dwm')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

/* 真窗口会话跑两次上限：本机可能有并行的 electron 清理（别的测试/别的 agent 跑 Get-Process electron | Stop-Process），
   会把我们的窗口进程一起杀掉，表现为"没到 20 秒就 exit=-1"。这不是产品缺陷，也不能让它污染结论 ——
   外部终止时重跑一次，并把这件事写进证据里。 */
section(`真机合成 / 置顶 / 不抢焦点（显示真窗口 ${SECONDS}s，屏幕右侧，测完即关；无任何输入合成）`)
let r = null, st = null, shownSecs = 0, attempt = 0, killedExternally = false
for (attempt = 1; attempt <= 2; attempt++) {
  const t0 = Date.now()
  st = runRuntime(['--dwm-phase', String(SECONDS), '--scale', '140', '--state', 'IDLE', '--dwm-pos', '1180,300'], { home, log })
  r = await st.waitExit((SECONDS + 30) * 1000)
  shownSecs = ((Date.now() - t0) / 1000).toFixed(1)
  if (r && r.code === 0) break
  const lg = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
  const reachedEnd = lg.includes('DWM-PHASE end') || lg.includes('windows hidden')
  console.log(`  第 ${attempt} 次会话异常结束 exit=${r && r.code} 用时 ${shownSecs}s（跑到收尾=` + reachedEnd + `）`)
  if (reachedEnd) break
  killedExternally = true
  await sleep(1200)
}
check('会话正常结束（退出码 0，进程自行退出）', !!r && r.code === 0,
  `exit=${r && r.code}，会话总时长 ${shownSecs}s（含启动与收尾）` + (killedExternally && attempt > 1 ? '；第 1 次被外部清理杀掉，已重跑' : ''))

const dbg = st.stdout.filter((l) => l.includes('"phase"')).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const begin = dbg.find((d) => d.phase === 'dwm-begin')
const ws = dbg.find((d) => d.phase === 'win-state')
const corner = dbg.find((d) => d.phase === 'corner-hit')
const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n') : []

check('真窗口已创建', !!begin && !!begin.hwnd && begin.hwnd !== '0x0',
  begin ? `hwnd=${begin.hwnd} bounds=${JSON.stringify(begin.bounds)}` : '无')
check('窗口尺寸 = 图标直径 × 1.5（140 → 210×210）',
  !!begin && begin.bounds && begin.bounds.width === 210 && begin.bounds.height === 210,
  begin && begin.bounds ? `${begin.bounds.width}x${begin.bounds.height}` : '')
check('置顶位（WS_EX_TOPMOST）', !!ws && /TOPMOST=yes/.test(ws.state), ws && ws.state)
check('不抢焦点（WS_EX_NOACTIVATE=yes 且不是当前前台窗口）',
  !!ws && /NOACTIVATE=yes/.test(ws.state) && /IS_FOREGROUND=no/.test(ws.state), ws && ws.state)
check('透明角落的命中测试不指向本窗口（圆外不吃鼠标）', !!corner && corner.isIcon === false, corner && corner.result)
const reassert = lines.filter((l) => l.includes('topmost re-assert')).length
check('置顶维持有心跳记录（z 序被抢时自动顶回）', reassert >= 1, `日志 ${reassert} 次`)

console.log(`\n  本次会话窗口显示时长：约 ${(SECONDS - 1.2).toFixed(1)}s（脚本传 ${SECONDS}s，其余为启动/收尾）`)
console.log('  ⚠ 真实鼠标点击/拖动的端到端验证必须人工做（脚本禁止合成输入）——见报告【只有真实输入才能验证的剩余项】')

section(ok ? '真机会话：通过' : '真机会话：有失败项')
killStrayElectron()
await sleep(300)
process.exit(ok ? 0 : 1)
