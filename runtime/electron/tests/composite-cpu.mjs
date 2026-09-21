#!/usr/bin/env node
/* composite-cpu.mjs —— 回答参考表那条技术规则：**只走合成层的持续动效，CPU 是否≈静止？**
 * 三种驱动各跑一次真窗口会话（≈10.5s，右下角，不接收输入）：
 *   static 完全静止 | composite 30fps 只动 transform/opacity/background-position | paint 30fps 动 width/filter:blur/box-shadow
 * 基准：本机 20 逻辑核；百分比 = **单核占比**（Electron `app.getAppMetrics()` 的 percentCPUUsage 求和）
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

const DIR = path.join(new URL('.', import.meta.url).pathname.replace(/^\//, ''), 'composite-cpu')
const MODES = [['static', '完全静止'], ['composite', '合成层 30fps'], ['paint', '重绘路径 30fps']]
const res = {}
for (const [m] of MODES) {
  const out = path.join(DIR, 'result-' + m + '.json')
  fs.rmSync(out, { force: true })
  const t0 = Date.now()
  const r = spawnSync(ELECTRON, [DIR, '--mode', m, '--out', out], { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 40000 })
  const line = (String(r.stdout || '').match(/RESULT (\{.*\})/) || [])[1]
  console.log(m.padEnd(10) + '会话 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's  ' + (line || '（读文件）'))
  try { res[m] = JSON.parse(fs.readFileSync(out, 'utf8')) } catch { res[m] = null }
  await sleep(700)
}
console.log('\n===== 三种驱动方式的 CPU（同一套 DOM：H2 图标 + 无底板悬浮层 + 3 个非线性图形面板）=====')
for (const [m, n] of MODES) {
  const r = res[m]
  if (!r) { console.log('  ' + m + ' 无数据'); continue }
  console.log('  ' + m.padEnd(10) + n.padEnd(16) + '稳态均值 ' + String(r.cpu).padStart(5) + '%   峰值 ' + String(r.peak).padStart(5) + '%   内存 ' + r.memMB + ' MB')
}
if (res.static && res.composite) {
  const d = +(res.composite.cpu - res.static.cpu).toFixed(2)
  console.log('\n★ 合成层持续动效 vs 完全静止：差 ' + d + ' 个百分点（单核占比）' + (d <= 0.5 ? '  ✅ 几乎无差 → "一直在动"可以成为所有档位的默认' : d <= 2 ? '  ⚠ 有可测差异，但很小 → 建议仍默认开启，由档位调强度' : '  ❌ 差异明显 → 省电档仍需静止'))
}
if (res.composite && res.paint) {
  console.log('★ 重绘路径 vs 合成层：贵 ' + (+(res.paint.cpu - res.composite.cpu).toFixed(2)) + ' 个百分点（' + (res.composite.cpu ? (res.paint.cpu / Math.max(res.composite.cpu, 0.01)).toFixed(1) : '∞') + '×）')
}
