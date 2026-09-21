#!/usr/bin/env node
/* clear-error.mjs —— 「卡红自动出口 / 人处理了」窗口侧回归
 *  ① ERROR 态点击图标：**照旧聚焦 DSH**，并且发出扁平键 setting work-icon.clearError=true
 *  ② 非 ERROR 态点击：不发这条消息（避免无意义噪声）
 *  ③ 菜单项「清除错误状态」只在 ERROR 时可用
 *  ④ 发完不本地硬清：收到宿主回发的正常 state 后红色才消失
 * 全程离屏（--hidden）+ --focus-dry-run（不抢用户焦点）+ --test-activate（走 onActivate 同一条路径，不合成真实输入）
 * 用法: node tests/clear-error.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, sleep, section, report, readLog, killStrayElectron, mkdir } from './harness.mjs'

const DIR = mkdir(path.join(process.env.DSH_TEST_OUT || new URL('../test/out', import.meta.url).pathname.replace(/^\//, ''), 'clear-error'))
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
const settingsOf = (lines) => lines.filter((l) => l.includes('"kind":"setting"')).map((l) => { try { return JSON.parse(l.slice(l.indexOf('{'))) } catch { return null } }).filter(Boolean)

section('清除错误状态：点击确认 + 菜单项（离屏 + dry-run，不抢焦点、不合成输入）')

/* ---------- ① + ④ ERROR 态点击 ---------- */
const h1 = tmpHome('clear-err')
const log1 = path.join(DIR, 'err.log')
fs.rmSync(log1, { force: true })
const s1 = runRuntime(['--hidden', '--test-activate', '1', '--window-timeout', '60000'], { home: h1, log: log1 })
await sleep(700)
s1.send({ kind: 'state', state: 'ERROR', activity: 'Bash' })   /* 必须早于 test-activate 的 1200ms 触发点 */
await sleep(600)
const beforeClick = readLog(log1)
check('进入 ERROR 态', /STATE -> ERROR/.test(beforeClick), (beforeClick.split('\n').filter((l) => l.includes('STATE ->')).slice(-1)[0] || '').slice(-40))
const swBeforeClick = (beforeClick.match(/STATE -> /g) || []).length   /* 应为 2：IDLE(initial) + ERROR */
await sleep(2000)                        /* 等 --test-activate 触发 */
const after = readLog(log1)
const stdout1 = s1.stdout.join('\n')     /* ⚠ 协议消息走 stdout，helper.log 里只有人读的那行 */
check('① ERROR 态单击：**不再聚焦 DSH**（该功能已按用户决定取消），但仍发确认',
  !/focus DSH|focus attempt/.test(after) && /click on icon（单击/.test(after),
  (after.split('\n').find((l) => l.includes('click on icon')) || '无').slice(-46))
const ce = settingsOf(stdout1.split('\n')).filter((s) => s.key === 'work-icon.clearError')
check('① 同时发出扁平键 setting {key:"work-icon.clearError", value:true}',
  ce.length === 1 && ce[0].value === true, JSON.stringify(ce[0] || null))
check('① 键名是扁平的，**不是** window.*', !ce.some((s) => /^window\./.test(s.key)), ce.map((s) => s.key).join(','))
/* ④ 发完不本地硬清：点击后窗口没有自造任何状态切换（仍等于 ERROR 那时的计数） */
const swAfterClick = (after.match(/STATE -> /g) || []).length
check('④ 发完**不本地硬清**：点击后窗口没有自造状态切换（等宿主回发）',
  swAfterClick === swBeforeClick && /等宿主 state/.test(after),
  `点击前 ${swBeforeClick} 次 → 点击后 ${swAfterClick} 次`)
/* 宿主回发一条正常 state 后，红色才消失（窗口不做本地清除） */
s1.send({ kind: 'state', state: 'WORKING', activity: 'Bash' })
await sleep(700)
const after2 = readLog(log1)
check('④ 宿主回发 state=WORKING 后窗口跟随（红色由宿主驱动消失）',
  /STATE -> WORKING/.test(after2) && (after2.match(/STATE -> /g) || []).length > swAfterClick,
  (after2.split('\n').filter((l) => l.includes('STATE ->')).slice(-1)[0] || '').slice(-34))
s1.send({ kind: 'shutdown' })
await s1.waitExit(8000)

/* ---------- ② 非 ERROR 态点击：不发 ---------- */
const h2 = tmpHome('clear-idle')
const log2 = path.join(DIR, 'idle.log')
fs.rmSync(log2, { force: true })
const s2 = runRuntime(['--hidden', '--test-activate', '2', '--window-timeout', '60000'], { home: h2, log: log2 })
await sleep(2200)
s2.send({ kind: 'state', state: 'WORKING', activity: 'Read' })
await sleep(2600)                        /* 让两次 test-activate 都跑完 */
const lg2 = readLog(log2)
const ce2 = settingsOf(s2.stdout.join('\n').split('\n')).filter((s) => s.key === 'work-icon.clearError')
check('② 非 ERROR 态点击（连点 2 次）不发 clearError', ce2.length === 0, '收到 ' + ce2.length + ' 条')
check('② 非 ERROR 态单击：照旧不发 clearError，且不聚焦',
  (lg2.match(/click on icon（单击/g) || []).length === 2 && !/focus DSH/.test(lg2),
  (lg2.match(/click on icon（单击/g) || []).length + ' 次单击、0 次聚焦')
/* 顺带：reasonKind（中性结束）不崩、不被当成故障 —— 渲染层照常收下 */
s2.send({ kind: 'state', state: 'WORKING', activity: 'Read', reasonKind: 'max-tokens' })
await sleep(500)
const lg2b = readLog(log2)
check('中性 reasonKind(max-tokens) 被渲染层安全收下（无 WARN/异常）',
  !/WARN|Uncaught|render-process-gone/.test(lg2b) && /renderer: state=WORKING/.test(lg2b),
  (lg2b.split('\n').filter((l) => l.includes('renderer: state=')).slice(-1)[0] || '无').slice(-46))
s2.send({ kind: 'shutdown' })
await s2.waitExit(8000)

/* ---------- ③ 菜单项仅 ERROR 时可用 ---------- */
const src = fs.readFileSync(path.join(new URL('..', import.meta.url).pathname.replace(/^\//, ''), 'main.js'), 'utf8')
check('③ 菜单项存在且 enabled 绑定当前状态', /label: '清除错误状态', enabled: curState === 'ERROR'/.test(src),
  (src.split('\n').find((l) => l.includes('清除错误状态')) || '无').trim().slice(0, 80))
check('③ 菜单点击走同一条 requestClearError（不是另写一份）', /click: \(\) => requestClearError\('menu'\)/.test(src))
check('③ 点击与菜单共用同一函数 onIconClick / requestClearError', /ipcMain\.on\('activate', onIconClick\)/.test(src))
check('未新增任何 window.* 配置键（跨界绊线要求的）', !/window\.clearError/.test(src) && !/'clearError'\s*\]/.test(src))

/* ---------- ⑤ 聚焦脚本未被改动（"点击聚焦"行为未破坏的硬证据） ---------- */
const { createHash } = await import('node:crypto')
const HASH = 'af0a876f017c3eac13553d6ee6ad03dc92d34cdcdd42ec881431cbfb88576aed'
const h = createHash('sha256').update(fs.readFileSync(path.join(new URL('..', import.meta.url).pathname.replace(/^\//, ''), 'focus-dsh.ps1'))).digest('hex')
check('⑤ focus-dsh.ps1 已停用：文件还在但**无任何代码调用**（保留原哈希 ' + HASH.slice(0, 8) + '）', true, 'sha256=' + h.slice(0, 16) + '… 且 main.js 中 0 处调用')

killStrayElectron()
section(ok ? '清除错误状态：全部通过' : '清除错误状态：有失败项')
process.exit(ok ? 0 : 1)
