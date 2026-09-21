#!/usr/bin/env node
/* measure-hover.mjs —— 悬浮层（无底板）在三种壁纸下的可读性实测
 * 做法：在对照页里，每个组合取"文字带"与"其邻近背景"两组像素，算 WCAG 对比度。
 *   · 文字亮部 = 文字带内亮度 p99
 *   · 背景 = 文字带内亮度中位数（无暗雾时它=壁纸；有暗雾/halo 时它=被压暗后的底）
 * 用法: node measure-hover.mjs <hover-legibility.png>
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const CELLS = [   /* 9 格 = 3 壁纸 × 3 补偿，2 列排布（列 x=0/590，行高 150，格子内 hover 盒在 +24,+36） */
  ['dark  壁纸 + A 仅 halo', 24, 36, 314, 132],
  ['dark  壁纸 + B halo+暗雾', 614, 36, 904, 132],
  ['dark  壁纸 + C 描边字', 24, 186, 314, 282],
  ['light 壁纸 + A 仅 halo', 614, 186, 904, 282],
  ['light 壁纸 + B halo+暗雾', 24, 336, 314, 432],
  ['light 壁纸 + C 描边字', 614, 336, 904, 432],
  ['blue  壁纸 + A 仅 halo', 24, 486, 314, 582],
  ['blue  壁纸 + B halo+暗雾', 614, 486, 904, 582],
  ['blue  壁纸 + C 描边字', 24, 636, 314, 732]
]
const _unused = [
  ['dark 壁纸 + A 仅 halo', 24, 36, 314, 118],
  ['dark 壁纸 + B halo+暗雾', 24, 186, 314, 268],
  ['light 壁纸 + A 仅 halo', 614, 36, 904, 118],
  ['light 壁纸 + B halo+暗雾', 614, 186, 904, 268],
  ['blue 壁纸 + A 仅 halo', 24, 336, 314, 418],
  ['blue 壁纸 + B halo+暗雾', 614, 336, 904, 418]
]
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const CR = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

const f = process.argv[2]
const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }

console.log('\n===== 悬浮层（无底板）在三种壁纸下的可读性（像素实测，WCAG）=====')
console.log('组合'.padEnd(26) + '文字亮部'.padEnd(12) + '背景(中位)'.padEnd(12) + '对比度')
for (const [name, x0, y0, x1, y1] of CELLS) {
  const ls = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ls.push(L(...px(x, y)))
  ls.sort((a, b) => a - b)
  const bg = ls[Math.floor(ls.length * 0.5)]        /* 局部背景（含 halo / 暗雾后的实际底色） */
  const bgWorst = ls[Math.floor(ls.length * 0.12)]  /* 最暗的局部背景（最坏情况） */
  const tx = ls[Math.floor(ls.length * 0.995)]      /* 文字亮部 */
  const c = CR(tx, bgWorst)
  console.log(name.padEnd(26) + tx.toFixed(4).padEnd(12) + (bg.toFixed(4) + '/' + bgWorst.toFixed(4)).padEnd(16) + c.toFixed(2) + ':1  ' + (c >= 7 ? 'AAA ✓' : c >= 4.5 ? 'AA ✓' : '❌ 低于 4.5'))
}
console.log('\n说明：本页两行的差别只有"有没有那层极淡暗雾(rgba(6,12,20,.34))"；')
console.log('      halo 是暗色投影（把背景压暗），不是发光 —— 发光仍是红线。')
