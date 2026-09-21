#!/usr/bin/env node
/* measure-mocks.mjs —— 用像素统计客观核对三张设计稿的几何（不依赖目测）
 * 输出：图标包围盒 / 面板包围盒 / 两者水平中心差 / 图标下缘到面板上缘的间距 / 面板内文字行带
 */
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const files = process.argv.slice(2)
for (const f of files) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  const lum = (x, y) => { const [r, g, b] = px(x, y); return 0.2126 * r + 0.7152 * g + 0.0722 * b }

  /* 图标：找"亮青色"像素（g 明显高于 r 且足够亮） */
  let iMinX = 1e9, iMaxX = -1, iMinY = 1e9, iMaxY = -1
  for (let y = 80; y < 245; y++) for (let x = 100; x < Math.min(W, 360); x++) {   /* 只扫图标所在的 210×210 区域，避免面板里的青色数字被误判成图标 */
    const [r, g, b] = px(x, y)
    if (g > 120 && g - r > 42 && g >= b) { if (x < iMinX) iMinX = x; if (x > iMaxX) iMaxX = x; if (y < iMinY) iMinY = y; if (y > iMaxY) iMaxY = y }
  }
  /* 面板：在图标下方区域找"与桌面底色差异大"的连续块（暗板或亮板都吃） */
  const bgSample = lum(30, 300)
  let pMinX = 1e9, pMaxX = -1, pMinY = 1e9, pMaxY = -1, rows = 0
  for (let y = 250; y < Math.min(H, 520); y++) {
    let cnt = 0
    for (let x = 80; x < Math.min(W, 380); x++) { if (Math.abs(lum(x, y) - bgSample) > 12) cnt++ }
    if (cnt > 60) {
      if (y < pMinY) pMinY = y
      if (y > pMaxY) pMaxY = y
      for (let x = 80; x < Math.min(W, 380); x++) if (Math.abs(lum(x, y) - bgSample) > 12) { if (x < pMinX) pMinX = x; if (x > pMaxX) pMaxX = x }
      rows++
    }
  }
  /* 面板内文字行带：面板区域内亮度显著高于/低于板底的像素行 */
  const bands = []
  if (pMinY < pMaxY) {
    const plateLum = lum(pMinX + 4, pMinY + Math.round((pMaxY - pMinY) / 2))
    let run = null
    for (let y = pMinY; y <= pMaxY; y++) {
      let ink = 0
      for (let x = pMinX + 3; x <= pMaxX - 3; x++) if (Math.abs(lum(x, y) - plateLum) > 26) ink++
      if (ink > 3) { if (!run) run = [y, y]; else run[1] = y } else if (run) { if (run[1] - run[0] >= 4) bands.push(run); run = null }
    }
    if (run && run[1] - run[0] >= 4) bands.push(run)
  }
  const iCx = (iMinX + iMaxX) / 2, pCx = (pMinX + pMaxX) / 2
  console.log('\n== ' + path.basename(f))
  console.log(`  图标包围盒 x[${iMinX},${iMaxX}] y[${iMinY},${iMaxY}]  直径=${iMaxX - iMinX}  中心x=${iCx}`)
  console.log(`  面板包围盒 x[${pMinX},${pMaxX}] y[${pMinY},${pMaxY}]  宽=${pMaxX - pMinX}  高=${pMaxY - pMinY}  中心x=${pCx}`)
  console.log(`  水平中心差 = ${Math.abs(iCx - pCx)} px（应当 ≈0）`)
  console.log(`  图标下缘→面板上缘间距 = ${pMinY - iMaxY} px（设计值 10）`)
  console.log(`  面板内文字行带 ${bands.length} 条：` + bands.map((b) => `[${b[0]}-${b[1]}]h${b[1] - b[0] + 1}`).join(' '))
}
