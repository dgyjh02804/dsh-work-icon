#!/usr/bin/env node
/* measure-v2.mjs —— 第二批设计稿的客观核对：图标与面板是否同轴、内容是否溢出、文字行带是否互相压住 */
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const SPEC = {   /* [窗口宽, 窗口高, 窗口在桌面里的 left, top, 图标 left(窗内), 图标 top(窗内)] */
  orbit: [320, 300, 100, 40, 90, 35],
  schematic: [300, 300, 110, 40, 80, 8],
  holo: [320, 340, 100, 26, 90, 0],
  plasma: [300, 320, 100, 30, 80, 14]
}

for (const arg of process.argv.slice(2)) {
  const [key, f] = arg.split('=')
  const s = SPEC[key]
  if (!s) { console.log('未知方向: ' + key); continue }
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  const lum = (x, y) => { const [r, g, b] = px(x, y); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const bg = (() => {   /* 桌面底色：取窗口左侧的空白处 */
    let n = 0, sum = 0
    for (let y = 60; y < 240; y += 7) for (let x = 8; x < s[2] - 14; x += 5) { sum += lum(x, y); n++ }
    return sum / n
  })()
  const ink = (x, y) => Math.abs(lum(x, y) - bg) > 14

  /* 图标中心 x：窗口内 iconLeft + 70 */
  const iconCx = s[2] + s[4] + 70
  /* 面板墨迹的水平范围（图标下方区域） */
  const y0 = s[3] + s[5] + 140 + 2
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1
  for (let y = y0; y < Math.min(H, s[3] + s[1]); y++) for (let x = s[2]; x < s[2] + s[0]; x++) {
    if (ink(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  /* 行带（面板区域内逐行墨量） */
  const bands = []
  let run = null
  for (let y = y0; y < Math.min(H, s[3] + s[1]); y++) {
    let c = 0
    for (let x = s[2]; x < s[2] + s[0]; x++) if (ink(x, y)) c++
    if (c > 2) { if (!run) run = [y, y]; else run[1] = y } else if (run) { if (run[1] - run[0] >= 2) bands.push(run); run = null }
  }
  if (run && run[1] - run[0] >= 2) bands.push(run)
  const cxPanel = (minX + maxX) / 2
  console.log('\n== ' + key + '  (' + path.basename(f) + ')')
  console.log(`  窗口 ${s[0]}×${s[1]} @桌面(${s[2]},${s[3]})  图标中心 x=${iconCx}`)
  console.log(`  面板墨迹 x[${minX},${maxX}] y[${minY},${maxY}]  → 面板中心 x=${cxPanel}，与图标中心差 ${Math.abs(cxPanel - iconCx)} px`)
  console.log(`  面板墨迹是否越出窗口左右边界: ${minX < s[2] || maxX > s[2] + s[0] - 1 ? '❌ 越界' : '✓ 在窗口内'}`)
  const gaps = bands.slice(1).map((b, i) => b[0] - bands[i][1] - 1)
  console.log(`  行带 ${bands.length} 条：` + bands.map((b) => `[${b[0]}-${b[1]}]`).join(' '))
  console.log(`  带间空隙：${gaps.join(', ')} px ${gaps.some((g) => g < 0) ? '❌ 有重叠' : (gaps.some((g) => g === 0) ? '⚠ 有相接' : '✓ 无重叠')}`)
}
