#!/usr/bin/env node
/* dmap.mjs —— 打印差异像素的空间分布（ASCII 图），定位残余差异来源 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const [ref, test, thrArg] = process.argv.slice(2)
const thr = Number(thrArg || 16)
async function raw (f) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, W: info.width, H: info.height }
}
const A = await raw(ref), B = await raw(test)
const N = 32, cell = A.W / N
const grid = Array.from({ length: N }, () => new Array(N).fill(0))
let total = 0
let maxd = 0, maxAt = null
for (let y = 0; y < A.H; y++) for (let x = 0; x < A.W; x++) {
  const i = (y * A.W + x) * 4
  let d = 0
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] - B.data[i + c]))
  if (d > maxd) { maxd = d; maxAt = [x, y] }
  if (d > thr) { grid[Math.floor(y / cell)][Math.floor(x / cell)]++; total++ }
}
console.log(`阈值 ${thr}  差异像素 ${total}/${A.W * A.H} = ${(100 * total / (A.W * A.H)).toFixed(3)}%  最大单通道差 ${maxd} @ ${maxAt}`)
const chars = ' .:-=+*#%@'
const perCell = cell * cell
for (const row of grid) {
  console.log(row.map((v) => chars[Math.min(9, Math.floor(10 * v / perCell))]).join(''))
}
/* 按到圆心距离统计 */
const cx = A.W / 2, cy = A.H / 2
const buckets = new Array(12).fill(0)
const bucketAll = new Array(12).fill(0)
for (let y = 0; y < A.H; y++) for (let x = 0; x < A.W; x++) {
  const i = (y * A.W + x) * 4
  const bk = Math.min(11, Math.floor(Math.hypot(x - cx, y - cy) / 20))
  bucketAll[bk]++
  let d = 0
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] - B.data[i + c]))
  if (d > thr) buckets[bk]++
}
console.log('半径桶 差异/总数 (每桶 20 物理像素 = 8.3 CSS px):')
for (let i = 0; i < 12; i++) {
  if (!bucketAll[i]) continue
  console.log(`  ${i * 20}-${i * 20 + 20}px  ${buckets[i]}/${bucketAll[i]} = ${(100 * buckets[i] / bucketAll[i]).toFixed(3)}%`)
}
