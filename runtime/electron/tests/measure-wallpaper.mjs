#!/usr/bin/env node
/* measure-wallpaper.mjs —— 量化「底板 vs 壁纸」的明度分离度（判断会不会糊在一起）
 * 用法: node measure-wallpaper.mjs "深色壁纸=<png>" "蓝调壁纸=<png>" "深海军蓝壁纸=<png>"
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

for (const arg of process.argv.slice(2)) {
  const [name, f] = arg.split('=')
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  /* 壁纸采样：窗口左侧空白带（x 8..46） */
  let r = 0, g = 0, b = 0, n = 0
  for (let y = 120; y < 300; y += 2) for (let x = 8; x < 46; x += 2) { const [R, G, B] = px(x, y); r += R; g += G; b += B; n++ }
  const wpL = L(r / n, g / n, b / n), wpRGB = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
  /* 底板采样：窗内左上角（避开文字与刻度） */
  let pr = 0, pg = 0, pb = 0, pn = 0
  for (let y = 30 + 185 + 6; y < 30 + 185 + 44; y += 2) for (let x = 60 + 20; x < 60 + 150; x += 2) {
    const [R, G, B] = px(x, y)
    if (R + G + B < 190) { pr += R; pg += G; pb += B; pn++ }
  }
  const plL = L(pr / pn, pg / pn, pb / pn), plRGB = [Math.round(pr / pn), Math.round(pg / pn), Math.round(pb / pn)]
  const ratio = (Math.max(wpL, plL) + 0.05) / (Math.min(wpL, plL) + 0.05)
  console.log(`${name.padEnd(14)} 壁纸 rgb(${wpRGB.join(',').padEnd(11)}) 亮度 ${wpL.toFixed(4)}  |  底板 rgb(${plRGB.join(',')}) 亮度 ${plL.toFixed(4)}  |  明度分离 ${ratio.toFixed(2)}:1  ${ratio >= 1.3 ? '✅ 分层清晰' : ratio >= 1.12 ? '⚠ 弱分离（靠 1px 淡蓝边框兜住）' : '❌ 会糊在一起'}`)
}
