#!/usr/bin/env node
/* measure-overlap.mjs —— 最小尺寸「三个元素叠不叠得住」的像素实测
 * 做法：测试条里每档尺寸有 4 格（环 / 云 / 分形 / 三者叠加），各格背景一致。
 *   · 单元素墨量 inkO/inkN/inkF（与该格背景差异超阈值的像素数）
 *   · 叠加格墨量 inkALL
 *   · 重叠率 = (inkO+inkN+inkF-inkALL) / inkALL   ← 越高说明三者越"糊在一起"
 *   · 另有：云粒子平均间距（云元素内亮点的最近邻近似：按墨量/粒子数换算可分辨的像素预算）
 * 用法: node measure-overlap.mjs <combo.png>
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/david/.dsh/profiles/')
const sharp = require('sharp')

const f = process.argv[2]
const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] }

/* 测试条格子在页面顶部（.testwrap padding 10px 8px，格宽 = size+20 + 6 间隔） */
function cells (tag) {
  const R1 = [10, 170, 330, 490], R2 = [650, 720, 790, 860]
  const xs = tag === '140px' ? R1 : R2, size = tag === '140px' ? 140 : 46
  return ['ring', 'neb', 'fra', 'all'].map((w, i) => ({ tag, which: w, x0: xs[i], x1: xs[i] + size, y0: 24, y1: 24 + size }))
}/* 墨量：与格内最亮背景差 > 24 的像素数（背景=该格出现最多的亮度档） */
function ink (c) {
  const ls = []
  for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) { const p = px(x, y); ls.push(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) }
  ls.sort((a, b) => a - b)
  const bg = ls[Math.floor(ls.length * 0.4)]
  let n = 0
  for (const v of ls) if (Math.abs(v - bg) > 24) n++
  return n
}
const rows = [{ name: '140px（图标尺寸）', tag: '140px' }, { name: '46px（悬浮层尺寸）', tag: '46px' }]
console.log('\n===== 最小尺寸「三元素叠不叠得住」像素实测 =====')
for (const r of rows) {
  const cs = cells(r.tag)
  const m = {}
  for (const c of cs) m[c.which] = ink(c)
  const sum = m.ring + m.neb + m.fra
  const ov = ((sum - m.all) / Math.max(m.all, 1)) * 100
  console.log(`\n【${r.name}】`)
  console.log(`  单元素墨量  环=${m.ring}  云=${m.neb}  分形=${m.fra}   三者相加=${sum}`)
  console.log(`  三者叠加墨量=${m.all}   重叠率=${ov.toFixed(1)}%  ${ov > 45 ? '❌ 三者互相压住（糊）' : ov > 25 ? '⚠️ 有压叠但可分' : '✅ 基本不压叠'}`)
  console.log(`  可分辨性：分离度 = 叠加墨量 / 单元素最大墨量 = ${(m.all / Math.max(m.ring, m.neb, m.fra, 1)).toFixed(2)}×`)
}
console.log('\n说明：墨量=与格内背景差 >24 的像素数；重叠率越高 = 三个元素占同一批像素 = 越糊。')
