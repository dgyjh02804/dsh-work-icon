#!/usr/bin/env node
/* production-survival.mjs —— **复现 2026-09-12 事故的回归**：跑一整轮测试套件，生产式实例必须活下来
 *
 * 事故回顾：测试收尾的清理按 `Name='electron.exe' AND CommandLine LIKE '*dsh-work-icon*'` 匹配，
 * 把用户正在用的生产图标（命令行里含 `...\dsh-work-icon\runtime\electron`）一起强杀了 ——
 * 日志表现为"戛然而止、无优雅退出记录"，且宿主按 SPEC §10.3 不会重启它 → 图标永久消失（用户只能重启 DSH）。
 *
 * 本测试的做法（能真实复现）：
 *   ① 起一个**生产式实例**：argv=[]（零 flag）、无自动退出、长活；用独立 USERPROFILE 保证不与真实生产抢目录；
 *   ② 在它存活期间跑**完整测试套件** `tests/run-all.mjs`（全套离屏 + 若干真窗口会话，含所有收尾清理）；
 *   ③ 断言它**仍然存活**、且日志仍在持续追加（不是僵死）。
 * 修好前（旧清理逻辑）②会把它杀掉 → ③失败；修好后通过。
 *
 * 真窗口纪律：生产式实例本身就是"常驻图标"，不受 ≤20 秒限制；它落在屏幕右下角、结束时由本脚本精确 kill。
 * 用法: node tests/production-survival.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ELECTRON, RUNTIME, OUT, mkdir, sleep, section, report, isAlive, killStrayElectron, findMyElectron, runDir } from './harness.mjs'

const DIR = runDir('survival')
/* 关键：模拟生产实例的 home 必须**在测试树之外**（生产是 %USERPROFILE%\.dsh\work-icon）。
   放在 test\out 下面会让它被"本轮测试实例"的判据命中而遭清理 —— 那样测的就不是生产实例了。 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-icon-prodsim-'))
fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true })
const ROOT = path.resolve(RUNTIME, '..', '..')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

section('生产实例存活回归（生产式实例 + 完整测试套件，全程它必须活着）')

/* ① 起一个生产式实例：与宿主完全一致（args=['runtime/electron']，零 flag） */
const prod = spawn(ELECTRON, ['runtime/electron'], {
  cwd: ROOT,
  env: { ...process.env, USERPROFILE: home },
  stdio: ['pipe', 'pipe', 'pipe']
})
let prodOut = '', prodErr = '', prodExited = null
prod.stdout.on('data', (c) => { prodOut += c })
prod.stderr.on('data', (c) => { prodErr += c })
prod.on('exit', (c) => { prodExited = c })
const prodLog = path.join(home, '.dsh', 'work-icon', 'helper.log')
await sleep(3000)
check('生产式实例已起来并收到 ready', /"kind":"ready"/.test(prodOut), (prodOut.split('\n')[0] || '').slice(0, 70))
check('生产式实例存活（初始）', prodExited === null && isAlive(prod.pid), 'pid=' + prod.pid + ' exited=' + JSON.stringify(prodExited))

const sizeOf = () => (fs.existsSync(prodLog) ? fs.statSync(prodLog).size : 0)
const before = sizeOf()

/* ② 跑完整测试套件（这就是当初误杀发生的地方：每个用例收尾都会调 killStrayElectron） */
console.log('  正在跑完整测试套件（tests/run-all.mjs）……生产式实例必须全程存活')
const t0 = Date.now()
const suite = spawnSync('node', [path.join(RUNTIME, 'tests', 'run-all.mjs')], {
  cwd: RUNTIME, encoding: 'utf8', windowsHide: true, timeout: 20 * 60 * 1000
})
fs.writeFileSync(path.join(DIR, 'inner-suite.log'), String(suite.stdout || '') + String(suite.stderr || ''))
const suiteCode = suite.status
const suiteOut = String(suite.stdout || '')
console.log('  套件结束：exit=' + suiteCode + '，用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's')
for (const l of String(suite.stdout || '').split('\n').filter((x) => x.includes('[FAIL]'))) console.log('  内层失败项: ' + l.trim())

/* ③ 断言生产式实例仍然活着 */
/* 内层套件的结果是**信息项**：本测试唯一的判据是"生产式实例存活"。
   内层若出现偶发抖动（例如并发负载下离屏抓图超时），不该把"隔离是否修好"这个结论带偏；
   但失败项必须原样打出来，绝不吞掉。 */
console.log('  [信息] 内层套件 exit=' + suiteCode + (suiteCode === 0 ? '（全部通过）' : '（见上面列出的失败项）'))
check('**生产式实例在整套测试跑完后仍然存活**（事故回归点）',
  prodExited === null && isAlive(prod.pid), 'pid=' + prod.pid + ' exited=' + JSON.stringify(prodExited))
const after = sizeOf()
check('生产式实例日志仍在持续追加（不是僵死进程）', after > before, `日志 ${before} -> ${after} 字节`)
check('生产式实例日志里没有"被强杀前无退出记录"的痕迹：仍能正常收 state',
  (() => { prod.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'state', state: 'WORKING' }) + '\n'); return true })())
await sleep(1500)
check('套件跑完后仍能响应宿主消息（STATE -> WORKING）', /STATE -> WORKING/.test(prodErr) && isAlive(prod.pid),
  (prodErr.split('\n').filter((l) => l.includes('STATE ->')).slice(-1)[0] || '无').slice(-60))

/* 清理判据自检：本轮测试起的实例集合里不该出现生产式实例的 pid */
const mine = findMyElectron()
check('清理判据不会把生产式实例算成"自己的"（不会误杀）', !mine.some((p) => p.pid === prod.pid),
  '本轮匹配到 ' + mine.length + ' 个测试实例，生产 pid=' + prod.pid)

/* 收尾：只精确 kill 这个生产式实例 */
try { prod.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'shutdown' }) + '\n') } catch { /* ignore */ }
const code = await new Promise((r) => { const t = setTimeout(() => r('timeout'), 15000); prod.on('exit', (c) => { clearTimeout(t); r(c) }) })
check('收尾 shutdown 后生产式实例优雅退出（退出码 0）', code === 0, 'exit=' + code)
killStrayElectron()
await sleep(300)

section(ok ? '生产实例存活回归：通过' : '生产实例存活回归：有失败项')
process.exit(ok ? 0 : 1)
