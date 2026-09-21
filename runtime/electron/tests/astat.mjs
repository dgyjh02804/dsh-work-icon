#!/usr/bin/env node
/* astat.mjs —— 打印图片的 alpha/RGB 分布，用于诊断透明底比对 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const hist = new Array(5).fill(0)
  let sum = 0
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3]
    sum += a
    if (a === 0) hist[0]++
    else if (a < 64) hist[1]++
    else if (a < 192) hist[2]++
    else if (a < 255) hist[3]++
    else hist[4]++
  }
  const px = (x, y) => { const i = (y * info.width + x) * 4; return `(${data[i]},${data[i + 1]},${data[i + 2]},a${data[i + 3]})` }
  console.log(f.split(/[\\/]/).pop())
  console.log(`  ${info.width}x${info.height} channels=${info.channels} hasAlpha=${info.hasAlpha} meanAlpha=${(sum / n).toFixed(1)}`)
  console.log(`  a=0:${hist[0]} 1-63:${hist[1]} 64-191:${hist[2]} 192-254:${hist[3]} a=255:${hist[4]}`)
  console.log(`  角(2,2)=${px(2, 2)} 中心(240,240)=${px(240, 240)} 图标边缘(240,30)=${px(240, 30)} 中环(240,120)=${px(240, 120)}`)
}
