#!/usr/bin/env node
/* particle-motion.mjs —— 主图标粒子运动多样性的**量化**取证（2026-09-19，用户要求
 * 「主体是旋转，但可以速度不一，方向不一，还可以半径小幅波动」）
 *
 * 为什么不能只写"看起来更随机了"：分布必须是可复算的数，且要有像素后果。
 *   ① 模型口径：渲染层把车道表打进日志（motion: lanes=… speeds=… dirs=… wobAmp=… periods=… particles=… reverseShare=…）
 *   ② 像素口径（本文件的主力）：
 *      · 用既有的 `--hide` 通道**逐条车道隔离**（`--hide lane1,lane2,lane3` 只留 lane0），
 *        在冻结相位 0° 与 100° 各抓一张，再用**穷举旋转匹配**测出该车道这一相位下实际转了多少度；
 *      · 期望值 = 100° × 该车道速度因子（速度不一 / 方向不一 ⇒ 各车道测得的角位移不同、有负向）；
 *      · 半径波动 = 同一车道在相位 0°（scale 恒为 1）与 100° 的**最外粒子半径**之差——必须"存在且小"。
 *   ③ 核心三角恒定不变形：隐藏粒子后跨相位核心区逐像素一致（阈值 2）。
 *   ④ 省电档（eco / --fps saver）：per-lane 运动**必须不生效**（测得角位移全部等于基础角位移 =
 *      改动前的整片刚性旋转），并断言渲染层留痕 on=0。
 *
 * 全程离屏（--hidden）、冻结抓图、不动光标、不合成任何输入。
 * 用法: node tests/particle-motion.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { runRuntime, tmpHome, runDir, readLog, killStrayElectron, section, report, sleep } from './harness.mjs'

const DIR = runDir('particle-motion')
const BOX = 240
const SPIN = 100                         /* 冻结相位（度）——挑一个能让各车道角位移互相拉开的相位 */
const SPIN_MS = SPIN / 360 * 6000        /* 冻结态下渲染层把 --spin 折算成的合成时间（与 index.html 同口径） */
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

/* ---------- PNG 解码（精确 Paeth） ---------- */
function pngDecode (buf) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++], cur = raw.slice(p, p + stride); p += stride
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const line = out.slice(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = cur[x]
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      line[x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + pr) & 0xff
    }
  }
  return { w, h, bpp, px: out }
}
const ALL = ['plate', 'tick', 'progRing', 'seg', 'inner', 'glowA', 'glowB', 'core', 'burst', 'flash']
const CLOUD_ONLY = ALL.join(',')                       /* 只留等离子云：把其它 10 个类全隐藏 */
const laneOnly = (i) => CLOUD_ONLY + ',' + [0, 1, 2, 3].filter((k) => k !== i).map((k) => 'lane' + k).join(',')
const HIDE_CLOUD = 'cloud'                             /* 只隐藏粒子云：测核心是否随车道动 */

async function shot (tag, spin, hide, extra) {
  const f = path.join(DIR, `${tag}-${spin}.png`)
  fs.rmSync(f, { force: true })
  const log = path.join(DIR, `${tag}-${spin}.log`)
  fs.rmSync(log, { force: true })
  const st = runRuntime(['--shot', String(BOX), '--bg', 'dark', '--state', 'WORKING', '--spin', String(spin),
    '--hide', hide, '--out', f, '--settle-ms', '300', '--hidden'].concat(extra || []), { home: tmpHome('pm'), log })
  const r = await st.waitExit(40000)
  await sleep(90)
  return { f, log, code: r ? r.code : null }
}
async function load (f) {
  if (!fs.existsSync(f)) return null
  const img = pngDecode(fs.readFileSync(f))
  /* ⚠️ --shot 240 的实际落盘是 **480×480**（窗口 240 CSS px × dpr 2）—— 比例必须从图宽推，
     不能写死 BOX/200（写死会让"用户单位"整体差 2 倍，半径量出来是 180 而不是 90）。 */
  return { ...img, K: img.w / 200, cx: img.w / 2, cy: img.h / 2 }
}
const litAt = (img, x, y) => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return 0
  const i = (y * img.w + x) * img.bpp
  return img.px[i] + img.px[i + 1] + img.px[i + 2]
}
/* 半径统计：亮像素（粒子）的最外半径与亮度加权平均半径（用户单位） */
function radial (img) {
  let maxR = 0, sw = 0, sr = 0, n = 0
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const s = litAt(img, x, y)
    if (s < 60) continue
    const r = Math.hypot(x - img.cx, y - img.cy) / img.K
    if (r > maxR) maxR = r
    if (r > 60) { sw += s; sr += r * s; n++ }
  }
  return { maxR, meanR: sw ? sr / sw : 0, n }
}
/* 穷举旋转匹配：把 A 绕视框中心转到与 B 最像的那个角度（度，0~360） */
function estAngle (A, B) {
  const win = Math.round(110 * A.K)          /* 只扫图标圆内部，省时 */
  const cx = A.cx, cy = A.cy
  let best = null, s1 = Infinity, s2 = Infinity
  const score = (deg) => {
    const th = deg * Math.PI / 180, c = Math.cos(-th), s = Math.sin(-th)
    let d = 0, n = 0
    for (let y = cy - win; y < cy + win; y += 2) for (let x = cx - win; x < cx + win; x += 2) {
      const dx = x - cx, dy = y - cy
      const sx = Math.round(cx + dx * c - dy * s), sy = Math.round(cy + dx * s + dy * c)
      const a = litAt(A, sx, sy), b = litAt(B, x, y)
      if (a < 60 && b < 60) continue
      const ia = (sy * A.w + sx) * A.bpp, ib = (y * B.w + x) * B.bpp
      d += Math.abs(A.px[ia] - B.px[ib]) + Math.abs(A.px[ia + 1] - B.px[ib + 1]) + Math.abs(A.px[ia + 2] - B.px[ib + 2])
      n++
    }
    return n ? d / n : 1e9
  }
  for (let deg = 0; deg < 360; deg += 3) { const v = score(deg); if (v < s1) { s2 = s1; s1 = v; best = deg } else if (v < s2) s2 = v }
  for (let deg = best - 3; deg <= best + 3; deg++) { const v = score((deg + 360) % 360); if (v < s1) { s1 = v; best = (deg + 360) % 360 } }
  return { ang: best, best: s1, second: s2 }
}
const angDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

section('主图标粒子运动多样性（逐车道隔离 + 冻结相位 + 像素旋转测量；全程离屏）')

/* ---------- 一次抓图拿到模型留痕（模型行由渲染层在 init 打出） ---------- */
const base = await shot('all', 0, CLOUD_ONLY)
const lg = readLog(base.log)
const allM = lg.match(/motion: [^\n]*/g) || []
const mM = allM.length ? allM[allM.length - 1].match(/motion: ([^\n]*)/) : null
const model = {}
if (mM) for (const kv of mM[1].split(' ')) { const i = kv.indexOf('='); if (i > 0) model[kv.slice(0, i)] = kv.slice(i + 1) }
console.log('  渲染层留痕: ' + (mM ? mM[0] : '(没有 motion: 行)'))
const nums = (s) => String(s || '').split(',').map(Number)
const speeds = nums(model.speeds), dirs = nums(model.dirs), wob = nums(model.wobAmp), per = nums(model.periods), cnt = nums(model.particles)
const nLane = Number(model.lanes || 0)

check('M1 渲染层打出机器可读的车道表（速度/方向/半径波动幅度与周期/每道粒子数）',
  !!mM && nLane >= 2 && speeds.length === nLane && wob.length === nLane && per.length === nLane,
  mM ? ('lanes=' + nLane + ' speeds=' + model.speeds + ' wobAmp=' + model.wobAmp + ' periods=' + model.periods) : '没有 motion: 留痕')
check('M2 角速度不一：至少 2 个互不相同的速度因子，且都在 [0.2, 2.5] 倍基础角速度内',
  new Set(speeds).size >= 2 && speeds.every((v) => Math.abs(v) >= 0.2 && Math.abs(v) <= 2.5),
  'speeds=' + model.speeds + '（去重 ' + new Set(speeds).size + ' 个）')
check('M3 方向不一：至少 1 条车道反向（速度因子为负），且反向粒子占比落在 [15%,35%]',
  speeds.some((v) => v < 0) && Number(model.reverseShare) >= 0.15 && Number(model.reverseShare) <= 0.35,
  'dirs=' + model.dirs + ' reverseShare=' + model.reverseShare + '（每道粒子 ' + model.particles + '）')
const wobU = String(model.wobU || '').split('~').map(Number)
check('M4 半径波动是"小幅"：每道幅度 >0 且 ≤2 视框单位（r≤97 处 ≤2 用户单位 ⇒ 140px 下 ≤1.4px）',
  wob.length > 0 && wob.every((v) => v > 0 && v <= 2.0) && wobU.length === 2 && wobU[0] > 0 && wobU[1] <= 2.0,
  'wobAmp=' + model.wobAmp + ' 视框单位（' + model.wobU + '）；周期 ' + model.periods + ' ms（= 各车道自己的旋转周期）')
check('M5 每道粒子数基本均衡（按"深度排序序号 % 车道数"分组 ⇒ 相邻深浅的粒子速度不同）',
  cnt.length === nLane && Math.max(...cnt) - Math.min(...cnt) <= 2, 'particles=' + model.particles)

/* ---------- 像素：逐车道隔离，测相位 0° 与 100° 之间的实际旋转 ---------- */
const A0 = {}, A1 = {}
for (let i = 0; i < 4; i++) {
  const h = laneOnly(i)
  const s0 = await shot('lane' + i + '_p0', 0, h)
  const s1 = await shot('lane' + i + '_p' + SPIN, SPIN, h)
  A0[i] = await load(s0.f); A1[i] = await load(s1.f)
}
const haveLanes = A0[0] && A1[0]
const measured = []
if (haveLanes) for (let i = 0; i < 4; i++) {
  const e = estAngle(A0[i], A1[i])
  const r0 = radial(A0[i]), r1 = radial(A1[i])
  measured.push({ ...e, r0, r1, dR: r1.maxR - r0.maxR })
  console.log('  lane' + i + '：测得角位移 ' + String(e.ang).padStart(3) + '°（匹配残差 ' + e.best.toFixed(1) + '，次优 ' + e.second.toFixed(1) + '）' +
    '  最外粒子半径 ' + r0.maxR.toFixed(2) + '→' + r1.maxR.toFixed(2) + ' 用户单位（Δ ' + (r1.maxR - r0.maxR).toFixed(2) + '）' +
    '  亮像素 ' + r0.n + '/' + r1.n)
}
const expect = speeds.map((s) => ((SPIN * s) % 360 + 360) % 360)
check('P1 像素测得「速度不一」：四条车道在同一个 100° 相位下的实测角位移彼此不同（两两差 ≥10°）',
  measured.length === 4 && (function () {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (angDiff(measured[i].ang, measured[j].ang) < 10) return false
    return true
  })(),
  measured.length ? measured.map((e, i) => 'lane' + i + ' ' + e.ang + '°').join('  ') : '没有测到（车道不存在？）')
check('P2 像素测得「方向不一」：至少一条车道的角位移方向与基础旋转相反（>180° 的回退）且与期望值一致（±8°）',
  measured.length === 4 && expect.length === 4 && (function () {
    const back = measured.filter((e, i) => expect[i] > 180)
    return back.length >= 1 && measured.every((e, i) => angDiff(e.ang, expect[i]) <= 8)
  })(),
  measured.length ? ('实测 ' + measured.map((e) => e.ang + '°').join(',') + ' ｜ 期望(100°×速度因子) ' + expect.map((v) => Math.round(v) + '°').join(',')) : '没有测到')
/* 半径波动（= 各车道绕**偏离中心**的轴心旋转 ⇒ 每个粒子的半径随相位起伏）：
   ① 相位 0°→100° 之间，每条车道的最外粒子半径变化 |Δ| ∈ [0.2, 2.5] 用户单位（真的在起伏、且很小）；
   ② 硬上界：全云在 4 个相位上的最外半径摆动 ≤ 2·max|轴心偏移| + 0.6（0.6 = 1 设备像素量化的余量）
      —— 这条是"小幅"的可证上界，不是经验值；
   ③ 4 条车道的 Δ 不全相同（各车道轴心方向不同）。 */
const dmeas = measured.map((e) => e.r1.maxR - e.r0.maxR)
const wobHi = Number(wobU[1] || 0) * 2 + 0.6
const dOk = measured.length === 4 && wobU.length === 2 &&
  dmeas.every((v) => Math.abs(v) >= 0.2 && Math.abs(v) <= 2.5) &&
  (function () { for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (Math.abs(dmeas[i] - dmeas[j]) >= 0.2) return true; return false })()
check('P3 像素测得「半径小幅波动」：各车道相位 0°→100° 的最外半径变化 |Δ| ∈ [0.2, 2.5] 用户单位且各车道不同',
  dOk,
  measured.length ? ('实测 ΔmaxR ' + dmeas.map((v) => v.toFixed(2)).join(',') + ' ｜ 模型幅度 ' + model.wobAmp + ' 视框单位，量化台阶 0.42') : '没有测到')

/* 全云半径包络：4 个相位下最外半径的最大摆动 ≤ 2·max|轴心| + 0.6（"小幅"的可证上界） */
const envR = []
for (const p of [0, 90, 180, 270]) {
  const img = await load((await shot('cloud_p' + p, p, CLOUD_ONLY)).f)
  if (img) envR.push(radial(img).maxR)
}
const envSwing = envR.length === 4 ? Math.max.apply(null, envR) - Math.min.apply(null, envR) : NaN
check('P3b 全云最外半径在 4 个相位上的摆动 ≤ 2·max|轴心偏移|+0.6（= 半径波动"小幅"的硬上界）',
  envR.length === 4 && Number.isFinite(envSwing) && envSwing <= wobHi && envSwing >= 0.2,
  '实测摆动 ' + (Number.isFinite(envSwing) ? envSwing.toFixed(2) : 'n/a') + ' 用户单位（上界 ' + wobHi.toFixed(1) + '）｜ 各相位 ' + envR.map((v) => v.toFixed(2)).join(', '))

/* ---------- 核心三角恒定不变形（隐藏粒子云后跨相位逐像素一致） ---------- */
const coreImgs = []
for (const p of [0, 90, 180, 270]) coreImgs.push(await load((await shot('core_p' + p, p, HIDE_CLOUD)).f))
function coreDiff (a, b) {
  let max = 0
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const r = Math.hypot(x - a.cx, y - a.cy) / a.K
    if (r > 46) continue
    const i = (y * a.w + x) * a.bpp
    for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(a.px[i + k] - b.px[i + k]))
  }
  return max
}
let cmax = 0
if (coreImgs.every(Boolean)) for (let i = 1; i < coreImgs.length; i++) cmax = Math.max(cmax, coreDiff(coreImgs[0], coreImgs[i]))
check('P4 核心三角 + 中心圆在四个相位下逐像素一致（车道只包住粒子，核心不跟着动）',
  coreImgs.every(Boolean) && cmax <= 2, '跨相位核心区最大通道差 ' + cmax + '（阈值 2）')

/* ---------- 省电档：per-lane 运动必须不生效（= 改动前的整片刚性旋转） ---------- */
const S0 = {}, S1 = {}
for (const i of [0, 3]) {
  const h = laneOnly(i)
  S0[i] = await load((await shot('eco_lane' + i + '_p0', 0, h, ['--fps', 'saver'])).f)
  S1[i] = await load((await shot('eco_lane' + i + '_p' + SPIN, SPIN, h, ['--fps', 'saver'])).f)
}
const ecoLog = readLog(path.join(DIR, 'eco_lane0_p0-0.log'))    /* shot() 的日志名是 `<tag>-<spin>.log` */
const ecoAll = ecoLog.match(/motion: [^\n]*/g) || []
const ecoModel = ecoAll.length ? ecoAll[ecoAll.length - 1] : '(无)'
const ecoM = ecoModel.match(/motion: ([^\n]*)/)
const ecoKv = {}
if (ecoM) for (const kv of ecoM[1].split(' ')) { const i = kv.indexOf('='); if (i > 0) ecoKv[kv.slice(0, i)] = kv.slice(i + 1) }
const ecoAngles = (S0[0] && S1[0]) ? [0, 3].map((i) => estAngle(S0[i], S1[i]).ang) : []
check('E1 省电档（--fps saver）下渲染层留痕 per-lane 运动关闭（on=0 / eco=1）',
  !!ecoM && ecoKv.on === '0' && ecoKv.eco === '1', ecoModel.slice(0, 180))
check('E2 省电档下各车道的像素角位移**完全相同且等于基础角位移**' + SPIN + '°（= 改动前的整片刚性旋转）',
  ecoAngles.length === 2 && ecoAngles.every((a) => angDiff(a, SPIN) <= 6) && angDiff(ecoAngles[0], ecoAngles[1]) <= 4,
  ecoAngles.length ? ('实测 ' + ecoAngles.map((a, i) => 'lane' + [0, 3][i] + ' ' + a + '°').join('  ')) : '没有测到')

section(ok ? '粒子运动多样性：全部通过' : '粒子运动多样性：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
