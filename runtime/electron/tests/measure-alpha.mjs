#!/usr/bin/env node
/* measure-alpha.mjs —— 底板不透明度三档 × 三种壁纸：底板平均 RGB + 主文/明细/微型标签对比度
 * 用法: node measure-alpha.mjs "0.96-dark=<png>" ... （key = <alpha>-<wallpaper>）
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const HEX = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const CR = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
/* 文本色（设计值） */
const TXT = { 主文: '#e8f0fa', 明细: '#98b0c6', 微标签: '#92aac0', 青: '#56d9c8', 金: '#ffc266', 蓝: '#6fb6ff', 紫: '#b79cff' }

const rows = []
for (const arg of process.argv.slice(2)) {
  const [key, f] = arg.split('=')
  const [alpha, wp] = key.split('-')
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  /* 底板采样：面板内左上角空白区（避开文字/刻度） */
  let r = 0, g = 0, b = 0, n = 0
  for (let y = 30 + 185 + 6; y < 30 + 185 + 44; y += 2) for (let x = 60 + 22; x < 60 + 150; x += 2) {
    const [R, G, B] = px(x, y)
    if (R + G + B < 260) { r += R; g += G; b += B; n++ }
  }
  const pr = r / n, pg = g / n, pb = b / n, plate = L(pr, pg, pb)
  const out = { alpha, wp, rgb: [Math.round(pr), Math.round(pg), Math.round(pb)], plate }
  for (const [k, h] of Object.entries(TXT)) out[k] = CR(L(...HEX(h)), plate)
  rows.push(out)
}
const pad = (s, n) => String(s).padEnd(n)
console.log('\n===== 底板不透明度 × 壁纸：底板 RGB 与文字对比度（像素实测）=====')
console.log(pad('α', 6) + pad('壁纸', 8) + pad('底板 RGB', 18) + pad('亮度', 9) + pad('主文', 8) + pad('明细', 8) + pad('微标签', 8) + '分区色(青/金/蓝/紫)')
for (const o of rows) {
  const mark = (v) => (v >= 4.5 ? '' : ' ❌')
  console.log(pad(o.alpha, 6) + pad(o.wp, 8) + pad(`rgb(${o.rgb.join(',')})`, 18) + pad(o.plate.toFixed(4), 9) +
    pad(o.主文.toFixed(1) + mark(o.主文), 8) + pad(o.明细.toFixed(1) + mark(o.明细), 8) + pad(o.微标签.toFixed(1) + mark(o.微标签), 8) +
    [o.青, o.金, o.蓝, o.紫].map((v) => v.toFixed(1) + mark(v)).join(' / '))
}
console.log('\n（❌ = 低于 4.5:1 的 WCAG AA 门槛）')
