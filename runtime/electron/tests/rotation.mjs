#!/usr/bin/env node
/* rotation.mjs —— 旋转缺陷的客观取证（全离屏，不动鼠标、不弹真窗口）
 *
 * 两条判据（对应两个缺陷）：
 *   A) 核心不参与旋转（SPEC 第 2 节 L7："核心恒定不变形"）：
 *      隐藏粒子云后（粒子是 disk 分布、会扫过任何区域，不隔离就测不出核心），
 *      核心三角 + 中心圆 + 静态环在 0/90/180/270 四个相位下必须**逐像素一致**。
 *   B) 旋转轴心在视框中心：
 *      只保留分段环时，环带亮像素的**半径分布**必须不随相位变化。
 *      轴心偏离中心 D 时，环会绕偏心点公转 —— 相对图心的半径按 ±D 摆动，这个静止量立刻暴露。
 * 并要求"确实在转"成立，否则"一致"没有意义。
 *
 * 用法: node rotation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { runRuntime, tmpHome, OUT, mkdir, killStrayElectron, section, report, sleep, runDir } from './harness.mjs'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const DIR = runDir('rotation')
const BOX = 240
const PHASES = [0, 90, 180, 270]
const ALL = ['plate', 'tick', 'cloud', 'inner', 'glowA', 'glowB', 'core', 'burst', 'flash']
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

section('旋转缺陷取证（离屏抓图 + 冻结相位；不移动鼠标、不显示窗口）')

async function shot (tag, phase, hide) {
  const f = await shotOnce(tag, phase, hide)
  /* 并发/负载高时离屏抓图偶尔会错过 painted（SHOT-FAIL）——那是采集侧抖动，
     不该让"旋转是否正确"的结论失真，重试一次，仍失败才由调用方报错。 */
  if (!fs.existsSync(f)) {
    console.log(`  [重试] ${tag} ${phase}° 第一次未产出 PNG`)
    await sleep(700)
    return await shotOnce(tag, phase, hide)
  }
  return f
}
async function shotOnce (tag, phase, hide) {
  const f = path.join(DIR, `${tag}-${phase}.png`)
  fs.rmSync(f, { force: true })
  const home = tmpHome('rot')
  const log = path.join(DIR, 'shot.log')
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--shot', String(BOX), '--bg', 'dark', '--state', 'WORKING', '--spin', String(phase),
    '--hide', hide, '--out', f, '--settle-ms', '300', '--hidden'], { home, log })
  const r = await st.waitExit(40000)
  if (!r || r.code !== 0) console.log(`  [warn] ${tag} ${phase}° exit=${r && r.code}`)
  await sleep(120)
  return f
}
async function load (f) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { d: data, W: info.width, K: info.width / 200, cx: info.width / 2, cy: info.width / 2 }
}
function regionDiff (a, b, r0, r1) {
  let n = 0, max = 0, cnt = 0
  for (let y = 0; y < a.W; y++) for (let x = 0; x < a.W; x++) {
    const r = Math.hypot(x - a.cx, y - a.cy) / a.K
    if (r < r0 || r > r1) continue
    const i = (y * a.W + x) * 4
    const d = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2]))
    n += d; if (d > max) max = d; cnt++
  }
  return { mean: n / cnt, max, cnt }
}
function ringStats (a) {
  let sw = 0, sr = 0, maxR = 0
  const hist = new Array(40).fill(0)
  for (let y = 0; y < a.W; y++) for (let x = 0; x < a.W; x++) {
    const i = (y * a.W + x) * 4
    const lum = a.d[i] + a.d[i + 1] + a.d[i + 2]
    if (lum < 90) continue
    const r = Math.hypot(x - a.cx, y - a.cy) / a.K
    if (r > maxR) maxR = r
    if (r < 45 || r > 75) continue
    sw += lum; sr += r * lum
    hist[Math.min(39, Math.floor(r / 2))]++
  }
  let best = 0, bestN = 0
  for (let i = 0; i < hist.length; i++) if (hist[i] > bestN) { bestN = hist[i]; best = i * 2 + 1 }
  return { meanR: sr / sw, maxR, peakR: best, bright: sw }
}

const NC = []
for (const p of PHASES) NC.push(await load(await shot('nocloud', p, 'cloud')))
console.log('  A) 核心静止性：隐藏等离子云后（粒子是 disk 分布，会扫过任何区域，必须隔离）')
let coreMax = 0, ringsMax = 0
for (let i = 1; i < NC.length; i++) {
  const core = regionDiff(NC[0], NC[i], 0, 46)
  const rings = Math.max(regionDiff(NC[0], NC[i], 46, 55).max, regionDiff(NC[0], NC[i], 65, 100).max)
  coreMax = Math.max(coreMax, core.max)
  ringsMax = Math.max(ringsMax, rings)
  console.log(`     ${String(PHASES[i]).padStart(3)}° vs 0°：核心区(r≤46) 最大通道差 ${core.max}（均值 ${core.mean.toFixed(4)}）；静态层(r46–55 ∪ 65–100，避开分段环) 最大通道差 ${rings.max}`)
}
check('核心三角 + 中心圆在所有相位下逐像素一致（核心不参与旋转）', coreMax <= 2,
  `跨相位最大通道差 ${coreMax}（阈值 2）`)
check('底盘 / 刻度环 / 内环 / 辉光在所有相位下逐像素一致', ringsMax <= 2,
  `跨相位最大通道差 ${ringsMax}（阈值 2）`)

const SO = []
for (const p of PHASES) SO.push(await load(await shot('segonly', p, ALL.filter((c) => c !== 'seg').join(','))))
const st = SO.map(ringStats)
console.log('  B) 轴心正确性：只保留分段环（r=60 圆，dasharray 40 16 8 16）')
console.log('     相位   环带加权平均半径   直方图峰值半径   最外亮像素半径')
for (let i = 0; i < PHASES.length; i++) {
  console.log(`     ${String(PHASES[i]).padStart(3)}°   ${st[i].meanR.toFixed(3)} (用户单位)      ${st[i].peakR}            ${st[i].maxR.toFixed(2)}`)
}
const rMean = st.map((s) => s.meanR), rMax = st.map((s) => s.maxR)
const dMean = Math.max(...rMean) - Math.min(...rMean)
const dMax = Math.max(...rMax) - Math.min(...rMax)
console.log(`     环平均半径摆动 ${dMean.toFixed(3)} 用户单位；最外像素半径摆动 ${dMax.toFixed(3)} 用户单位`)
check('分段环半径不随相位摆动（轴心在视框中心）', dMean <= 0.35 && dMax <= 2.0,
  `平均半径摆动 ${dMean.toFixed(3)}，最外半径摆动 ${dMax.toFixed(3)}（用户单位；轴心偏 D 会有 ±D 量级摆动）`)

function bandDiff (a, b) {
  let n = 0
  for (let y = 0; y < a.W; y++) for (let x = 0; x < a.W; x++) {
    const r = Math.hypot(x - a.cx, y - a.cy) / a.K
    if (r < 55 || r > 65) continue
    const i = (y * a.W + x) * 4
    if (Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1])) > 16) n++
  }
  return n
}
const rot = PHASES.slice(1).map((p, i) => bandDiff(SO[0], SO[i + 1]))
console.log('  C) 分段环带内与 0° 不同的像素数（90/180/270°）: ' + rot.join(', '))
check('分段环确实随相位转动（不是没转）', rot.every((v) => v > 0), rot.join(','))

check('内容始终收在视框内（最外亮像素半径 ≤ 100 用户单位）', rMax.every((v) => v <= 100),
  '各相位最外半径 ' + rMax.map((v) => v.toFixed(2)).join(', '))

section(ok ? '旋转取证：全部通过' : '旋转取证：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
