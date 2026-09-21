#!/usr/bin/env node
/* reap.mjs —— 收尾清理：杀掉本项目遗留的**无头**浏览器进程
 *
 * 为什么要它：Playwright 正常路径下会在 close() 后自带退出，但异常中断（Ctrl+C、进程被杀、
 * 脚本在 await 之前抛错）可能留下无头 Chromium 子进程长期驻留。
 *
 * 安全边界（很重要，绝不能误伤用户自己的浏览器）：
 *   只杀命令行里带 `--remote-debugging-pipe`（Playwright/Patchright 驱动浏览器的必然特征）
 *   或 `--headless` 的 msedge/chrome 进程。用户自己的 Edge/Chrome、DSH Web GUI 的浏览器
 *   命令行里也会有 `--user-data-dir`，**绝不能用它当特征**——那会误杀用户的浏览器。
 *   另外用户浏览器的子进程（renderer/utility）命令行继承自它自己，也不会命中这两个特征。
 *
 * 实现说明：PowerShell 脚本必须走临时 .ps1 文件执行。用 spawnSync 直接把多行脚本喂给
 * powershell -Command 时，内层引号会被吞掉，导致 -Filter "... OR ..." 解析失败、脚本空转——
 * 那会让收割器**静默地什么都没查**，是最危险的失败模式（误报"干净"）。
 *
 * 用法: node reap.mjs [--dry] [--json]
 * 退出码: 0 干净或已清理；1 清理后仍有残留
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DRY = process.argv.includes('--dry')
const AS_JSON = process.argv.includes('--json')

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$out = @()
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe'
}
foreach ($p in $procs) {
  $cl = [string]$p.CommandLine
  if ($cl.Length -eq 0) { continue }
  $isPipe = $cl.Contains('--remote-debugging-pipe')
  $isHeadless = $cl.Contains('--headless')
  if ($isPipe -or $isHeadless) {
    $out += [pscustomobject]@{ Pid = [int]$p.ProcessId; Name = $p.Name; Headless = $isHeadless; RemotePipe = $isPipe }
  }
}
Write-Output ('JSON:' + (ConvertTo-Json -InputObject @($out) -Compress))
`

function runPs() {
  const f = path.join(os.tmpdir(), 'h2-reap-' + process.pid + '.ps1')
  fs.writeFileSync(f, PS_SCRIPT, 'utf8')
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8' })
    if (r.error) throw r.error
    const out = (r.stdout || '').trim()
    const line = out.split('\n').map(s => s.trim()).find(s => s.startsWith('JSON:'))
    if (!line) throw new Error('PowerShell 没有返回可解析结果；stderr=' + (r.stderr || '').trim().slice(0, 300))
    const parsed = JSON.parse(line.slice(5))
    return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
  } finally { try { fs.unlinkSync(f) } catch (e) { } }
}

let procs
try { procs = runPs() } catch (e) {
  console.error('[reap] 进程清点失败（未能确认是否干净）：' + e.message)
  process.exit(2)
}

if (AS_JSON) console.log(JSON.stringify({ found: procs, dry: DRY }))

if (procs.length === 0) {
  if (!AS_JSON) console.log('[reap] 没有发现遗留的 Playwright 无头浏览器进程（特征: --remote-debugging-pipe / --headless）——干净')
  process.exit(0)
}

if (!AS_JSON) {
  console.log(`[reap] 发现 ${procs.length} 个遗留的 Playwright 无头浏览器进程：`)
  procs.forEach(p => console.log(`   pid=${p.Pid} ${p.Name} headless=${p.Headless} remotePipe=${p.RemotePipe}`))
}
if (DRY) { if (!AS_JSON) console.log('[reap] --dry 模式，未执行任何结束操作'); process.exit(0) }

// 一次把整棵进程树的匹配项都结束掉，避免只杀子进程留下无主浏览器进程
const ids = procs.map(p => p.Pid)
const killScript = `Stop-Process -Id ${ids.join(',')} -Force -ErrorAction SilentlyContinue; Write-Output 'DONE'`
const kf = path.join(os.tmpdir(), 'h2-reap-kill-' + process.pid + '.ps1')
fs.writeFileSync(kf, killScript, 'utf8')
try {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', kf], { encoding: 'utf8' })
  if (r.error) throw r.error
} catch (e) {
  console.error('[reap] 结束进程失败：' + e.message); process.exit(2)
} finally { try { fs.unlinkSync(kf) } catch (e) { } }

console.log(`[reap] 已结束 pid=${ids.join(',')}`)
let after
try { after = runPs() } catch (e) { console.error('[reap] 复核失败：' + e.message); process.exit(2) }
if (after.length === 0) { console.log('[reap] 复核：已清空 ✓'); process.exit(0) }
console.log(`[reap] 复核：仍有 ${after.length} 个残留 ✗  pid=${after.map(p => p.Pid).join(',')}`)
process.exit(1)

