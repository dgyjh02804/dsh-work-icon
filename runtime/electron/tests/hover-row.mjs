#!/usr/bin/env node
/* hover-row.mjs —— 实测「click-through 窗口能否做悬停命中行」＋「DOM mousemove 是否真被 forward 转发」
 * 光标位置用**只读**方式探测（PowerShell 读 Cursor.Position），**不合成任何输入**、不移动鼠标。
 * 把窗口摆到光标处 → 主进程 40ms 轮询 screen.getCursorScreenPoint() 判定命中行 → 14s 后汇总。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ELECTRON } from './harness.mjs'

const DIR = path.join(new URL('.', import.meta.url).pathname.replace(/^\//, ''), 'hover-row')
const out = path.join(DIR, 'result.json')
fs.rmSync(out, { force: true })

/* 只读探测光标位置（读，不写，不合成） */
const r = spawnSync('pwsh', ['-NoProfile', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; "$($p.X) $($p.Y)"'],
  { encoding: 'utf8', windowsHide: true })
/* 光标位置改由 Electron 的 screen.getCursorScreenPoint() 在窗口内读取（与生产判定悬停同一个 API） */
const [x, y] = [0, 0]

const t0 = Date.now()
const rr = spawnSync(ELECTRON, [DIR, '--x', String(x), '--y', String(y), '--out', out],
  { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 40000 })
const line = (String(rr.stdout || '').match(/RESULT (\{.*\})/) || [])[1]
const res = line ? JSON.parse(line) : (fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null)
console.log(`会话 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
if (!res) { console.log('无结果'); process.exit(1) }

console.log('\n===== 悬停命中行 · 实测 =====')
console.log(`  窗口位置            ${JSON.stringify(res.windowAt)}`)
console.log(`  主进程轮询命中"某一行"的样本数   ${res.rowHits}  （40ms 一次 ⇒ 命中持续 ${(res.rowHits * 0.04).toFixed(1)}s）`)
console.log(`  行命中变化次数        ${res.rowTransitions}`)
console.log(`  渲染进程收到的 DOM mousemove    ${res.domMousemove}`)
console.log(`  光标在窗口内是否真的移动过      ${res.cursorMovedInside ? '是' : '否（本次未发生真实移动 ⇒ 第 B 项无法判定）'}`)
console.log('\n  结论 A（悬停命中行）：' + (res.rowHits > 0 ? `✅ 可行 —— 主进程轮询 screen.getCursorScreenPoint() 稳定命中行（${res.rowHits} 个样本），完全不依赖 forward 转发` : '❌ 未命中（窗口没盖住光标）'))
console.log('  结论 B（DOM mousemove）：' + (res.cursorMovedInside
  ? (res.domMousemove > 0 ? '✅ 收到（forward 确实转发了移动事件）' : '⚠️ 光标确实在窗口内移动过，但渲染进程 0 次 mousemove ⇒ forward 未转发 DOM 事件')
  : '— 本次光标没有移动，**无法判定**（需要真实移动才能测）'))
