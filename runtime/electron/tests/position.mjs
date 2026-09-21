#!/usr/bin/env node
/* position.mjs —— 位置记忆（SPEC 第 8 节第 5 条：拖动后重启，图标回到上次位置，±2px）
 * 走的是与真实拖动完全相同的 drag-by / drag-end 处理分支（main.js --test-drag）。
 * 全程隐藏窗口。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, readLog, OUT, mkdir, killStrayElectron, sleep, section, report, runDir } from './harness.mjs'

const DIR = runDir('position')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

function boundsFrom (st) {
  for (const l of st.stdout) {
    if (!l.includes('"phase"') && l.includes('"bounds"')) {
      try { const j = JSON.parse(l); if (j.bounds) return j.bounds } catch { /* ignore */ }
    }
  }
  return null
}

section('位置记忆：拖动 -> 落盘 -> 重启恢复（±2px），全程隐藏窗口')
const home = tmpHome('pos')

/* ---- 第一步：启动 -> 拖动 (40,-30) -> 落盘 -> 退出 ---- */
{
  const log = path.join(DIR, 'p1.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--hidden', '--test-drag', '40,-30', '--emit-hwnd', '--exit-after', '5'], { home, log })
  const r = await st.waitExit(25000)
  check('第一次启动：退出码 0', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(log)
  check('拖动走的是 drag-by/drag-end 分支', lg.includes('test-drag') && lg.includes('drag-end -> position'))
  const m = lg.match(/drag-end -> position \((\d+),(\d+)\)/)
  check('落盘日志写出新位置', !!m, m ? m[0] : '未找到')
  const cfgFile = path.join(home, 'config.json')
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
  check('config.json 里记录了 position', !!cfg.window.position, JSON.stringify(cfg.window.position))
  globalThis.__P1 = cfg.window.position
  globalThis.__LOGB = boundsFrom(st)
  console.log(`    落盘位置 = (${cfg.window.position.x},${cfg.window.position.y})  实际窗口 bounds = ${JSON.stringify(globalThis.__LOGB)}`)
}

/* ---- 第二步：用同一个 home 重启 -> 位置应被恢复 ---- */
{
  const log = path.join(DIR, 'p2.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--hidden', '--emit-hwnd', '--exit-after', '4'], { home, log })
  const r = await st.waitExit(25000)
  check('第二次启动：退出码 0', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(log)
  check('日志显示位置来自存档', lg.includes('layout: restored'), lg.split('\n').find((l) => l.includes('layout:')) || '')
  const b = boundsFrom(st)
  const p = globalThis.__P1
  const dx = b ? Math.abs(b.x - p.x) : 999
  const dy = b ? Math.abs(b.y - p.y) : 999
  check('重启后位置恢复到 ±2px', dx <= 2 && dy <= 2,
    `存档=(${p.x},${p.y}) 恢复=(${b ? b.x : '?'},${b ? b.y : '?'}) 误差=(${dx},${dy})`)
}

/* ---- 第三步：越界位置被夹回可见区域 ---- */
{
  const home2 = tmpHome('pos2')
  const cfgFile = path.join(home2, 'config.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ window: { position: { x: 99999, y: 99999 } } }), 'utf8')
  const log = path.join(DIR, 'p3.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--hidden', '--emit-hwnd', '--exit-after', '4'], { home: home2, log })
  await st.waitExit(25000)
  const b = boundsFrom(st)
  const disp = { w: 1440, h: 852 }
  check('越界坐标被夹回可用区域', !!b && b.x < disp.w && b.y < disp.h && b.x >= 0 && b.y >= 0,
    'bounds=' + JSON.stringify(b))
}

section(ok ? '位置记忆：全部通过' : '位置记忆：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
