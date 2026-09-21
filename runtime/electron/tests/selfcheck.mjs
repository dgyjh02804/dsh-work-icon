#!/usr/bin/env node
/* selfcheck.mjs —— 透明底自洽性检验
 * 把 alpha 图按「预乘」合成到 #111111 上，与同状态的 dark 图比：
 * 若两张图是同一帧的两种底，合成结果应当与 dark 图几乎完全一致。
 * 用法: node selfcheck.mjs <alpha.png> <dark.png> [label]
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
const [af, df, label = ''] = process.argv.slice(2)
const A = await sharp(af).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const D = await sharp(df).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
if (A.info.width !== D.info.width) { console.log('尺寸不一致，跳过'); process.exit(2) }
const n = A.info.width * A.info.height
let over = 0, under = 0, sum = 0, max = 0, alphaLeak = 0
for (let p = 0; p < n; p++) {
  const i = p * 4
  const a = A.data[i + 3] / 255
  for (let c = 0; c < 3; c++) {
    const comp = A.data[i + c] * a + 17 * (1 - a)     // 预乘合成到 #111111
    const d = Math.abs(comp - D.data[i + c])
    sum += d
    if (d > max) max = d
    if (d > 16) over++
    const comp2 = A.data[i + c] + 17 * (1 - a)        // 非预乘（直存）合成
    if (Math.abs(comp2 - D.data[i + c]) > 16) under++
  }
}
console.log(`${label.padEnd(14)} 像素差>16 的比例: 预乘解释 ${(100 * over / (n * 3)).toFixed(3)}%   直存解释 ${(100 * under / (n * 3)).toFixed(3)}%   平均差 ${(sum / (n * 3)).toFixed(2)}  最大 ${max}`)
