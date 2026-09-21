#!/usr/bin/env node
/* shift.mjs —— 平移搜索：判断残余差异是不是整体/局部位移造成的
 * 用法: node shift.mjs <ref> <test> [threshold]
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const [ref, test, thrA] = process.argv.slice(2)
const thr = Number(thrA || 16)
const A = await sharp(ref).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const B = await sharp(test).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = A.info.width, H = A.info.height
for (let dy = -2; dy <= 2; dy++) {
  const out = []
  for (let dx = -2; dx <= 2; dx++) {
    let n = 0, tot = 0
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      const i = (y * W + x) * 4, j = ((y + dy) * W + (x + dx)) * 4
      const d = Math.max(Math.abs(A.data[i] - B.data[j]), Math.abs(A.data[i + 1] - B.data[j + 1]), Math.abs(A.data[i + 2] - B.data[j + 2]))
      tot++
      if (d > thr) n++
    }
    out.push(`${dx >= 0 ? ' ' : ''}${dx}:${(100 * n / tot).toFixed(3)}%`)
  }
  console.log('dy=' + (dy >= 0 ? ' ' : '') + dy + '  ' + out.join('  '))
}
