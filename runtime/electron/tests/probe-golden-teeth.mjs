#!/usr/bin/env node
/* probe-golden-teeth.mjs —— 「牙齿」验证：新测试在**真实渲染差异**下必须仍然报红
 *
 * 目的：证明 compare-golden.mjs 的修复是"消除外部状态依赖"，**不是**放宽阈值。
 * 做法：用 --test-hover on 渲染一组**确实不同**的七态截图（hot=true 会触发 6% 缩放），
 *       再把它喂给 compare-golden.mjs 导出的同一套比对逻辑 —— 必须全部 FAIL。
 * 全部离屏（--hidden），不显示窗口、不合成输入、不移动光标。
 * 用法: node probe-golden-teeth.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HERE, RUNTIME, OUT, ELECTRON, mkdir, tmpHome, killStrayElectron, runDir } from './harness.mjs'
import { compareSevenStates } from './compare-golden.mjs'

const STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']
const dir = runDir('teeth-hover')
const home = tmpHome('teeth')

console.log('=== 用 --test-script 立刻开 hover 渲染一组「确实不同」的七态（离屏，hot=true → 6% 缩放）===')
/* 注：--shot 模式有硬超时 max(8000, settleMs+8000)，所以用 test-script 在 300ms 就把 hover 打开，
   并把 settle 压到 500ms，让七态都能在超时前抓完。 */
const scriptPath = path.join(dir, 'script.json')
fs.writeFileSync(scriptPath, JSON.stringify([{ at: 300, hover: true }]), 'utf8')
const r = spawnSync(ELECTRON, [RUNTIME,
  '--shot', '240', '--bg', 'dark', '--shot-states', STATES.join(','),
  '--out', dir, '--hidden', '--test-script', scriptPath,
  '--settle-ms', '500', '--home', home, '--log', path.join(dir, 'run.log')],
{ encoding: 'utf8', windowsHide: true, timeout: 180000 })
const shots = fs.readdirSync(dir).filter((f) => f.startsWith('shot-') && f.endsWith('-dark.png'))
console.log(`  抓图 ${shots.length}/7  (electron exit=${r.status})`)
void mkdir

console.log('\n=== 把同一套比对逻辑（compare-golden.mjs 导出的 compareSevenStates）喂给它 ===')
const res = compareSevenStates(dir)
for (const row of res.rows) {
  console.log('  ' + row.st.padEnd(16) + (row.ratio === null ? '-' : row.ratio + '%').padEnd(12) + row.verdict)
}
console.log(`  最大 ${Number.isNaN(res.max) ? '-' : res.max.toFixed(3) + '%'}  平均 ${Number.isNaN(res.avg) ? '-' : res.avg.toFixed(3) + '%'}  -> ${res.pass ? 'PASS' : 'FAIL'}`)

const compared = res.rows.filter((x) => x.verdict !== 'ERR')
const passed = res.rows.filter((x) => x.verdict === 'PASS').length
const failed = compared.filter((x) => x.verdict === 'FAIL').length
console.log(`\n结论：可比 ${compared.length}/7 态，其中 FAIL ${failed} 态、PASS ${passed} 态 -> ` +
  (compared.length === 7 && passed === 0 ? '牙齿完好（真实渲染差异下不可能判 PASS）' : '⚠ 需要检查'))
killStrayElectron()
process.exit(compared.length === 7 && passed === 0 ? 0 : 1)
