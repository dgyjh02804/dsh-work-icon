#!/usr/bin/env node
/* perf.mjs —— SPEC 第 8 节第 4 款性能预算实测（尺寸 140px，本机 20 逻辑核）
 *   CPU：PowerShell TotalProcessorTime 增量（与 spike\Measure-ProcCpu.ps1 同口径），按进程树汇总
 *   内存：working set 合计（同口径）+ 运行时自己报的 app.getAppMetrics
 * 隐藏窗口的 CPU 不代表真实开销（Chromium 不为不可见窗口合成），所以：
 *   - 内存：隐藏窗口量（进程都在，口径最干净）
 *   - CPU：真窗口量（显示在右下角，单次 ≤ 20s，测完立刻关）
 * 用法: node perf.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runRuntime, tmpHome, readLog, OUT, HERE, mkdir, killStrayElectron, sleep, section, runDir } from './harness.mjs'

const DIR = runDir('perf')
const SIZE = 140
function cpuSample (pid, seconds, warmup, label) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(HERE, 'proc-cpu.ps1'), '-RootPid', String(pid), '-Seconds', String(seconds),
    '-Warmup', String(warmup), '-Label', label], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  return String(r.stdout || '').trim()
}
function lastMetrics (log) {
  const l = readLog(log).split('\n').filter((x) => x.includes('total_mem=')).pop() || ''
  return l.replace(/^\[[^\]]+\]\s*/, '')
}

section(`A) 隐藏窗口（show:false）：内存口径 —— 尺寸 ${SIZE}px`)
const variants = [
  ['默认（硬件加速开）', []],
  ['--no-gpu（关硬件加速）', ['--no-gpu']],
  ['--js-flags=--max-old-space-size=64', ['--js-flags', '--max-old-space-size=64']],
  ['--no-gpu + js-flags 64', ['--no-gpu', '--js-flags', '--max-old-space-size=64']],
  ['--single-process（实验性）', ['--single-process']]
]
for (const [name, extra] of variants) {
  const home = tmpHome('perf-' + variants.indexOf(variants.find((v) => v[0] === name)))
  const log = path.join(DIR, 'mem-' + name.replace(/[^\w]/g, '_') + '.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--hidden', '--state', 'IDLE', '--scale', String(SIZE), '--metrics-interval', '1', ...extra], { home, log })
  await sleep(4500)
  const line = lastMetrics(log)
  const res = cpuSample(st.proc.pid, 1, 0, name)
  console.log(`  ${name}`)
  console.log(`    运行时自报: ${line || '(无)'}`)
  console.log(`    进程树实测: ${res.replace(/^RESULT\s*/, '')}`)
  st.send({ kind: 'shutdown' })
  const r = await st.waitExit(15000)
  if (!r) st.kill()
  await sleep(400)
}

section(`B) 显示真窗口（右下角，单次约 13.5s）：CPU / 帧率 —— 尺寸 ${SIZE}px`)
{
  const home = tmpHome('perf-shown')
  const log = path.join(DIR, 'shown.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--state', 'IDLE', '--scale', String(SIZE), '--metrics-interval', '1'], { home, log })
  await sleep(2500)
  const idle = cpuSample(st.proc.pid, 6, 0, 'IDLE-show')
  console.log('  IDLE 自报: ' + lastMetrics(log))
  st.send({ kind: 'state', state: 'WORKING' })
  await sleep(800)
  const work = cpuSample(st.proc.pid, 6, 0, 'WORKING-show')
  console.log('  ' + idle.replace(/^RESULT\s*/, ''))
  console.log('  ' + work.replace(/^RESULT\s*/, ''))
  console.log('  WORKING 自报: ' + lastMetrics(log))
  st.send({ kind: 'shutdown' })
  const r = await st.waitExit(15000)
  if (!r) st.kill()
  console.log(`  显示时长约 13.5s（已退出 exit=${r && r.code}）`)
  await sleep(500)
}

section('B2) 省电档（--fps saver）IDLE 真窗口 CPU —— 尺寸 140px')
{
  const home = tmpHome('perf-saver')
  const log = path.join(DIR, 'saver.log')
  fs.rmSync(log, { force: true })
  const t0 = Date.now()
  const st = runRuntime(['--state', 'IDLE', '--scale', String(SIZE), '--fps', 'saver', '--metrics-interval', '1'], { home, log })
  await sleep(2500)
  console.log('  ' + cpuSample(st.proc.pid, 6, 0, 'IDLE-saver-show'))
  st.send({ kind: 'shutdown' })
  const e = await st.waitExit(10000)
  console.log('  显示时长约 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's（已退出 exit=' + (e && e.code) + '）')
  console.log('  IDLE(saver) 每次上报 2s 内的驱动更新次数: ' + (readLog(log).split('\\n').filter((l) => l.includes('drvUpdates=')).map((l) => (l.match(/drvUpdates=(\\d+)/) || [])[1]).join(', ') || '（未开 fps-log）'))
  await sleep(400)
}
section('C) 帧率（单独一次会话；测帧率要开 rAF 自转循环，会抬高 CPU，所以不与 CPU 测量混测）')
{
  const home = tmpHome('perf-fps')
  const log = path.join(DIR, 'fps.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--state', 'WORKING', '--scale', String(SIZE), '--fps-log', '--exit-after', '7'], { home, log })
  await st.waitExit(20000)
  const lg = readLog(log)
  const rows = lg.split('\n').filter((l) => l.includes('drvUpdates=')).map((l) => (l.match(/drvUpdates=(\d+)/) || [])[1])
  console.log('  WORKING 每次上报 2s 内的驱动更新次数: ' + rows.join(', ') + '（÷2 = 每秒实际重绘次数；目标 ≥55fps 时折算 ≈55 次/秒）')
  console.log('  IDLE 帧率（单独会话）:')
  const log2 = path.join(DIR, 'fps-idle.log'); fs.rmSync(log2, { force: true })
  const st2 = runRuntime(['--state', 'IDLE', '--scale', String(SIZE), '--fps-log', '--exit-after', '7'], { home, log: log2 })
  await st2.waitExit(20000)
  const r2 = readLog(log2).split('\n').filter((l) => l.includes('drvUpdates=')).map((l) => (l.match(/drvUpdates=(\d+)/) || [])[1])
  console.log('    IDLE 每次上报 2s 内的驱动更新次数: ' + r2.join(', ') + '（÷2 = 每秒实际重绘；rAF 计数是自转循环本身，不代表重绘频率）')
  await sleep(400)
}

section('残留进程检查')
const left = spawnSync('powershell.exe', ['-NoProfile', '-Command',
  "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: 'utf8' }).stdout.trim()
console.log('  electron 进程数 = ' + left)
killStrayElectron()
await sleep(300)
