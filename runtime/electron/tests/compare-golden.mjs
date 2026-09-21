#!/usr/bin/env node
/* compare-golden.mjs —— 七态离屏渲染 + 黄金样本比对（**自渲染**，不依赖历史产物）
 *
 * ── 根因（2026-09-12 修复）────────────────────────────────────────────────
 * 旧实现直接读 `OUT/shots/` 里**上一次**留下的 PNG 去比对，而那个目录只有 shots.mjs 会写。
 * 于是同一个测试出现"单独跑红、在 run-all 里连跑绿"：
 *   · 单独跑 → 比的是**上一次**（可能是更早一版渲染器）留下的旧产物；
 *   · run-all → 紧邻的 shots.mjs 刚重渲染过，比的是当前产物。
 * 复现证据见 tests/probe-golden-conditions.mjs 与 repo 报告：
 *   同一份代码，仅把盘上的 shot 文件换成相邻状态的 → 单独跑全七态红（IDLE 7.78%、max 22.706%）；
 *   同一份代码，先跑 shots.mjs 再比对 → 全绿（max 0.068%）。
 *   **与光标悬停无关**：--shot 走 --hidden 路径，鼠标监看根本不启动；实测 settle 60/120ms
 *   （故意过早抓图）也仍然是绿的 —— 时序同样不是原因。
 *
 * ── 改法（只消除外部状态依赖，**不放宽任何断言**）──────────────────────────
 *  1) 本脚本**自己重渲染七态**（spawn shots.mjs 240），所以单独跑 ≡ run-all 里跑；
 *  2) 产物完整性/新鲜度硬校验：21 张必须齐全、且 mtime 必须晚于本次运行起点；
 *  3) golden/compare.mjs 缺失时**报 FAIL**（旧实现是 process.exit(0) —— 那是一条假绿）；
 *  4) 判据强度逐字不变：同样的黄金样本、同样 compare.mjs 的 阈值16 / 允许2%、同样七态、同样三节。
 *
 * 用法: node compare-golden.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { OUT, GOLDEN, HERE, section, runDir } from './harness.mjs'

export const BOX = 240
const SHOTS = runDir('shots')
const BGS = ['dark', 'white', 'none']
const MAP = { IDLE: 'IDLE', THINKING: 'THINK', WORKING: 'WORK', WAITING: 'WAIT', SUCCESS: 'OK', ERROR: 'ERR', DISCONNECTED: 'OFF' }
const STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']

/** 调用 golden/compare.mjs 拿单张差异占比（判据与旧版完全相同，未改参数） */
export function cmp (ref, test, extra = []) {
  const r = spawnSync('node', [path.join(GOLDEN, 'compare.mjs'), ref, test, ...extra], { encoding: 'utf8' })
  const m = ((r.stdout || '') + (r.stderr || '')).match(/差异占比\s*([\d.]+)%\s*vs\s*允许\s*([\d.]+)%\s*->\s*(PASS|FAIL)/)
  return m ? { ratio: Number(m[1]), verdict: m[3] } : { ratio: null, verdict: 'ERR' }
}

/** 纯比对：给定 shots 目录，返回七态 dark 比对结果（不打印，供主流程与"牙齿"探针共用） */
export function compareSevenStates (shotsDir = SHOTS) {
  const rows = []
  for (const st of STATES) {
    const ref = path.join(GOLDEN, 'refs', `ref-${MAP[st]}-${BOX}-dark.png`)
    const test = path.join(shotsDir, `shot-${st}-${BOX}-dark.png`)
    rows.push({ st, ...cmp(ref, test) })
  }
  const nums = rows.map((r) => r.ratio).filter((v) => v !== null)
  const pass = rows.every((r) => r.verdict === 'PASS')
  return {
    rows,
    pass,
    max: nums.length ? Math.max(...nums) : NaN,
    avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN
  }
}

/* 自渲染 + 新鲜度校验：返回 { ok, why } —— 任何一条不成立都必须 FAIL，绝不静默放行 */
function renderShots () {
  const runStart = Date.now()
  section(`0) 自渲染七态（不依赖历史产物）：node shots.mjs ${BOX}，并校验产物为本次生成`)
  /* ── 抓图环境隔离：**隔离点收敛到 shots.mjs 自己**（2026-09-20；**不改任何阈值 / 判据 / 黄金样本**）──
     根因（原记录保留，说明这条链为什么存在）：`shots.mjs` 起运行时进程时**没有传 home**，
     于是 main.js 的 `homeDir()` 落到第三优先级 `os.homedir()/.dsh/work-icon` —— **用户真实的生产目录**。
     后果（实测）：离线抓图会读到用户自己的 `theme.json`（当时的 iconBright=1.3），
     渲染层据此挂上 `body.tuned #zoom{filter:brightness(1.3)}`，整个图标被整体提亮，
     与中性黄金样本产生 2.503%~10.201% 的差异 ⇒ 本项**假红**（七态全 FAIL）。
     证据：同一份 index.html 只把 HOME 隔离后即 7/7 PASS（max 0.068%），
     与 2026-09-13 那版渲染器 vs 同一批 refs 的数字逐项相同（两侧都是 max 0.068%）。
     ⇒ **黄金样本没有过期**，也不该改；要改的是"抓图别读用户的生产主题/配置"。

     ⚠️ 2026-09-20 收敛：这里原先传 `DSH_WORK_ICON_HOME` 做隔离，现在**删掉了** —— 真隔离已经
     下沉到 **shots.mjs 自己**（`runRuntime(args, { home: SHOT_HOME })`，落在同一轮 runId 目录下）。
     main.js `homeDir()` 的优先级是 `--home` > `DSH_WORK_ICON_HOME` > 真实家目录，所以只要
     shots.mjs 传了 `--home`，本文件再传环境变量就是**被静默忽略的死代码**，更糟的是它会让后人
     误以为"隔离在这里做"。**一处真隔离 > 两处看着像隔离**。 */
  const r = spawnSync('node', [path.join(HERE, 'shots.mjs'), String(BOX)],
    { encoding: 'utf8', cwd: HERE, env: process.env })
  const out = (r.stdout || '') + (r.stderr || '')
  process.stdout.write(out)
  if (r.status !== 0) return { ok: false, why: `shots.mjs 退出码 ${r.status}` }
  for (const bg of BGS) {
    const m = out.match(new RegExp(`bg=${bg}\\s+exit=(\\S+) 抓图 (\\d)/7`))
    if (!m) return { ok: false, why: `bg=${bg} 没有产出结果行（未跑完）`, bg, code: null }
    if (m[1] !== '0' || m[2] !== '7') {
      const code = m[1]
      /* exit=4294967295/-1 是"被外部强杀"，与"超时(3)"和"像素差异"都不是一回事：
         并发跑测试时，harness.killStrayElectron() 的判据里 appended 了**共享的 OUT 路径**，
         任何 agent 收尾都会顺带杀掉别的 agent 正在跑的实例。这里明确区分，避免误判成设计回归。 */
      const killed = code === '4294967295' || code === '-1'
      return {
        ok: false, bg,
        why: `bg=${bg} exit=${code} 抓图 ${m[2]}/7` +
          (killed ? ' —— 进程被外部强杀（很可能是并发运行的 killStrayElectron 误杀，见 harness.mjs 的共享 OUT 判据）' : ' —— 可能是 shot 硬超时(8000ms)或渲染层异常')
      }
    }
  }
  const missing = []
  const stale = []
  for (const st of STATES) {
    for (const bg of BGS) {
      const f = path.join(SHOTS, `shot-${st}-${BOX}-${bg}.png`)
      if (!fs.existsSync(f)) { missing.push(path.basename(f)); continue }
      if (fs.statSync(f).mtimeMs < runStart - 2000) stale.push(path.basename(f))
    }
  }
  if (missing.length) return { ok: false, why: `缺 ${missing.length} 张：${missing.slice(0, 4).join(', ')}` }
  if (stale.length) return { ok: false, why: `有 ${stale.length} 张不是本次生成（陈旧产物）：${stale.slice(0, 4).join(', ')}` }
  console.log(`  ✓ 21 张（7 态 × ${BGS.join('/')}）齐全，且全部为本次运行生成`)
  return { ok: true, why: '' }
}

function main () {
  if (!fs.existsSync(path.join(GOLDEN, 'compare.mjs'))) {
    /* 旧实现这里 process.exit(0)：比不了却报通过 = 假绿。改成明确失败。 */
    console.error(`[FAIL] 找不到黄金样本比对器 ${path.join(GOLDEN, 'compare.mjs')} —— 无法比对，不能视为通过`)
    process.exit(1)
  }

  const rendered = renderShots()
  if (!rendered.ok) {
    console.error(`[FAIL] 产物自渲染/新鲜度校验未通过：${rendered.why}`)
    process.exit(1)
  }

  /* ---------- 1. dark 底（判定项） ---------- */
  section('1) 七态 vs 黄金样本（dark 底 #111111，阈值 16，允许 2%）')
  const { rows, pass: pass1, max, avg } = compareSevenStates(SHOTS)
  console.log('  状态            差异占比    判定')
  for (const r of rows) console.log('  ' + r.st.padEnd(16) + (r.ratio === null ? '-' : r.ratio + '%').padEnd(12) + r.verdict)
  console.log(`  最大 ${max.toFixed(3)}%  平均 ${avg.toFixed(3)}%  -> ${pass1 ? 'PASS' : 'FAIL'}`)

  /* ---------- 2. 透明底自洽性（预乘合成 vs dark 图） ---------- */
  section('2) 透明通道自洽性：alpha 图按预乘合成到 #111111 后应与同状态 dark 图一致')
  function selfcheck (alpha, dark) {
    const r = spawnSync('node', [path.join(HERE, 'selfcheck.mjs'), alpha, dark], { encoding: 'utf8' })
    const m = (r.stdout || '').match(/预乘解释\s*([\d.]+)%/)
    return m ? Number(m[1]) : NaN
  }
  console.log('  状态            我的(预乘→dark)   黄金样本(预乘→dark)')
  for (const st of STATES) {
    const mine = selfcheck(path.join(SHOTS, `shot-${st}-${BOX}-none.png`), path.join(SHOTS, `shot-${st}-${BOX}-dark.png`))
    const gold = selfcheck(path.join(GOLDEN, 'refs', `ref-${MAP[st]}-${BOX}-alpha.png`), path.join(GOLDEN, 'refs', `ref-${MAP[st]}-${BOX}-dark.png`))
    console.log('  ' + st.padEnd(16) + (mine + '%').padEnd(18) + gold + '%')
  }

  /* ---------- 3. alpha 底比对（仅参考） ---------- */
  section('3) alpha 底比对（仅参考：黄金样本 alpha 图与其 dark 图不自洽时，此项无判定意义）')
  console.log('  状态            差异占比（参考图 alpha>0 区域）')
  for (const st of STATES) {
    const ref = path.join(GOLDEN, 'refs', `ref-${MAP[st]}-${BOX}-alpha.png`)
    const test = path.join(SHOTS, `shot-${st}-${BOX}-none.png`)
    const r = cmp(ref, test, ['--alpha'])
    console.log('  ' + st.padEnd(16) + (r.ratio === null ? '-' : r.ratio + '%'))
  }
  process.exit(pass1 ? 0 : 1)
}

/* 直接运行时才执行主流程；被 import 时只暴露纯比对函数（供牙齿探针复用） */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
