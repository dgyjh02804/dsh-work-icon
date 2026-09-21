/* harness.mjs —— 测试公共设施：定位 electron、spawn 运行时、读日志、清理进程 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

/* ---------------------------------------------------------------------------
 * 不污染宿主测试套件：脚本放在 tests/（Node test runner 默认只吃 test/ 目录），
 * 所以从插件包根裸跑 node --test 不会碰到它们；入口是 npm test / node tests/run-all.mjs。
 * ------------------------------------------------------------------------- */
export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const RUNTIME = path.resolve(HERE, '..')
export const OUT = path.resolve(HERE, '..', 'test', 'out')   /* 证据根目录仍留在 runtime/electron/test/out（SPEC 引用的隔离区路径也不动） */
/* H2 黄金样本：随仓库走（`runtime/electron/golden`）。
   2026-09-13 之前这里硬编码 temp4 的绝对路径 ⇒ 那棵树一天不删干净，测试套件就一天寄生在它上面。
   现在从本文件自身位置推导，**不再有仓库外的路径依赖**（改成相对路径后 compare-golden.mjs 实测仍全绿 ✓）。 */
export const GOLDEN = path.resolve(RUNTIME, 'golden')

/* ---------------------------------------------------------------------------
 * 每进程唯一 runId —— 让**同一个测试的两个并发实例**天然隔离（2026-09-12 事故的修复）
 *
 * 事故：`tmpHome` 原来是 `OUT/home-<name>`，**不是本轮唯一**。两个实例跑同一个测试会拿到
 * **同一个 home**，而 `findMyElectron()` 正是拿 home 当判据（`needles = [...roots]`）
 * ⇒ **两边互相杀掉对方的实例**。实测验收②（同一测试并发两套）：**两边都 exit=1**。
 * 同理，各测试自己写在 `OUT/<测试名>/*.log` 的日志/截图也共享，会互相覆盖成"红的项每次都变"。
 *
 * 做法：
 *   · runId 默认取本进程 pid（36 进制），**并写回 `process.env`** ——
 *     这样本进程再 spawn 的子进程（例如 compare-golden.mjs 里跑的 shots.mjs）
 *     会**继承同一个 runId**，不会各自分裂成两份产物；
 *   · 需要跨进程共享同一套产物时，调用方显式传 `DSH_TEST_RUN=<token>` 即可；
 *   · 产物落在 `OUT/<runId>/…`，不同并发实例天然互不影响。
 *
 * ⚠️ 测试脚本请用 `runDir('<测试名>')` 而不是 `mkdir(path.join(OUT, '<测试名>'))`，
 *    否则仍会落进共享目录、重新引入这个洞。
 *
 * ⚠️ 2026-09-19 补（真实假失败）：runId 原来是**纯 pid**（`r` + pid.toString(36)），而 **pid 会被系统回收**。
 *    实测：`test/out/rm84/v2-fields/main.log` 的 CreationTime = 2026-09-12、LastWriteTime = 2026-09-19，
 *    同一条日志里同时有两天的时间戳 ⇒ 整轮 run-all 因此报了一项**假红**
 *    （v2-fields 的"相同 revision 不重画"把 09-12 那份旧日志里的行也数进去了）。
 *    ⇒ 自动 runId 现在带一个时间后缀，跨天/跨进程都不可能再撞到同一个产物目录。
 *    显式传 `DSH_TEST_RUN=<token>` 时仍然完全以调用方为准（跨进程共享产物的用法不变）。
 * ------------------------------------------------------------------------- */
export const RUN = process.env.DSH_TEST_RUN ||
  (process.env.DSH_TEST_RUN = 'r' + process.pid.toString(36) + '-' + Date.now().toString(36).slice(-4))
/** 本轮的产物目录（runId 隔离）；等价于旧的 `OUT/<测试名>`，但不会跟并发实例互踩。 */
export function runDir (...parts) { return mkdir(path.join(OUT, RUN, ...parts)) }

const CANDIDATES = [
  path.join(RUNTIME, 'node_modules', 'electron', 'dist', 'electron.exe')
  /* 2026-09-13 删掉了原来那条 temp4\spike\electron\node_modules\... 的兜底：
     仓库自带独立 electron 安装，CANDIDATES[0] 恒命中 ⇒ 兜底永不触发（实测过），
     而它让套件对仓库外的一棵树产生了假依赖。spike 那份依赖安装已获批准删除。 */
]
export const ELECTRON = CANDIDATES.find((p) => fs.existsSync(p))
if (!ELECTRON) throw new Error('找不到 electron.exe（试过：' + CANDIDATES.join(' | ') + '）')

export function mkdir (p) { fs.mkdirSync(p, { recursive: true }); return p }
export function tmpHome (name) {
  /* 必须落在 runId 目录下：同名测试并发两套会拿到**同一个 home**，
     而 findMyElectron() 正是拿 home 当判据 ⇒ 两边互杀（实测验收②两边都 exit=1）。 */
  const d = path.join(OUT, RUN, 'home-' + name)
  fs.rmSync(d, { recursive: true, force: true })
  return mkdir(d)
}
export function readLog (file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}
export function logHas (file, needle) { return readLog(file).includes(needle) }
export function logLines (file) { return readLog(file).split(/\r?\n/).filter(Boolean) }

/** 起一个运行时进程；返回 { proc, stdout[], stderr[], exited, code, send, closeStdin, waitExit } */
export function runRuntime (args, { home, log, onStdout, onStderr, cwd } = {}) {
  const argv = [RUNTIME, ...args]
  if (home) argv.push('--home', home)
  if (log) argv.push('--log', log)
  const proc = spawn(ELECTRON, argv, {
    cwd: cwd || RUNTIME,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: Object.assign({}, process.env, { ELECTRON_DISABLE_WARNINGS: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' })
  })
  trackSpawn(proc.pid, home)
  const st = { proc, stdout: [], stderr: [], exited: false, code: null, signal: null }
  const bufs = { 1: '', 2: '' }
  const pump = (chunk, which) => {
    bufs[which] += chunk.toString('utf8')
    let i
    while ((i = bufs[which].indexOf('\n')) >= 0) {
      const line = bufs[which].slice(0, i).replace(/\r$/, '')
      bufs[which] = bufs[which].slice(i + 1)
      if (which === 1) { st.stdout.push(line); onStdout && onStdout(line) } else { st.stderr.push(line); onStderr && onStderr(line) }
    }
  }
  proc.stdout.on('data', (b) => pump(b, 1))
  proc.stderr.on('data', (b) => pump(b, 2))
  const done = new Promise((resolve) => proc.on('exit', (code, signal) => {
    st.exited = true; st.code = code; st.signal = signal; resolve(st)
  }))
  st.done = done
  st.send = (obj) => proc.stdin.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n')
  st.sendRaw = (text) => proc.stdin.write(text)
  st.closeStdin = () => { try { proc.stdin.end() } catch { /* ignore */ } }
  st.waitExit = (ms = 30000) => Promise.race([done, new Promise((r) => setTimeout(() => r(null), ms))])
  st.kill = () => { try { proc.kill() } catch { /* ignore */ } }
  return st
}

export function sleep (ms) { return new Promise((r) => setTimeout(r, ms)) }

export async function waitFor (fn, { timeout = 20000, step = 120 } = {}) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeout) return null
    await sleep(step)
  }
}

/* ============================================================================
 * 进程清理：**只杀自己这一轮起的**（生产事故 2026-09-12 的修复）
 *
 * 事故：旧实现是 `Name='electron.exe' AND CommandLine LIKE '*dsh-work-icon*'` → 生产图标的命令行里
 * 恰好就有 `...\dsh-work-icon\runtime\electron`，于是被测试收尾**强杀**：用户正在用的图标消失，
 * 而且因为 SPEC §10.3 宿主不会重启它 → 一直不再出现。日志表现就是"戛然而止、无优雅退出记录"。
 *
 * 现在的判据（两者取并集，都只可能命中本轮的测试实例）：
 *   ① **本轮 spawn 过的 PID**（带启动时间戳，防 PID 复用）：精确、最强；
 *   ② **命令行里含本轮独有的临时 home / userData 路径**：覆盖父进程死后残留的子进程
 *      （Chromium 会把 --user-data-dir 传给 GPU/渲染/工具进程，而 userData 钉在 HOME 下，
 *      所以测试实例的子进程都带这条临时路径；生产实例带的是 %USERPROFILE%\.dsh\work-icon）。
 * **绝不按进程名通杀，绝不按仓库路径模糊匹配。**
 * ========================================================================== */
const SPAWNED = new Map()          /* pid -> { at, home } */
export function trackSpawn (pid, home) {
  if (pid) SPAWNED.set(pid, { at: Date.now(), home: home || null })
}
export function spawnedPids () { return [...SPAWNED.entries()].map(([pid, v]) => ({ pid, ...v })) }

/** 收集"本轮起的 electron"的 pid（只读查询，不杀） */
export function findMyElectron () {
  const roots = [...new Set(spawnedPids().map((p) => p.home).filter(Boolean))]
  /* ⚠️ 2026-09-12 事故：这里原本是 `roots.concat([OUT])`。
   * OUT = runtime/electron/test/out 是**所有 agent 共用**的路径，而并行开发时别人起的
   * 实例命令行里同样带这条共享路径 → 任何一方调用 killStrayElectron() 都会把**对方正在跑的
   * 实例一并杀掉**，表现为对方测试莫名 `exit=-1`（4294967295 = 无符号的 -1 = 被外部强杀），
   * 还会被误读成"主进程崩溃"而浪费大量排查时间。
   * 判据只允许包含**本轮独有**的东西：本轮 spawn 过的 PID，或本轮独有的临时 home。
   * 需要覆盖"父进程死后残留的子进程"时，用本轮临时 home（上面那条），**绝不用共享目录**。 */
  const needles = [...roots]
  /* ⚠️ 护栏：判据为空时**必须直接返回空**，绝不能去拼一个 `Where-Object {  }` 的空条件查询。
   * 空条件的行为依赖 PowerShell 版本，最坏情况会**匹配到全机所有 electron.exe** —— 那比原事故更危险。
   * （去掉共享的 OUT 之后，needles 变得可能为空，这个护栏是随之必须补的。） */
  if (needles.length === 0) return []
  const list = needles.map((n) => `$_.CommandLine -like '*${String(n).replace(/'/g, "''")}*'`).join(' -or ')
  const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { ${list} } | ` +
    'Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
  let raw = ''
  try { raw = String(spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).stdout || '').trim() } catch { /* ignore */ }
  if (!raw) return []
  let arr = []
  try { const j = JSON.parse(raw); arr = Array.isArray(j) ? j : [j] } catch { return [] }
  return arr.map((o) => ({ pid: o.ProcessId, ppid: o.ParentProcessId, cmd: o.CommandLine }))
}

/** 只杀本轮测试起的 electron；返回杀掉的数量 */
export function killStrayElectron () {
  const mine = findMyElectron()
  for (const p of mine) {
    try { spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${p.pid} -Force -ErrorAction SilentlyContinue`], { windowsHide: true, timeout: 10000 }) } catch { /* ignore */ }
  }
  /* 自己 spawn 过、但已被回收/换过命令行的 pid 再兜一次（同样是精确 pid，不是通杀）
   *
   * ⚠️ 2026-09-12 补的 PID 复用防护：**pid 会被系统回收再分配给别人**。
   * 只按 pid 强杀，若这个 pid 已经属于一个无关进程，就会**误杀别人的东西**——
   * 这正是这次并发事故里"我根本没起那个进程，它却被杀"那一类现象的成因之一。
   * 判据：该 pid 的**启动时间不得早于我们 spawn 它的时间**（留 2 秒给时钟粒度与创建耗时）。
   * 不满足就跳过，**宁可漏杀一个自己的残留，也不误杀别人的进程**。 */
  for (const { pid, at } of spawnedPids()) {
    if (Date.now() - at < 1000) continue
    const q = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { [int64]($p.StartTime.ToUniversalTime() - (Get-Date '1970-01-01T00:00:00Z')).TotalMilliseconds } else { -1 }`
    let started = NaN
    try {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', q], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
      started = Number(String(r.stdout || '').trim())
    } catch { /* ignore */ }
    if (!Number.isFinite(started) || started < 0) continue        /* 进程已不存在：跳过 */
    if (started + 2000 < at) continue                             /* 比我们 spawn 它还早 ⇒ PID 已被复用，不是我们的进程 */
    try { spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { windowsHide: true, timeout: 10000 }) } catch { /* ignore */ }
  }
  return mine.length
}
/** 全机 electron 进程数（诊断用；**不要拿它做清理判据**） */
export function electronProcCount () {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: 'utf8', windowsHide: true })
  return Number(String(r.stdout || '0').trim()) || 0
}
/** 某个 pid 是否仍在运行（用于"生产实例存活"断言） */
export function isAlive (pid) {
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Measure-Object).Count`], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    return Number(String(r.stdout || '0').trim()) === 1
  } catch { return false }
}

export function report (name, ok, detail) {
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : ''))
  return ok
}
export function section (t) { console.log('\n===== ' + t + ' =====') }
