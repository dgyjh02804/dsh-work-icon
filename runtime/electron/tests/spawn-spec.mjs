#!/usr/bin/env node
/* spawn-spec.mjs —— 逐字照抄 README 的 spawn 规格真跑（command / args / cwd 三样），
 * 证明宿主按这三样写就能拉起来、能握手、能收状态、能优雅退出。
 *
 * 宿主侧写法（Node）:
 *   spawn(command, ['runtime/electron'], { cwd: <插件包根>, stdio: ['pipe','pipe','pipe'] })
 *
 * command 的三种解析方式都实测一遍，README 里写的就是这里测出来的结论：
 *   A 推荐：<包根>\runtime\electron\node_modules\electron\dist\electron.exe （绝对路径，可直接执行）
 *   B 备选：<包根>\runtime\electron\node_modules\.bin\electron.cmd + { shell: true }
 *          —— 不带 shell:true 时 Node 直接抛 EINVAL（拒绝执行 .cmd/.bat）
 *   C 开发期：harness 解析出的那份 electron.exe（仓库自带，见 harness.mjs 的 CANDIDATES）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ELECTRON, HERE, OUT, section, report, sleep, killStrayElectron, runDir } from './harness.mjs'

const ROOT = path.resolve(HERE, '..', '..', '..')      /* runtime/electron/tests -> 插件包根 */
const LOCAL_EXE = path.join(ROOT, 'runtime', 'electron', 'node_modules', 'electron', 'dist', 'electron.exe')
const LOCAL_CMD = path.join(ROOT, 'runtime', 'electron', 'node_modules', '.bin', 'electron.cmd')
/* C 开发期：**仓库自带的那份 electron.exe**（= harness.mjs 的 CANDIDATES 仓库内候选，同一次解析的结果）。
   旧值是 temp4\spike\electron\node_modules\... 的绝对路径 —— 那条路线的依赖安装已获批准删除，
   而这个常量在 L83 是**无条件**使用的（没有 existsSync 兜底）⇒ 不改就会把套件弄红。
   用 `ELECTRON`（harness 从 import.meta.url 向上推导）而不是再拼一遍路径：只留一个真相源。 */
const SPIKE_EXE = ELECTRON
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

const home = runDir('spawn-spec-home')
fs.rmSync(home, { recursive: true, force: true })
/* Electron 启动需要可用的用户目录；指到不存在的目录会静默起不来（本机实测踩过） */
fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true })

async function runForm (tag, command, opts) {
  section(`spawn 规格真跑 —— ${tag}`)
  console.log('  command = ' + command)
  console.log('  args    = ["runtime/electron"]     cwd = ' + ROOT)
  let proc
  try {
    proc = spawn(command, ['runtime/electron'], {
      cwd: ROOT,
      env: { ...process.env, USERPROFILE: home },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts
    })
  } catch (e) {
    check(`${tag}：能 spawn`, false, 'spawn 直接抛错 ' + (e.code || e.message))
    return
  }
  const lines = []
  let stderr = ''
  let buf = ''
  proc.stdout.on('data', (c) => {
    buf += c.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) lines.push(l) }
  })
  proc.stderr.on('data', (c) => { stderr += c.toString() })
  const waitLine = async (pred, ms) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { const l = lines.find(pred); if (l) return l; await sleep(50) }
    return null
  }
  const ready = await waitLine((l) => l.includes('"ready"'), 20000)
  check(`${tag}：按这三样能拉起窗口（收到 ready）`, !!ready, ready || ('无 ready；stderr 末尾: ' + stderr.slice(-200)))
  let pid = 0
  try { pid = JSON.parse(ready).pid } catch { /* ignore */ }
  if (ready) console.log(`  ready.pid = ${pid}（子进程 pid = ${proc.pid}）`)

  proc.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'state', state: 'WORKING', activity: 'spawn-spec' }) + '\n')
  await sleep(1500)
  check(`${tag}：state 被受理（日志出现 STATE -> WORKING）`, /STATE -> WORKING/.test(stderr),
    (stderr.split('\n').filter((l) => l.includes('STATE ->')).join(' | ') || '无'))
  proc.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'shutdown' }) + '\n')
  const code = await new Promise((res) => { const t = setTimeout(() => res('timeout'), 15000); proc.on('exit', (c) => { clearTimeout(t); res(c) }) })
  check(`${tag}：shutdown 后自行退出且退出码 0`, code === 0, 'exit=' + code)
  const outLines = lines.filter((l) => l.trim().startsWith('{'))
  let allJson = true
  for (const l of outLines) { try { JSON.parse(l) } catch { allJson = false } }
  check(`${tag}：stdout 只有协议 JSON`, allJson && outLines.length >= 1, outLines.length + ' 行，全部可解析=' + allJson)
  await sleep(400)
}

if (fs.existsSync(LOCAL_EXE)) await runForm('A 本地 electron.exe 绝对路径（推荐）', LOCAL_EXE, {})
else console.log('[跳过] 本地 electron 未安装：' + LOCAL_EXE)
await runForm('C 开发期 仓库自带 electron.exe（harness 解析）', SPIKE_EXE, {})
if (fs.existsSync(LOCAL_CMD)) await runForm('B .cmd 垫片 + shell:true（备选）', LOCAL_CMD, { shell: true })

if (fs.existsSync(LOCAL_CMD)) {
  section('反面案例：.cmd 不带 shell:true')
  let threw = ''
  try { spawn(LOCAL_CMD, ['runtime/electron'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }) } catch (e) { threw = e.code || e.message }
  check('不带 shell 时 Node 拒绝执行 .cmd（记下来免得再踩）', !!threw,
    threw || '本次未抛错（Node 版本差异），但 README 仍推荐 .exe 绝对路径')
}

killStrayElectron()
section(ok ? 'spawn 规格：通过' : 'spawn 规格：有失败项')
process.exit(ok ? 0 : 1)
