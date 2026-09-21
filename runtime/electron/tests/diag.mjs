#!/usr/bin/env node
/* diag.mjs —— 临时诊断：把参考图与待测图在若干区域上的统计量并排打印 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const [ref, test] = process.argv.slice(2)
async function raw (f) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, W: info.width, H: info.height }
}
const A = await raw(ref), B = await raw(test)
const box = (im, x0, y0, x1, y1) => {
  let r = 0, g = 0, b = 0, a = 0, n = 0, mx = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * im.W + x) * 4
    r += im.data[i]; g += im.data[i + 1]; b += im.data[i + 2]; a += im.data[i + 3]; n++
    mx = Math.max(mx, im.data[i], im.data[i + 1], im.data[i + 2])
  }
  return `mean=(${(r / n).toFixed(1)},${(g / n).toFixed(1)},${(b / n).toFixed(1)}) a=${(a / n).toFixed(1)} max=${mx}`
}
const C = 240
const regions = [
  ['center 20x20', C - 10, C - 10, C + 10, C + 10],
  ['glow disc r44', C - 88, C - 88, C + 88, C + 88],
  ['ring r60 band', C - 150, C - 150, C + 150, C + 150],
  ['core triangle', 74 * 2.4, 70 * 2.4, 126 * 2.4, 116 * 2.4],
  ['full', 0, 0, 480, 480],
  ['corner', 0, 0, 40, 40],
  ['particle ring', C - 210, C - 210, C + 210, C + 210]
]
for (const [name, x0, y0, x1, y1] of regions) {
  const a = box(A, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1))
  const b = box(B, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1))
  console.log(name.padEnd(16) + '\n  ref  ' + a + '\n  test ' + b)
}
