#!/usr/bin/env node
/* fps-cpu.mjs —— 帧率档位的 CPU 对照（**真窗口**，需获准；每档两次采样、同一次运行内背靠背测，避免机器负载漂移）
 *
 * 口径：进程树 TotalProcessorTime 增量 ÷ 单核（20 逻辑核）。尺寸 140px。
 * 每次会话窗口放屏幕右下角、单次 ≤20 秒、结束立即 hide+destroy。
 * 用法: node tests/fps-cpu.mjs          （不在默认离屏套件里）
 */
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runRuntime, tmpHome, OUT, mkdir, sleep, section, killStrayElectron, HERE, runDir } from './harness.mjs'

const SIZE = 140
const DIR = runDir('perf-fps')
const sample = (pid, sec, label) => String(spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(HERE, 'proc-cpu.ps1'), '-RootPid', String(pid), '-Seconds', String(sec), '-Warmup', '0',
  '-Label', label], { encoding: 'utf8', windowsHide: true, timeout: 60000 }).stdout || '').trim()

section(`帧率档位 CPU 对照（真窗口，140px，右下角）`)

async function tier2 (fpsName) { return await tier(fpsName) }
async function tier (fpsName) {
  const home = tmpHome('fpscpu-' + fpsName)
  const log = path.join(DIR, fpsName + '.log')
  fs.rmSync(log, { force: true })
  const t0 = Date.now()
  const st = runRuntime(['--state', 'IDLE', '--scale', String(SIZE), '--fps', fpsName, '--metrics-interval', '1'], { home, log })
  await sleep(2200)
  const a = sample(st.proc.pid, 5, `${fpsName}-IDLE-1`)
  const b = sample(st.proc.pid, 5, `${fpsName}-IDLE-2`)
  st.send({ kind: 'shutdown' })
  const e = await st.waitExit(10000)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`  [${fpsName}] 窗口会话 ${secs}s（exit=${e && e.code}）`)
  console.log('    ' + a.replace('RESULT ', ''))
  console.log('    ' + b.replace('RESULT ', ''))
  await sleep(500)
}

await tier('standard')   /* IDLE 15 fps（新默认） */
await tier('saver')      /* IDLE 4 fps（省电档，旧默认） */

killStrayElectron()
await sleep(300)
