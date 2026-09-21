#!/usr/bin/env node
/* measure-v6.mjs —— ③-2 放大版：深蓝底在三种壁纸（深 / 浅 / 蓝调）下的底板与分区色对比度 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const GEO = { s360: [60, 30, 185, 280, 360], s440: [60, 30, 185, 340, 440] }
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const HEX = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const CRl = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

const res = {}
for (const arg of process.argv.slice(2)) {
  const [key, f] = arg.split('=')
  const [vk, dk] = key.split('-')
  const [wx, wy, ptop, ph, pw] = GEO[vk]
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  let r = 0, g = 0, b = 0, n = 0, hi = 0
  const x0 = wx + 4, x1 = wx + pw - 4, y0 = wy + ptop + 4, y1 = wy + ptop + ph - 4
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [R, G, B] = px(x, y)
    const l = L(R, G, B)
    if (R + G + B < 170) { r += R; g += G; b += B; n++ } else if (l > hi) hi = l
  }
  const plate = L(r / n, g / n, b / n)
  res[key] = { rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], plate, cMax: CRl(hi, plate) }
}
console.log('\n===== 深蓝底在各壁纸下的表现（像素实测）=====')
for (const vk of ['s360', 's440']) {
  const rows = ['dark', 'light', 'blue'].map((d) => [d, res[vk + '-' + d]]).filter(([, v]) => v)
  if (!rows.length) continue
  console.log(`\n== ${vk}`)
  for (const [d, v] of rows) console.log(`  ${d.padEnd(6)} 底板 rgb(${v.rgb.join(',')})  相对亮度 ${v.plate.toFixed(4)}  峰值文字对比度 ${v.cMax.toFixed(1)}:1`)
  if (res[vk + '-blue'] && res[vk + '-dark']) {
    const dL = Math.abs(res[vk + '-blue'].plate - res[vk + '-dark'].plate) * 255
    console.log(`  蓝调壁纸 vs 深色壁纸的底板亮度差 = ${dL.toFixed(1)}/255 ${dL < 8 ? '✅ 不融合（靠明度分离）' : '⚠ 有融合感'}`)
  }
}
/* 分区色在设计底板上的对比度（取底板渐变中值 #0f1c2c） */
const plateHex = '#101e2f'
console.log(`\n===== 五个分区色在深蓝底 ${plateHex} 上的对比度（设计色值精算）=====`)
const P = L(...HEX(plateHex))
for (const [n, h] of [['动作·青 #56d9c8', '#56d9c8'], ['花费·金 #ffc266', '#ffc266'], ['度量·淡蓝 #6fb6ff', '#6fb6ff'],
  ['任务·紫 #b79cff', '#b79cff'], ['思考·中性冷灰 #9fb0c4', '#9fb0c4'], ['主文·冷白 #e8f0fa', '#e8f0fa'],
  ['刻度线 #31536e（装饰）', '#31536e'], ['淡蓝边框 #4a7fa8（结构）', '#4a7fa8']]) {
  const c = CRl(L(...HEX(h)), P)
  console.log('  ' + n.padEnd(26) + c.toFixed(2).padStart(6) + ' : 1  ' + (c >= 4.5 ? 'AA ✓' : c >= 3 ? '（大字号/结构线）' : '（装饰）'))
}
