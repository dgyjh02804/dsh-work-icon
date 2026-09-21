#!/usr/bin/env node
/* panel-contrast.mjs —— 每个可见小字的**实测 WCAG 比值**（自写 PNG 解码取背景，不依赖任何 vision 工具）
 * 用法: node tests/panel-contrast.mjs <main.log> <shot.png> [tag]
 * 做法: ① 解 PNG ② 黑板区域内取众数色当实测背景 ③ 解析 panel blocks(tag) 里每个块的**计算色+字号**
 *        ④ 按 WCAG 2.x 计算比值；字号 <18px 用 4.5 门槛，≥18px 用 3.0 ⑤ 不达标的列出来并非零退出 */
import fs from 'node:fs'
import zlib from 'node:zlib'

function decodePNG (buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]
    const cur = raw.slice(p, p + stride); p += stride
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const line = out.slice(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = cur[x]
      line[x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + (Math.abs(b - c) >= Math.abs(a - b) ? a : b)) & 0xff
    }
  }
  return { w, h, bpp, px: out }
}
const rgbOf = (css) => { const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null }
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const ratio = (fg, bg) => { const A = lum(fg), B = lum(bg); const hi = Math.max(A, B), lo = Math.min(A, B); return (hi + 0.05) / (lo + 0.05) }

const [logFile, png, tag = 'after-v2'] = process.argv.slice(2)
if (!logFile || !png) { console.error('用法: node panel-contrast.mjs <log> <png> [tag]'); process.exit(2) }
const log = fs.readFileSync(logFile, 'utf8')
const line = (log.match(new RegExp('panel blocks\\(' + tag + '\\): [^\\n]*')) || [''])[0]
const plateM = (log.match(new RegExp('panel plate\\(' + tag + '\\): ([\\d,]+) dpr=([\\d.]+)')) || [])
const plate = plateM[1]
const dpr = Number(plateM[2] || 2)
if (!line) { console.error('❌ 日志里没有 panel blocks(' + tag + ')'); process.exit(2) }

const img = decodePNG(fs.readFileSync(png))
/* 实测背景：黑板矩形区域内取众数色（每 3px 采样） */
let box = null
if (plate) { const [x, y, w, h] = plate.split(',').map(Number); if (w >= 8 && h >= 8) box = { x: x * dpr, y: y * dpr, w: w * dpr, h: h * dpr } }
/* 黑板 0×0（悬浮层模式）⇒ 退到整图采样：这也是"判据量错容器"的同一个坑 */
const tally = new Map()
const X0 = box ? Math.max(0, Math.floor(box.x + 4)) : 0, Y0 = box ? Math.max(0, Math.floor(box.y + 4)) : 0
const X1 = box ? Math.min(img.w, Math.ceil(box.x + box.w - 4)) : img.w, Y1 = box ? Math.min(img.h, Math.ceil(box.y + box.h - 4)) : img.h
for (let y = Y0; y < Y1; y += 3) for (let x = X0; x < X1; x += 3) {
  const i = y * img.w * img.bpp + x * img.bpp
  const k = (img.px[i] >> 3) + ',' + (img.px[i + 1] >> 3) + ',' + (img.px[i + 2] >> 3)
  tally.set(k, (tally.get(k) || 0) + 1)
}
const bg = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map((v) => Number(v) * 8 + 4)
console.log('实测背景（黑板区域内众数色）= rgb(' + bg.join(',') + ')   采样 ' + [...tally.values()].reduce((a, b) => a + b, 0) + ' 点')

/* 显式白名单（只放"结构装饰"），每条都给理由：
   '└' / '│'  —— 树形缩进引导符，属结构装饰而不是正文；它们不承载信息，读不到不影响理解。 */
const WHITELIST = ['└', '│', '├']
const blocks = line.replace(/^panel blocks\([^)]*\): /, '').split(' ; ').filter(Boolean)
const fails = []
console.log('\n每个可见文本块的实测对比度（小字 <18px 门槛 4.5；≥18px 门槛 3.0）：')
for (const b of blocks) {
  const parts = b.split('|')
  if (parts.length < 7) continue
  const txt = parts[0]
  const meta = parts.slice(1)
  /* 背景 = **该文字矩形内真实渲染像素的众数色**（合成后；不是底板理论色） */
  var bx = 0, by = 0, bw = 0, bh = 0
  { const X = Math.round(Number(parts[1]) * (dpr || 1)), Y = Math.round(Number(parts[2]) * (dpr || 1)); bw = Math.round(Number(parts[3]) * (dpr || 1)); bh = Math.round(Number(parts[4]) * (dpr || 1)); bx = Math.max(0, X); by = Math.max(0, Y) }
  var localBg = bg
  if (bw > 4 && bh > 4) {
    const tl = new Map()
    for (let yy = by; yy < Math.min(img.h, by + bh); yy += 1) for (let xx = bx; xx < Math.min(img.w, bx + bw); xx += 1) {
      const ii = yy * img.w * img.bpp + xx * img.bpp
      const kk = (img.px[ii] >> 2) + ',' + (img.px[ii + 1] >> 2) + ',' + (img.px[ii + 2] >> 2)
      tl.set(kk, (tl.get(kk) || 0) + 1)
    }
    if (tl.size) localBg = [...tl.entries()].sort((p, q) => q[1] - p[1])[0][0].split(',').map((v) => Number(v) * 4 + 2)
  }
  const color = rgbOf(meta[4] || '')
  const size = parseFloat(meta[5] || '10')
  if (!color) continue
  const r = ratio(color, localBg)
  const need = size >= 18 ? 3.0 : 4.5
  const ok = r >= need
  if (!ok && !WHITELIST.includes(txt.trim())) fails.push(txt + ' ' + r.toFixed(2) + ':1 (需 ' + need + ')')
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + txt.padEnd(16) + r.toFixed(2) + ':1  ' + size + 'px  ' + (meta[4] || ''))
}
/* 硬规则：0 块 = 什么都没测 ⇒ 必须 FAIL（"0 块 ⇒ 全部达标"是典型的假安全） */
if (blocks.length === 0) { console.log('\n结论：✗ FAIL —— 解析到 0 个文本块，等于什么都没测（不许当作通过）'); process.exit(1) }
console.log('\n结论：' + (fails.length ? '✗ 不达标 ' + fails.length + ' 处 → ' + fails.join(' | ') : '✓ 全部达标（' + blocks.length + ' 块）'))
process.exit(fails.length ? 1 : 0)
