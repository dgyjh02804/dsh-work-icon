#!/usr/bin/env node
/* measure-v3.mjs —— 验证 #02 的核验结论：**底板压得足够深 ⇒ 在浅壁纸上同样读得清**
 *  ① 同一块板在深/浅壁纸上的底板亮度差（越接近 0，说明背景越不参与）
 *  ② 板内文字与底板的 WCAG 对比度（主文 / 明细行分别给）
 * 用法: node measure-v3.mjs "a-dark=<png>" "a-light=<png>" ...
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const GEO = {     /* [桌面内窗口 left, top, 面板相对窗口的 top, 面板高, 面板宽] */
  a: [85, 30, 185, 200, 300],
  b: [85, 30, 185, 132, 300]
}
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const relLum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05) }

const out = {}
for (const arg of process.argv.slice(2)) {
  const [key, f] = arg.split('=')
  const [vk, dk] = key.split('-')
  const [wx, wy, ptop, ph, pw] = GEO[vk]
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  const lums = []
  let plateR = 0, plateG = 0, plateB = 0, plateN = 0
  const x0 = wx + 2, x1 = wx + pw - 2, y0 = wy + ptop + 2, y1 = wy + ptop + ph - 2
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [r, g, b] = px(x, y)
    lums.push(relLum(r, g, b))
    if (r + g + b < 120) { plateR += r; plateG += g; plateB += b; plateN++ }   /* 只统计"底板"像素 */
  }
  lums.sort((a, b) => a - b)
  const p = (q) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))]
  const bg = relLum(plateR / plateN, plateG / plateN, plateB / plateN)
  out[key] = { bg, bgRGB: [Math.round(plateR / plateN), Math.round(plateG / plateN), Math.round(plateB / plateN)],
    p50: p(0.5), p90: p(0.9), p99: p(0.99),
    cMain: contrast(p(0.99), bg), cDetail: contrast(p(0.9), bg), n: plateN }
}
console.log('\n=== 底板深度与文字对比度（WCAG） ===')
for (const [k, v] of Object.entries(out)) {
  console.log(`\n== ${k}`)
  console.log(`  底板平均 RGB = rgb(${v.bgRGB.join(',')})  相对亮度 = ${v.bg.toFixed(4)}`)
  console.log(`  亮度分位 p50=${v.p50.toFixed(4)} p90=${v.p90.toFixed(4)} p99=${v.p99.toFixed(4)}`)
  console.log(`  主文/金额 对比度 = ${v.cMain.toFixed(2)} : 1 ${v.cMain >= 7 ? '（AAA）' : v.cMain >= 4.5 ? '（AA ✓）' : '（不足 ❌）'}`)
  console.log(`  明细文字 对比度 = ${v.cDetail.toFixed(2)} : 1 ${v.cDetail >= 4.5 ? '（AA ✓）' : v.cDetail >= 3 ? '（大字号 AA / 小字偏弱）' : '（不足 ❌）'}`)
}
const need = ['a-dark', 'a-light', 'b-dark', 'b-light'].filter((k) => out[k])
for (const vk of ['a', 'b']) {
  if (out[`${vk}-dark`] && out[`${vk}-light`]) {
    const d = Math.abs(out[`${vk}-dark`].bg - out[`${vk}-light`].bg)
    const rgbD = out[`${vk}-dark`].bgRGB, rgbL = out[`${vk}-light`].bgRGB
    console.log(`\n★ 变体 ${vk.toUpperCase()}：深壁纸 vs 浅壁纸的底板亮度差 = ${d.toFixed(4)}（${(d * 255).toFixed(1)}/255）`)
    console.log(`   底板 RGB：深壁纸下 rgb(${rgbD.join(',')})  浅壁纸下 rgb(${rgbL.join(',')})`)
    console.log(`   → ${d < 0.002 ? '✅ 背景几乎不参与（底板足够深，#02 结论成立）' : '⚠ 背景有可见渗色'}`)
  }
}
