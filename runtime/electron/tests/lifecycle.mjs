#!/usr/bin/env node
/* lifecycle.mjs —— 会话生命周期回归测试（**纯逻辑 + 干跑，不创建窗口、不显示任何东西、不碰光标**）
 *
 * 背景（生产事故 2026-09-12）：上一版把"没传 --exit-after"当成"这是测试会话"，
 * 于是宿主的生产启动 argv=[] 被加了 20s 自杀定时器 → 图标亮 20 秒消失，且宿主按 SPEC §10.3 不重启 → 永久消失。
 *
 * 本测试锁死两条：
 *   ① 生产参数（argv 里没有任何测试标记）**绝不允许**出现自动退出定时器；
 *   ② 测试标记下仍然要兜底加 20 秒（保护用户屏幕不被测试窗口长时间占用）。
 * 干跑由环境变量 DSH_WORK_ICON_PRINT_PLAN=1 触发，这样 argv 可以保持与生产完全一致；
 * 干跑在**创建窗口之前**就退出，所以全程不会有任何窗口出现。
 *
 * 用法: node tests/lifecycle.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ELECTRON, RUNTIME, OUT, mkdir, sleep, section, report, killStrayElectron, runDir } from './harness.mjs'

const DIR = runDir('lifecycle')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

/* 直接 spawn，不经过 harness 的参数包装 —— 这样才能造出与宿主生产启动一模一样的 argv */
async function planOf (argv, tag) {
  const home = path.join(DIR, 'home-' + tag)
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true })
  return await new Promise((resolve) => {
    const p = spawn(ELECTRON, [RUNTIME, ...argv], {
      cwd: path.resolve(RUNTIME, '..', '..'),
      env: { ...process.env, USERPROFILE: home, DSH_WORK_ICON_PRINT_PLAN: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let so = '', se = ''
    p.stdout.on('data', (c) => { so += c })
    p.stderr.on('data', (c) => { se += c })
    p.on('error', () => resolve({ plan: null, so, se, code: 'spawn-error' }))
    const t = setTimeout(() => { try { p.kill() } catch { /* ignore */ } ; resolve({ plan: null, so, se, code: 'timeout' }) }, 25000)
    p.on('exit', (code) => {
      clearTimeout(t)
      let plan = null
      for (const l of so.split('\n')) {
        if (!l.trim().startsWith('{')) continue
        try { const j = JSON.parse(l); if (j.phase === 'plan') plan = j } catch { /* ignore */ }
      }
      resolve({ plan, so, se, code })
    })
  })
}

section('会话生命周期回归（干跑取证：不创建窗口、不显示任何东西）')

/* ---------- ① 生产路径：argv=[]，与宿主 spawn args=['runtime/electron'] 完全一致 ---------- */
const prod = await planOf([], 'prod')
console.log('  生产 argv=[] -> ' + JSON.stringify(prod.plan))
check('生产会话：计划里 exitAfterSec === 0', !!prod.plan && prod.plan.exitAfterSec === 0,
  prod.plan ? 'exitAfterSec=' + prod.plan.exitAfterSec : '未拿到计划（exit=' + prod.code + '）')
check('生产会话：没有任何自动退出定时器', !!prod.plan && prod.plan.autoExitTimer === false,
  prod.plan ? 'autoExitTimer=' + prod.plan.autoExitTimer : '')
check('生产会话：未被判定为测试会话', !!prod.plan && prod.plan.isTestSession === false,
  prod.plan ? 'isTestSession=' + prod.plan.isTestSession + ' marker=' + prod.plan.testMarker : '')
check('生产会话：日志里没有"自动加 20 秒兜底"这条 WARN', !/自动加 20 秒兜底/.test(prod.se),
  (prod.se.split('\n').filter((l) => l.includes('WARN')).join(' | ') || '无 WARN'))
check('生产会话：日志明确记录"活到 shutdown 或 stdin EOF"', /无自动退出定时器/.test(prod.se))
check('干跑没有创建窗口（用户不可能看见任何东西）', !/window created/.test(prod.se) && !/window shown/.test(prod.se))
check('干跑正常退出（退出码 0）', prod.code === 0, 'exit=' + prod.code)

/* ---------- ② 宿主可能顺带传的中性参数，也不能被误判成测试 ---------- */
const neutral = await planOf(['--state', 'WORKING', '--scale', '140'], 'neutral')
check('中性参数（--state/--scale）不触发测试兜底', !!neutral.plan && neutral.plan.isTestSession === false && neutral.plan.autoExitTimer === false,
  neutral.plan ? JSON.stringify({ isTest: neutral.plan.isTestSession, exit: neutral.plan.exitAfterSec, marker: neutral.plan.testMarker }) : '')

/* ---------- ③ 测试标记：**可见**测试会话仍然兜底 20 秒（保护用户的屏幕） ---------- */
for (const [tag, argv, marker] of [
  ['dwm', ['--dwm-phase', '5'], 'dwm-phase'],
  ['test-session', ['--test-session'], 'test-session'],
  ['probe', ['--exstyle-probe'], 'exstyle-probe']
]) {
  const r = await planOf(argv, tag)
  check(`测试标记 ${marker}：兜底 20 秒自动退出`, !!r.plan && r.plan.isTestSession === true && r.plan.exitAfterSec === 20 && r.plan.autoExitTimer === true,
    r.plan ? `isTest=${r.plan.isTestSession} exit=${r.plan.exitAfterSec} reason=${r.plan.exitReason}` : '')
}
/* 隐藏会话不占屏幕，因此不需要屏幕保护兜底；它的生命周期由测试脚本自己管（--exit-after 或 kill） */
const hid = await planOf(['--hidden'], 'hidden')
check('测试标记 --hidden：判定为测试会话但不加屏幕保护兜底（没有窗口要保护）',
  !!hid.plan && hid.plan.isTestSession === true && hid.plan.hidden === true && hid.plan.exitAfterSec === 0,
  hid.plan ? `isTest=${hid.plan.isTestSession} hidden=${hid.plan.hidden} exit=${hid.plan.exitAfterSec}` : '')

/* ---------- ④ --exit-after 的 20 秒硬上限仍然生效 ---------- */
const clamp = await planOf(['--exit-after', '999'], 'clamp')
check('--exit-after 999 被钳制为 20 秒（真窗口单次 ≤20s）', !!clamp.plan && clamp.plan.exitAfterSec === 20,
  clamp.plan ? 'exitAfterSec=' + clamp.plan.exitAfterSec + ' reason=' + clamp.plan.exitReason : '')
const short = await planOf(['--exit-after', '5', '--hidden'], 'short')
check('显式 --exit-after 5 被尊重', !!short.plan && short.plan.exitAfterSec === 5,
  short.plan ? 'exitAfterSec=' + short.plan.exitAfterSec : '')

section(ok ? '会话生命周期回归：全部通过' : '会话生命周期回归：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
