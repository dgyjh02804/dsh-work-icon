#!/usr/bin/env node
/* probe-golden-conditions.mjs —— 受控条件实验：找出哪种条件会把「黄金样本比对」推红
 *
 * 只读诊断脚本；不改任何产品代码。
 * 每个条件用一个独立临时 home（隔离，绝不碰 %USERPROFILE%\.dsh\work-icon）。
 * 用法: node probe-golden-conditions.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HERE, RUNTIME, OUT, GOLDEN, ELECTRON, mkdir, tmpHome, killStrayElectron, runDir } from './harness.mjs'

const MAP = { IDLE: 'IDLE', THINKING: 'THINK', WORKING: 'WORK', WAITING: 'WAIT', SUCCESS: 'OK', ERROR: 'ERR', DISCONNECTED: 'OFF' }
const STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']

const CONDITIONS = [
  ['baseline(等价 shots.mjs: settle 420, hidden)', ['--settle-ms', '420']],
  ['hover=off 显式 (settle 1600)', ['--settle-ms', '1600', '--test-hover', 'off']],
  ['hover=on  (settle 1600)', ['--settle-ms', '1600', '--test-hover', 'on']],
  ['settle 120 (过早抓图)', ['--settle-ms', '120']],
  ['settle 60  (过早抓图)', ['--settle-ms', '60']]
]

function diffPercent (ref, test) {
  const r = spawnSync('node', [path.join(GOLDEN, 'compare.mjs'), ref, test], { encoding: 'utf8' })
  const s = (r.stdout || '') + (r.stderr || '')
  const m = s.match(/差异占比\s*([\d.]+)%\s*vs\s*允许\s*([\d.]+)%\s*->\s*(PASS|FAIL)/)
  return m ? { ratio: Number(m[1]), allow: Number(m[2]), verdict: m[3] } : { ratio: NaN, allow: NaN, verdict: 'ERR' }
}

const root = runDir('probe-conditions')
console.log('条件'.padEnd(42) + 'IDLE    THINK   WORK    WAIT    OK      ERR     OFF     最大     判定')
const summary = []
for (let i = 0; i < CONDITIONS.length; i++) {
  const [name, extra] = CONDITIONS[i]
  const dir = mkdir(path.join(root, 'c' + i))
  const home = tmpHome('probe-c' + i)
  const args = ['--shot', '240', '--bg', 'dark', '--shot-states', STATES.join(','),
    '--out', dir, '--hidden', '--home', home, '--log', path.join(dir, 'run.log'), ...extra]
  const r = spawnSync(ELECTRON, [RUNTIME, ...args], { encoding: 'utf8', windowsHide: true, timeout: 180000,
    env: Object.assign({}, process.env, { ELECTRON_DISABLE_WARNINGS: '1' }) })
  const got = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length
  const cells = []
  const nums = []
  let anyFail = false
  for (const st of STATES) {
    const test = path.join(dir, `shot-${st}-240-dark.png`)
    if (!fs.existsSync(test)) { cells.push('--     '); continue }
    const d = diffPercent(path.join(GOLDEN, 'refs', `ref-${MAP[st]}-240-dark.png`), test)
    cells.push((Number.isNaN(d.ratio) ? '-' : d.ratio.toFixed(2) + '%').padEnd(8))
    if (!Number.isNaN(d.ratio)) nums.push(d.ratio)
    if (d.verdict !== 'PASS') anyFail = true
  }
  const max = nums.length ? Math.max(...nums) : NaN
  const line = name.padEnd(40).slice(0, 40) + '  ' + cells.join('') + (Number.isNaN(max) ? '-' : max.toFixed(3) + '%').padEnd(9) +
    (got !== 7 ? ` 抓图 ${got}/7` : '') + '  ' + (anyFail ? 'FAIL' : 'PASS')
  console.log(line)
  summary.push({ name, max, anyFail })
  void r
}
killStrayElectron()
const red = summary.filter((s) => s.anyFail)
console.log('\n结论：' + (red.length
  ? red.length + ' 个条件被推红 -> ' + red.map((s) => `${s.name}(max ${s.max.toFixed(3)}%)`).join('; ')
  : '所有条件都绿'))
