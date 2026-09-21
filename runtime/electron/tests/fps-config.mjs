#!/usr/bin/env node
/* fps-config.mjs —— 帧率可配置 + **config 消息实时生效** 的回归（全程离屏：--hidden，不显示窗口、不碰光标）
 *
 * 断言三件事：
 *   ① 启动参数 --fps saver|standard|smooth 会决定帧率预算；
 *   ② 宿主发 `config {fps: ...}` 后**同一个进程**（不重启窗口）立即采用新值 —— 主进程日志 + 渲染层确认都要有；
 *   ③ 右键菜单那条路（--test-setting fps=... 走 applySetting，与菜单项同一函数）会发出
 *      `setting {key:'window.fps'}` 给宿主持久化，并且本地也立即生效。
 * 用法: node tests/fps-config.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, OUT, mkdir, sleep, section, report, killStrayElectron, readLog, runDir } from './harness.mjs'

const DIR = runDir('fps')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
const lastFps = (s) => {
  const m = [...s.matchAll(/renderer: fps-config -> (\{[^\n]*\})/g)]
  if (!m.length) return null
  try { return JSON.parse(m[m.length - 1][1]) } catch { return null }
}

section('帧率配置：启动值 + config 实时生效（离屏）')

/* ---------- ① 启动时的预设 ---------- */
const home1 = tmpHome('fps-saver')
const log1 = path.join(DIR, 'saver.log')
fs.rmSync(log1, { force: true })
const s1 = runRuntime(['--hidden', '--fps', 'saver', '--exit-after', '6'], { home: home1, log: log1 })
await s1.waitExit(20000)
const lg1 = readLog(log1)
const f1 = lastFps(lg1)
check('--fps saver 启动：主进程在渲染层就绪后下发了 fps 预算', /renderer ready -> fps \{"power":"saver"/.test(lg1),
  (lg1.split('\n').find((l) => l.includes('renderer ready -> fps')) || '无').slice(-90))
check('--fps saver 启动：渲染层确认 idle=4', !!f1 && f1.idle === 4 && f1.power === 'saver', JSON.stringify(f1))

/* ---------- ② config 消息实时改（不重启窗口） ---------- */
const home2 = tmpHome('fps-live')
const log2 = path.join(DIR, 'live.log')
fs.rmSync(log2, { force: true })
const s2 = runRuntime(['--hidden', '--fps', 'saver', '--window-timeout', '60000'], { home: home2, log: log2 })
const ready = await s2.waitLine ? null : null
await sleep(2500)
const before = lastFps(readLog(log2))
check('初始为 saver（idle=4）', !!before && before.idle === 4, JSON.stringify(before))

s2.send({ kind: 'config', fps: 'smooth' })
await sleep(1500)
const afterPreset = lastFps(readLog(log2))
check('config {fps:"smooth"} 后渲染层立即采用 idle=30 / working=120',
  !!afterPreset && afterPreset.idle === 30 && afterPreset.working === 120 && afterPreset.power === 'smooth',
  JSON.stringify(afterPreset))

s2.send({ kind: 'config', fps: { idle: 7, thinking: 11, waiting: 13, working: 17 } })
await sleep(1500)
const afterCustom = lastFps(readLog(log2))
check('config {fps:{idle:7,thinking:11,waiting:13,working:17}} 生效（power=custom）',
  !!afterCustom && afterCustom.idle === 7 && afterCustom.thinking === 11 && afterCustom.waiting === 13 &&
  afterCustom.working === 17 && afterCustom.power === 'custom', JSON.stringify(afterCustom))

const lg2 = readLog(log2)
const windowsCreated = (lg2.match(/window created/g) || []).length
check('整个过程没有重启窗口（只创建过一次窗口）', windowsCreated === 1, 'window created × ' + windowsCreated)
check('config 消息不落盘（持久化由宿主负责）', !/saveWindowPatch|config.json.*write/.test(lg2))
check('主进程日志也记录了新的 fps 预算', /fps -> \{"power":"custom","idle":7/.test(lg2),
  (lg2.split('\n').filter((l) => l.includes('fps ->')).slice(-1)[0] || '无').slice(-90))

s2.send({ kind: 'config', fps: 'bogus-preset' })
await sleep(900)
const afterBogus = lastFps(lg2)
check('非法 fps 值被忽略且不崩（保持上一个有效值）', !!afterBogus && afterBogus.idle === 7, JSON.stringify(afterBogus))
s2.send({ kind: 'shutdown' })
const r2 = await s2.waitExit(10000)
check('退出码 0', !!r2 && r2.code === 0, 'exit=' + (r2 && r2.code))

/* ---------- ③ 菜单那条路（setting -> 宿主持久化） ---------- */
const home3 = tmpHome('fps-menu')
const log3 = path.join(DIR, 'menu.log')
fs.rmSync(log3, { force: true })
const s3 = runRuntime(['--hidden', '--fps', 'saver', '--test-setting', 'fps=smooth', '--exit-after', '5'], { home: home3, log: log3 })
await s3.waitExit(20000)
const lg3 = readLog(log3)
const setLine = s3.stdout.find((l) => l.includes('"kind":"setting"')) || ''
check('菜单路径发出 setting {key:"window.fps",value:"smooth"} 给宿主持久化',
  /"key":"window\.fps"/.test(setLine) && /"value":"smooth"/.test(setLine), setLine.trim().slice(0, 120))
check('菜单路径本地也立即生效（渲染层确认 smooth）', (() => { const f = lastFps(lg3); return !!f && f.power === 'smooth' && f.idle === 30 })(),
  JSON.stringify(lastFps(lg3)))
const cfgFile = path.join(home3, 'config.json')   /* --home 指定时 HOME 就是该目录本身 */
let cfgJson = null
try { cfgJson = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch { /* ignore */ }
check('落盘 config.json 里 window.fps = "smooth"', !!cfgJson && cfgJson.window && cfgJson.window.fps === 'smooth',
  cfgJson ? JSON.stringify(cfgJson.window && cfgJson.window.fps) : '读不到')

section(ok ? '帧率配置：全部通过' : '帧率配置：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
