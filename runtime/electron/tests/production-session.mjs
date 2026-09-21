#!/usr/bin/env node
/* production-session.mjs —— 生产路径存活确认（**唯一一个故意显示真窗口的回归**，因为要证的正是"可见会话不会自杀"）
 *
 * 事故背景：旧代码把"没传 --exit-after"当成测试会话，给生产启动加了 20s 自杀定时器（图标亮 20 秒消失）。
 * 本脚本用**与宿主完全一致的启动方式**（args=['runtime/electron']、cwd=插件包根、无任何 flag）
 * 起一个窗口，观察 19.5 秒：进程必须一直活着、日志里不能出现退出记录。
 *
 * 边界：窗口放屏幕右下角、单次 19.5 秒（<20 秒上限）、结束立即 hide+destroy、跑完清理 electron.exe。
 * 更决定性的证据是 tests/lifecycle.mjs 的干跑（exitAfterSec=0 / autoExitTimer=false，且不创建窗口）。
 * 用法: node tests/production-session.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ELECTRON, RUNTIME, OUT, mkdir, sleep, section, report, killStrayElectron, runDir } from './harness.mjs'

const OBSERVE_MS = 19500
const DIR = runDir('production')
const home = path.join(DIR, 'home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true })
const ROOT = path.resolve(RUNTIME, '..', '..')
const logFile = path.join(home, '.dsh', 'work-icon', 'helper.log')

let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

section(`生产路径存活确认（宿主式启动 args=['runtime/electron']、无 flag；窗口右下角 ${(OBSERVE_MS / 1000).toFixed(1)}s）`)
console.log('  command = ' + ELECTRON)
console.log("  args    = ['runtime/electron']   cwd = " + ROOT + '   （无任何 flag）')

const p = spawn(ELECTRON, ['runtime/electron'], {
  cwd: ROOT,
  env: { ...process.env, USERPROFILE: home },
  stdio: ['pipe', 'pipe', 'pipe']
})
let so = '', se = '', exited = null
p.stdout.on('data', (c) => { so += c })
p.stderr.on('data', (c) => { se += c })
p.on('exit', (c) => { exited = c })

await sleep(2000)
check('收到了 ready 握手', /"kind":"ready"/.test(so), (so.split('\n').find((l) => l.includes('ready')) || '无').slice(0, 90))
check('窗口确实显示出来了（生产路径应当可见）', /window shown/.test(se))

/* 中途发一次 state，模拟宿主的正常工作消息 */
p.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'state', state: 'WORKING', activity: 'testing' }) + '\n')
await sleep(6000)
check('t≈8s 进程仍存活', exited === null, 'exited=' + JSON.stringify(exited))
check('日志里没有"自动加 20 秒兜底"这条 WARN（旧 bug 的特征）', !/自动加 20 秒兜底/.test(se))
check('日志明确写着生产会话无自动退出定时器', /无自动退出定时器/.test(se))

/* 关键观察点：跨过……不跨过 20 秒死线，而是把它交给干跑证明；这里只确认到 19.5s 仍在运行 */
await sleep(OBSERVE_MS - 8000)
check(`t≈${(OBSERVE_MS / 1000).toFixed(1)}s 进程仍存活（旧版会在 20s 自杀）`, exited === null, 'exited=' + JSON.stringify(exited))
check('19.5 秒内日志没有出现任何 exit 记录', !/exit code=/.test(se), (se.split('\n').filter((l) => l.includes('exit code')).join(' | ') || '无 exit 记录'))

/* 收尾：先发 shutdown 让它自己优雅退出，再兜底清理 */
p.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'shutdown' }) + '\n')
const code = await new Promise((r) => { const t = setTimeout(() => r('timeout'), 8000); p.on('exit', (c) => { clearTimeout(t); r(c) }) })
check('shutdown 后自行退出、退出码 0', code === 0, 'exit=' + code)
const lg = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
check('整个会话 uptime 超过 19 秒（说明没有 20 秒自杀）', /uptime_ms=1[9]\d{3}|uptime_ms=2\d{4}/.test(lg),
  (lg.split('\n').filter((l) => l.includes('uptime_ms')).join(' | ') || '无').slice(0, 120))
try { if (exited === null) p.kill() } catch { /* ignore */ }

section(ok ? '生产路径存活确认：通过' : '生产路径存活确认：有失败项')
killStrayElectron()
await sleep(300)
process.exit(ok ? 0 : 1)
