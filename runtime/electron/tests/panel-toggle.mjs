#!/usr/bin/env node
/* panel-toggle.mjs —— 交互模型回归（全离屏、零真实输入）
 * 模型（用户 2026-09-12 定）：悬停→轻量面板 · 单击→什么都不做（留给拖动）· 拖动→移动窗口 ·
 *                            **双击→开关完整面板** · 右键→菜单
 * ①悬停只出轻量面板 ②双击开、再双击关 ③面板开着时悬停不出轻量面板 ④单击不切面板也不聚焦
 * ⑤命中区自检（图标圆 ∪ 面板矩形：面板内可交互、空隙仍穿透 —— 2026-09-13 用户拍板）⑥重启后默认关闭且不持久化
 * ⑦拖动 20 次不产生任何面板切换、位置记忆只由真拖动写入 ⑧缓慢双击（>350ms）不误判 ⑨双击抖动不产生位移落盘
 * 说明：鼠标用 --test-script 时间轴灌进渲染层，走的是**同一套** hDown/hMove/hUp（不合成真实输入，也不动 stdio 协议）
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, sleep, section, report, readLog, killStrayElectron, mkdir } from './harness.mjs'

const DIR = mkdir(path.join(new URL('../test/out', import.meta.url).pathname.replace(/^\//, ''), 'panel-toggle'))
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
const CLICK = (x, y) => `d,${x},${y};u,${x},${y}`
const DRAG = (x, y, dx, dy) => `d,${x},${y};m,${x + Math.round(dx / 2)},${y + Math.round(dy / 2)};m,${x + dx},${y + dy};u,${x + dx},${y + dy}`

section('面板交互模型：悬停 / 单击 / 拖动 / 双击（离屏，零真实输入）')

/* 时间轴脚本 */
const steps = []
let at = 1200
steps.push({ at, hover: true }); at += 600
steps.push({ at, mouse: '160|' + CLICK(100, 100) }); at += 700                              /* ⑧ 单击 */
steps.push({ at, mouse: '420|' + CLICK(100, 100) + '|' + CLICK(100, 100) }); at += 1500      /* ⑨ 缓慢双击 */
steps.push({ at, mouse: '160|' + CLICK(100, 100) + '|' + CLICK(100, 100) }); at += 900       /* ② 双击开 */
steps.push({ at, hover: false }); at += 250
steps.push({ at, hover: true }); at += 700                                                  /* ③ 互斥 */
for (let i = 0; i < 20; i++) { steps.push({ at, mouse: '150|' + DRAG(100, 100, 30 + i, 20) }); at += 240 }  /* ⑦ 20 次拖动 */
at += 700
steps.push({ at, mouse: '160|d,100,100;m,101,101;u,101,101|d,100,100;m,100,101;u,100,101' }); at += 900   /* ⑩ 抖动双击 → 关 */

const scriptPath = path.join(DIR, 'script.json')
fs.writeFileSync(scriptPath, JSON.stringify(steps))
console.log('  脚本时间轴：' + steps.length + ' 步，总长 ' + at + 'ms')

const h1 = tmpHome('panel-1')
const log1 = path.join(DIR, 'main.log')
fs.rmSync(log1, { force: true })
const s1 = runRuntime(['--hidden', '--window-timeout', '120000', '--test-script', scriptPath], { home: h1, log: log1 })
await s1.waitExit(((at + 2500) / 1000 + 6) * 1000)
const lg = readLog(log1)
s1.send({ kind: 'shutdown' }).valueOf?.()
await sleep(200)

check('① 悬停：轻量面板显示（label=SHOW）', /hot=true label=SHOW panelOpen=false/.test(lg),
  (lg.split('\n').find((l) => l.includes('label=SHOW')) || '无').slice(-52))
check('④ 单击后（缓慢双击之前）没有任何面板日志',
  !/panel (OPEN|CLOSED)（/.test(lg.slice(0, lg.indexOf('test-script mouse 420|'))),
  '第一段无 panel 日志')
check('④ 单击：**不再聚焦 DSH**（旧路径已移除）', !/-> focus DSH|focus attempt|focus-dsh/.test(lg), '无任何 focus 痕迹')
check('④ 单击日志本身在（手势判定生效）', /click on icon（单击/.test(lg),
  (lg.split('\n').filter((l) => l.includes('click on icon')).slice(-1)[0] || '无').slice(-44))
check('⑧ 缓慢双击（间隔 420ms）：**不**切面板',
  !/panel (OPEN|CLOSED)（/.test(lg.slice(0, lg.indexOf('test-script mouse 160|d,100,100'))),
  '前 1.5 秒无 panel 日志')
check('② 双击：完整面板 OPEN（double-click 触发）', /panel OPEN（double-click）/.test(lg),
  (lg.split('\n').find((l) => l.includes('panel OPEN')) || '无').slice(-88))
check('② 展开后窗口 = 440×525，图标中心不动', /panel OPEN[^\n]*win=440x525/.test(lg) && /iconCenter=\(/.test(lg),
  (lg.match(/panel OPEN[^\n]*iconCenter=\([^)]*\)/) || ['无'])[0].slice(-58))
/* ⑤ 命中区自检（判据于 2026-09-13 按用户决定扩展：**图标圆 ∪ 面板可见矩形**）
   旧契约是"面板整块穿透"（panelTop/panelMid 都 false）；用户原话：
   「你这个右边有个条，但是我不能拉动这个条……我现在撤回我这个决定，他就是一个可以交互的窗口」
   ⇒ 面板区域改为「可交互」，图标与面板之间那段空隙仍然穿透。详细取证在 tests/panel-hit.mjs。 */
check('⑤ 命中区自检：图标圆心=可交互；图标↔面板之间的空隙=穿透；面板顶/面板中/滚动条列=全部可交互',
  /panel hitcheck iconCenter=true belowIcon=false panelTop=true panelMid=true scrollbar=true/.test(lg),
  (lg.split('\n').find((l) => l.includes('panel hitcheck')) || '无').slice(-92))
check('③ 面板开着时悬停：轻量面板 HIDDEN（互斥生效）', /hot=true label=HIDDEN panelOpen=true/.test(lg),
  (lg.split('\n').filter((l) => l.includes('hot=true')).slice(-1)[0] || '无').slice(-52))
/* 渲染层回显的行带 'renderer:' 前缀，会与主进程同一事件各记一次 ⇒ 计数前只留主进程行 */
const mainOnly = lg.split('\n').filter((l) => !/renderer:/.test(l)).join('\n')
const dragEnds = (mainOnly.match(/drag-end/g) || []).length
const posWrites = (mainOnly.match(/config saved -> \{"position"/g) || []).length
check('⑦ 拖动 20 次：每次都走了 drag-end（拖动语义未改坏）', dragEnds === 20, dragEnds + ' 次 drag-end（过滤掉 renderer 回显后应为 20）')
check('⑦ 位置记忆只由真拖动写入', posWrites === 20, posWrites + ' 次落盘（应为 20）')
/* 只数主进程那一侧的事件行（渲染层会回一条同名的 renderer: 日志，别重复计数） */
const panelEvents = (lg.match(/panel (OPEN|CLOSED)（/g) || []).length
check('⑦ 拖动 20 次：面板开关次数**零变化**（拖完不算双击前半段）', panelEvents === 2,
  panelEvents + ' 次（应为 2：双击开 + 抖动双击关）')
check('⑩ 抖动双击（1–2px）：仍判定为双击并 CLOSED', /panel CLOSED（double-click）/.test(lg),
  (lg.split('\n').filter((l) => l.includes('panel CLOSED')).slice(-1)[0] || '无').slice(-70))
check('⑩ 抖动双击没有产生额外的位置落盘（位置记忆不被污染）', posWrites === 20 && dragEnds === 20,
  '拖动 ' + dragEnds + ' 次 → 落盘 ' + posWrites + ' 次（应为 20/20，抖动不产生落盘）')

/* ⑥ 不持久化 */
const cfgFile = path.join(h1, 'config.json')
let cfgJson = null, cfgExists = true
try { cfgJson = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch { cfgExists = false }
check('⑥ 面板开关**不落盘**（config.json 里没有 panel/panelAlpha 键）',
  !cfgExists || (!('panel' in cfgJson) && !('panelAlpha' in cfgJson) && !(cfgJson.window && ('panel' in cfgJson.window || 'panelAlpha' in cfgJson.window))),
  cfgExists ? Object.keys(cfgJson.window || {}).join(',') : 'config.json 未创建')

/* ⑥b 重启后默认关闭 */
const h2 = tmpHome('panel-2')
const log2 = path.join(DIR, 'restart.log')
fs.rmSync(log2, { force: true })
const s2 = runRuntime(['--print-plan'], { home: h2, log: log2 })
await s2.waitExit(8000)
const planLine = (readLog(log2).match(/PLAN (\{.*\})/) || [])[1] || '{}'
let planJson = {}
try { planJson = JSON.parse(planLine) } catch { /* ignore */ }
check('⑥ 重启后：`--print-plan` 里 panelOpen=false（默认关闭）', planJson.panelOpen === false, 'panelOpen=' + planJson.panelOpen)
check('⑥ α 只在一处常量：plan.panelAlpha=0.78（将来做 window.panelAlpha）', planJson.panelAlpha === 0.78, 'panelAlpha=' + planJson.panelAlpha)

/* 源码级 */
const src = fs.readFileSync(path.join(new URL('..', import.meta.url).pathname.replace(/^\//, ''), 'main.js'), 'utf8')
check('源码：`focusDsh(` 已无任何**调用**（只留注释）', !/^\s*focusDsh\(/m.test(src), '0 处调用')
check('源码：面板**开关** panelOpen 不进任何持久化键（panelAlpha/panelDetail 是窗口偏好，允许持久化）',
  !/saveWindowPatch\([^)]*panelOpen/.test(src) && /saveWindowPatch\([^)]*panelAlpha/.test(src), 'panelOpen 0 处 / panelAlpha 已持久化')

killStrayElectron()
section(ok ? '面板交互模型：全部通过' : '面板交互模型：有失败项')
process.exit(ok ? 0 : 1)
