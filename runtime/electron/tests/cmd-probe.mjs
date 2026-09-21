#!/usr/bin/env node
/* cmd-probe.mjs —— 决定 README 里 spawn 的 command 到底该怎么写（用刚装好的本地 electron 实测）
 *   形式 A: node_modules\.bin\electron.cmd（不带 shell）—— 预期 Node 拒绝执行 .cmd
 *   形式 B: node_modules\.bin\electron.cmd（带 shell:true）
 *   形式 C: node_modules\electron\dist\electron.exe 绝对路径（推荐）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HERE } from './harness.mjs'

const ROOT = path.resolve(HERE, '..', '..', '..')
const CMD = path.join(ROOT, 'runtime', 'electron', 'node_modules', '.bin', 'electron.cmd')
const EXE = path.join(ROOT, 'runtime', 'electron', 'node_modules', 'electron', 'dist', 'electron.exe')
const home = path.join(HERE, '..', 'test', 'out', 'spawn-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true })

const attempts = [
  ['A .cmd 不带 shell', CMD, ['runtime/electron'], {}],
  ['B .cmd 带 shell:true', CMD, ['runtime/electron'], { shell: true }],
  ['C electron.exe 绝对路径', EXE, ['runtime/electron'], {}]
]
for (const [tag, cmd, args, extra] of attempts) {
  if (!fs.existsSync(cmd)) { console.log(`${tag} -> 可执行文件不存在: ${cmd}`); continue }
  let p
  try {
    p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, USERPROFILE: home }, stdio: ['pipe', 'pipe', 'pipe'], ...extra })
  } catch (e) {
    console.log(`${tag} -> spawn 直接抛错: ${e.code || e.message}`)
    continue
  }
  let so = '', se = '', err = ''
  p.stdout.on('data', (c) => { so += c })
  p.stderr.on('data', (c) => { se += c })
  p.on('error', (e) => { err = e.code || e.message })
  await new Promise((r) => setTimeout(r, 600))
  try { p.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'shutdown' }) + '\n') } catch { /* ignore */ }
  const code = await new Promise((r) => { const t = setTimeout(() => r('timeout'), 9000); p.on('exit', (c) => { clearTimeout(t); r(c) }) })
  const ready = /"kind":"ready"/.test(so)
  console.log(`${tag} -> exit=${code} error=${err || '-'} ready=${ready}`)
  try { p.kill() } catch { /* ignore */ }
}
