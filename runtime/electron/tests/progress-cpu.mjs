#!/usr/bin/env node
/* progress-cpu.mjs —— 跑三档 CPU 实测（每档一次真窗口会话，单次 ≈18s ≤ 20s；窗口在右下角，不接收输入）
 * 输出：命令行表格 + tests/progress-cpu/result-<tier>.json
 */
/* ⚠️ 这个实测台**必须起可见窗口**才能量到真实 CPU。
   2026-09-12 红线：源目录里不许起可见实例 ⇒ 必须显式声明你知情，否则拒绝运行。 */
if (!process.argv.includes('--i-know-this-shows-a-window')) {
  console.error('【拒绝运行】' + `这个实测台会在屏幕上起一个可见窗口` +
    '（否则量不到真实 CPU）。确已知情并同意，请加参数：--i-know-this-shows-a-window')
  process.exit(3)
}

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ELECTRON, sleep } from './harness.mjs'

const DIR = path.join(new URL('.', import.meta.url).pathname.replace(/^\//, ''), 'progress-cpu')
const TIERS = ['eco', 'standard', 'smooth']
const SCEN = [['idle', 'IDLE 悬浮'], ['panel', '面板展开'], ['advance', '进度推进'], ['complete', '完成瞬间']]
const res = {}

for (const tier of TIERS) {
  const out = path.join(DIR, 'result-' + tier + '.json')
  fs.rmSync(out, { force: true })
  const t0 = Date.now()
  const r = spawnSync(ELECTRON, [DIR, '--tier', tier, '--out', out], {
    cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 60000
  })
  const line = (String(r.stdout || '').match(/RESULT (\{.*\})/) || [])[1]
  console.log(`${tier.padEnd(9)} 会话 ${((Date.now() - t0) / 1000).toFixed(0)}s  ${line ? 'OK' : '（读文件）'}`)
  try { res[tier] = JSON.parse(fs.readFileSync(out, 'utf8')).scenarios } catch { res[tier] = null }
  await sleep(800)
}

console.log('\n===== 进度条动效 CPU 实测（本机 20 逻辑核；百分比 = 单核占比）=====')
console.log('档位'.padEnd(10) + SCEN.map(([, n]) => n.padEnd(14)).join('') + '内存')
for (const tier of TIERS) {
  const s = res[tier]
  if (!s) { console.log(tier.padEnd(10) + '（无数据）'); continue }
  console.log(tier.padEnd(10) + SCEN.map(([k]) => ((s[k].cpu + '%').padEnd(14))).join('') + (s.idle.memMB + ' MB'))
}
console.log('\n峰值（采样窗口内的最高单次）：')
for (const tier of TIERS) {
  const s = res[tier]
  if (!s) continue
  console.log('  ' + tier.padEnd(9) + SCEN.map(([k]) => `${k}=${s[k].peak}%`).join('  '))
}
