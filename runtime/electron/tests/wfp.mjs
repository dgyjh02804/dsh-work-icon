#!/usr/bin/env node
/* wfp.mjs —— 「透明区域不吃鼠标」的确定性取证（不依赖光标位置）
 *
 * WindowFromPoint 是系统用来决定"这次点击该送给谁"的那个命中测试函数，
 * 而且它会**跳过带 WS_EX_TRANSPARENT 的窗口** —— 所以它是"透明区域是否吃鼠标"最直接的客观证据。
 * 本机实测：光标会被别的进程抢走（连续两次 SetCursorPos 读回相差数百像素），真实鼠标自动化不可复现，
 * 因此这里用不依赖光标的方式取证，并把"真实点击穿透"的历史观测单独列出。
 * 全程显示真窗口 ≤ 20s，屏幕角落，测完即关。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runRuntime, tmpHome, OUT, mkdir, sleep, section, report, killStrayElectron, runDir } from './harness.mjs'

const DIR = runDir('wfp')
const log = path.join(DIR, 'wfp.log')
fs.rmSync(log, { force: true })
const home = tmpHome('wfp')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

section('点击穿透取证：WindowFromPoint 命中测试（显示真窗口 ≤ 20s，放在屏幕中部）')
const t0 = Date.now()
const st = runRuntime(['--state', 'IDLE', '--scale', '140', '--dwm-pos', '420,320', '--wfp-probe', '--exit-after', '25'], { home, log })
const r = await st.waitExit(60000)
const secs = ((Date.now() - t0) / 1000).toFixed(1)
check('会话正常结束（退出码 0）', !!r && r.code === 0, `exit=${r && r.code} 显示+启动共 ${secs}s`)

const dbg = st.stdout.filter((l) => l.includes('"phase"')).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const calib = dbg.find((d) => d.phase === 'wfp-calib')
const rows = dbg.filter((d) => d.phase === 'wfp')
const sum = dbg.find((d) => d.phase === 'wfp-summary')
const lg = fs.readFileSync(log, 'utf8')

for (const l of lg.split('\n').filter((x) => x.includes('WFP-'))) console.log('    ' + l.replace(/^\[[^\]]+\]\s*/, ''))
console.log('    窗口 hwnd = ' + (calib && calib.hwnd))

check('坐标空间已标定', !!calib && calib.space > 0, calib ? `space=${calib.space}` : '未标定')
const c1 = rows.find((x) => x.tag === 'center-ignore-off')
const c2 = rows.find((x) => x.tag === 'center-ignore-on')
const c3 = rows.find((x) => x.tag === 'corner-ignore-on')
check('ignore=off：圆心处的命中测试指向本窗口（可拦截）', !!c1 && c1.isIcon === true, c1 && c1.result)
check('ignore=on：圆心处不再命中本窗口（系统已把本窗口跳过）', !!c2 && c2.isIcon === false, c2 && c2.result)
check('ignore=on：圆外透明处不命中本窗口（点击会落到下面的窗口）', !!c3 && c3.isIcon === false, c3 && c3.result)
check('exstyle：ignore=off 时 WS_EX_TRANSPARENT 被清掉', !!sum && /TRANSPARENT=no/.test(sum.exstyleIgnoreOff), sum && sum.exstyleIgnoreOff)
check('exstyle：ignore=on 时 WS_EX_TRANSPARENT 置上（系统级穿透标记）', !!sum && /TRANSPARENT=yes/.test(sum.exstyleIgnoreOn), sum && sum.exstyleIgnoreOn)

console.log('\n    历史观测（同一机制的真实鼠标点击，见 test/out/dwm/*.log）：')
console.log('      · 圆外透明处真实左键点击 → 下层探针窗口收到 mousedown（probeHits 0→1），本窗口渲染层未收到')
console.log('      · 圆心处真实左键点击 → 本窗口渲染层收到 mousedown 并触发"聚焦 DSH"（日志 "click on icon -> focus DSH"）')
console.log('      · 圆心处真实鼠标拖拽 → 渲染层收到 mousedown/mousemove/mouseup，窗口位移并落盘位置')
console.log('    说明：本机有别的进程在抢光标（连续两次 SetCursorPos 读回相差数百像素），')
console.log('          所以真实鼠标自动化无法稳定复现，改用上面的 WindowFromPoint + exstyle 做确定性取证。')

section(ok ? '点击穿透取证：通过' : '点击穿透取证：有失败项')
killStrayElectron()
await sleep(300)
const left = spawnSync('powershell.exe', ['-NoProfile', '-Command',
  "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: 'utf8' }).stdout.trim()
console.log('    收尾后残留 electron 进程数 = ' + left)
process.exit(ok ? 0 : 1)
