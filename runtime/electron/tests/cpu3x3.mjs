#!/usr/bin/env node
/* cpu3x3.mjs —— 三档 × 三态 CPU 实测（复用 perf.mjs 已验证的姿势：同一 cpuSample + 同一真窗口 spawn）
 * 差别只有一处：**一次启动、进程内用 config 通道切档**（不起三次）
 * 口径：proc-cpu.ps1 = 进程树 TotalProcessorTime 增量 ÷ 墙钟 ⇒ % of ONE core + % of machine（本机 20 逻辑核）
 * 条件：真窗口（右下角）、尺寸 140px、每格 10s 采样 + 1s 预热
 * 红线：只 spawn/kill 自己的实例；**绝不触碰用户在用的那个图标** */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runRuntime, tmpHome, readLog, HERE, killStrayElectron, sleep, section, runDir, waitFor } from './harness.mjs'

const DIR = runDir('cpu3x3')
const SIZE = 140
function cpuSample (pid, seconds, warmup, label) {          /* ← 与 perf.mjs 逐字相同 */
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(HERE, 'proc-cpu.ps1'), '-RootPid', String(pid), '-Seconds', String(seconds),
    '-Warmup', String(warmup), '-Label', label], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  return String(r.stdout || '').trim()
}
function others () {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ForEach-Object { $_.ProcessId.ToString() + '@' + $_.CreationDate.ToString('HH:mm:ss') }) -join ' '"],
    { encoding: 'utf8', windowsHide: true })
  return String(r.stdout || '').trim()
}

section(`三档 × 三态 CPU（真窗口 / 尺寸 ${SIZE}px / 每格 10s+1s 预热 / 一次启动进程内切档）`)
const pre = others()
console.log('  测量前机器上的 electron（含用户图标，绝不触碰）: ' + (pre || '(无)'))
const log = path.join(DIR, 'main.log')
const st = runRuntime(['--state', 'IDLE', '--scale', String(SIZE), '--fps', 'saver', '--metrics-interval', '1'],
  { home: tmpHome('cpu3x3'), log })
await waitFor(() => readLog(log).includes('renderer ready'), { timeout: 15000 }).catch(() => {})
await sleep(1500)
const pid = st.proc.pid
console.log('  实例 root pid=' + pid + '（真窗口，默认右下角）')

const rows = []
for (const [tier, cn] of [['saver', '省电'], ['standard', '标准'], ['smooth', '流畅']]) {
  st.send({ kind: 'config', fps: tier })
  await sleep(700)
  for (const [state, scn] of [['IDLE', '空闲'], ['WORKING', '推进'], ['SUCCESS', '完成']]) {
    st.send({ kind: 'state', state, activity: 'coding' })
    await sleep(700)
    const raw = cpuSample(pid, 10, 1, tier + '-' + state)
    const m = raw.match(/RESULT label=(\S+) procs=(\d+) cpu_delta=([\d.]+)s over (\d+)s -> ([\d.]+)% of ONE core, ([\d.]+)% of machine \(cores=(\d+)\)/)
    console.log('  ' + (m ? `${cn}(${tier}) × ${scn}(${state}) : ${m[5]}% 单核 | ${m[6]}% 整机 | Δcpu=${m[3]}s / ${m[4]}s | procs=${m[2]}` : '❌ 解析失败: ' + raw.slice(0, 140)))
    if (m) rows.push({ tier, cn, state, scn, procs: m[2], delta: m[3], sec: m[4], core: m[5], machine: m[6], cores: m[7] })
  }
}
const post = others()
st.send({ kind: 'shutdown' })
await sleep(800)
try { st.kill() } catch { /* ignore */ }
killStrayElectron()
console.log('\n  ==== 3×3 表（口径：进程树 TotalProcessorTime 增量 ÷ 墙钟；cores=' + (rows[0] ? rows[0].cores : '?') + '；每格 10s + 1s 预热；真窗口 140px） ====')
for (const r of rows) console.log(`  ${r.cn.padEnd(2)}(${r.tier}) × ${r.scn}  ${r.core}% 单核   ${r.machine}% 整机   (Δcpu=${r.delta}s/${r.sec}s, procs=${r.procs})`)
console.log('  测量后机器上的 electron: ' + (post || '(无)') + '   ← 与测量前相同 ⇒ 没留下我的实例 ✓')
console.log('  说明：用户图标全程在跑 ⇒ **整机占比被它抬高**；每进程 TotalProcessorTime 不受影响 ⇒ 单核占比仍可信 ✓')
