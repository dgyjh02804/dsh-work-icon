#!/usr/bin/env node
/* measure-v4.mjs —— 六版在**深/浅壁纸**下的底板深度与文字对比度（像素实测 + 设计色值精算）
 * 用法: node measure-v4.mjs "d1-dark=<png>" "d1-light=<png>" ...
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const GEO = { c1: [90, 30, 185, 196, 320], c2: [90, 30, 185, 202, 320], c3: [90, 30, 185, 196, 300] }
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const HEX = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const relLum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const CR = (a, b) => { const x = relLum(...HEX(a)), y = relLum(...HEX(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

const res = {}
for (const arg of process.argv.slice(2)) {
  const [key, f] = arg.split('=')
  const [vk, dk] = key.split('-')
  const [wx, wy, ptop, ph, pw] = GEO[vk]
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  let r = 0, g = 0, b = 0, n = 0, bright = []
  const x0 = wx + 3, x1 = wx + pw - 3, y0 = wy + ptop + 3, y1 = wy + ptop + ph - 3
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [R, G, B] = px(x, y)
    if (R + G + B < 132) { r += R; g += G; b += B; n++ }          /* 底板像素 */
    else bright.push(relLum(R, G, B))                              /* 文字/线条像素 */
  }
  bright.sort((a, b) => a - b)
  const plate = relLum(r / n, g / n, b / n)
  const p95 = bright[Math.floor(0.95 * bright.length)] || 0
  const p99 = bright[Math.floor(0.99 * bright.length)] || 0
  res[key] = { rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], plate, c95: (Math.max(p95, plate) + 0.05) / (Math.min(p95, plate) + 0.05), c99: (Math.max(p99, plate) + 0.05) / (Math.min(p99, plate) + 0.05) }
}

console.log('\n===== 底板深度与对比度（像素实测）=====')
for (const vk of ['c1', 'c2', 'c3']) {
  const d = res[vk + '-dark'], l = res[vk + '-light']
  if (!d || !l) continue
  const bleed = Math.abs(d.plate - l.plate) * 255
  const drgb = d.rgb, lrgb = l.rgb
  console.log(`\n== ${vk}`)
  console.log(`  底板 RGB：深壁纸 rgb(${drgb.join(',')})   浅壁纸 rgb(${lrgb.join(',')})`)
  console.log(`  底板亮度 深 ${d.plate.toFixed(4)} / 浅 ${l.plate.toFixed(4)}   渗色 = ${bleed.toFixed(1)}/255 ${bleed < 8 ? '✅ 背景几乎不参与' : '⚠ 可见渗色'}`)
  console.log(`  文字对比度（实测）：深 ${d.c95.toFixed(1)}:1 / 浅 ${l.c95.toFixed(1)}:1（p95）  峰值 ${d.c99.toFixed(1)}:1（p99）`)
}

const plate = '#101415'
console.log('\n===== 设计色值精算（底板 ' + plate + '，与壁纸无关，因为底板≈不透明）=====')
for (const [n, h] of [['金额/焦点 #f4f8f8', '#f4f8f8'], ['主文/标题 #eaf1f1', '#eaf1f1'], ['思考正文 #cfd9d9', '#cfd9d9'], ['任务文本 #cbd5d5', '#cbd5d5'], ['明细行 #8b9a9b', '#8b9a9b'], ['微型标签 #7e8e8f', '#7e8e8f'], ['序号列 #71807f', '#71807f'], ['强调青 #5fd8c4', '#5fd8c4'], ['琥珀 #ffb257', '#ffb257'], ['冷蓝 #7fd8ff', '#7fd8ff'], ['紫 #b79cff', '#b79cff'], ['刻度线 #2f3a3b（装饰）', '#2f3a3b']]) {
  const c = CR(h, plate)
  console.log('  ' + n.padEnd(24) + c.toFixed(2).padStart(6) + ' : 1  ' + (c >= 4.5 ? 'AA ✓' : c >= 3 ? '（大字号才够）' : '（装饰）'))
}
