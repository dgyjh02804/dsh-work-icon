#!/usr/bin/env node
/* selftest.mjs —— 自证像素比对工具真的有效
 *
 * 用例:
 *   1. 同图自比                -> 差异应 ≈ 0%
 *   2. 异状态（WORK vs WAIT）  -> 差异应显著
 *   3. 尺寸不同（96px vs 240px）-> 自动缩放 + 明确提示
 *   4. 人为涂改（左上区域涂红）-> 差异应集中在那一块，"最大差异区域"定位要对
 *   5. 不存在的文件            -> 优雅报错、退出码 2、无堆栈
 *   6. 损坏的图片              -> 优雅报错、退出码 2、无堆栈
 *   7. 真·CLI 子进程退出码     -> 0 通过 / 1 超阈值 / 2 输入错误
 *
 * 用法: node selftest.mjs
 * 退出码: 0 全部通过；1 有用例失败
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { compareImages, writeHeatmap, CompareError, DEFAULT_THRESHOLD } from './compare-lib.mjs'
import { render, closeAll, sharp, isHeadless } from './h2render.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REFS = path.join(__dirname, 'refs')
const TMP = path.join(__dirname, 'tmp')
fs.mkdirSync(TMP, { recursive: true })

const pct = v => (100 * v).toFixed(3) + '%'
let pass = 0, fail = 0
const fails = []

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  [PASS] ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? '  ' + detail : ''}`) }
}

const A = p => path.join(REFS, p)
const T = p => path.join(TMP, p)

console.log('== H2 黄金样本 · compare.mjs 自证 ==')
console.log(`参考图目录: ${REFS}`)
console.log(`临时目录  : ${TMP}`)
console.log('')

/* ---------- 用例 1：同图自比 ---------- */
console.log('用例 1  同一张参考图 vs 自己（ref-WORK-240-dark.png）')
{
  const r = await compareImages(A('ref-WORK-240-dark.png'), A('ref-WORK-240-dark.png'))
  ok('差异占比 ≈ 0%', r.diffRatio === 0, `差异占比=${pct(r.diffRatio)} 差异像素=${r.diffPixels}/${r.totalPixels} 平均通道误差=${r.meanChannelError.toFixed(4)}`)
}

/* ---------- 用例 2：异状态 ---------- */
console.log('')
console.log('用例 2  异状态比对（WORK vs WAIT，同为 240px 深底）')
{
  const r = await compareImages(A('ref-WORK-240-dark.png'), A('ref-WAIT-240-dark.png'))
  await writeHeatmap(r, T('diff-WORK-vs-WAIT.png'))
  ok('差异显著 > 2%', r.diffRatio > 0.02, `差异占比=${pct(r.diffRatio)} 平均通道误差=${r.meanChannelError.toFixed(3)} 最大单点差=${r.worstPixel ? r.worstPixel.cd : '-'}`)
  console.log(`         最差区域: ${r.worstCells.map(c => c.grid + '(' + c.pixels + 'px)').join(' ')}`)
}
{
  const r = await compareImages(A('ref-WORK-240-dark.png'), A('ref-IDLE-240-dark.png'))
  ok('WORK vs IDLE 也应显著', r.diffRatio > 0.02, `差异占比=${pct(r.diffRatio)}`)
}

/* ---------- 用例 3：尺寸不同 -> 自动缩放 ---------- */
console.log('')
console.log('用例 3  尺寸不同（参考 240px/480 物理 vs 待测 96px/192 物理）')
{
  const r = await compareImages(A('ref-WORK-240-dark.png'), A('ref-WORK-96-dark.png'))
  await writeHeatmap(r, T('diff-240-vs-96.png'))
  ok('自动缩放已生效并提示', !!r.resized && r.warnings.some(w => w.includes('尺寸不一致')),
    `resized=${JSON.stringify(r.resized)}`)
  ok('缩放后仍有可判定数字', Number.isFinite(r.diffRatio), `差异占比=${pct(r.diffRatio)} 平均通道误差=${r.meanChannelError.toFixed(3)}`)
  console.log(`         提示原文: ${r.warnings.find(w => w.includes('尺寸不一致'))}`)
}

/* ---------- 用例 4：人为涂改，验证"最大差异区域"定位 ---------- */
console.log('')
console.log('用例 4  人为涂改定位（在 WORK 参考图左上 480px 物理坐标区涂红）')
const BOX = { left: 24, top: 24, width: 84, height: 60 }   // 故意不落在 8x8 网格线的正中间
{
  const src = A('ref-WORK-240-dark.png')
  const dst = T('tampered-WORK.png')
  const marker = await sharp({ create: { width: BOX.width, height: BOX.height, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer()
  await sharp(src).composite([{ input: marker, left: BOX.left, top: BOX.top }]).png().toFile(dst)

  const r = await compareImages(src, dst)
  await writeHeatmap(r, T('diff-tampered.png'))

  const W = r.ref.width, H = r.ref.height
  const expectedPx = BOX.width * BOX.height
  const expectedRatio = expectedPx / (W * H)
  // 涂改区覆盖到的 8x8 网格块
  const gi = (v, n) => Math.min(7, Math.floor(v * 8 / n))
  const cover = new Set()
  for (let y = BOX.top; y < BOX.top + BOX.height; y++) for (let x = BOX.left; x < BOX.left + BOX.width; x++) cover.add(gi(y, H) + ',' + gi(x, W))

  const topCells = r.worstCells
  const topAllInBox = topCells.every(c => cover.has(c.grid.slice(1, -1)))
  const boxPixels = topCells.reduce((s, c) => s + c.pixels, 0)
  ok('涂改被检出且占比接近涂改面积', Math.abs(r.diffRatio - expectedRatio) < 0.35 * expectedRatio,
    `差异占比=${pct(r.diffRatio)} 期望≈${pct(expectedRatio)}（${expectedPx}px/${W * H}px）`)
  ok('前 3 大差异块全部落在涂改区内', topAllInBox,
    `覆盖块=${[...cover].map(s => '[' + s + ']').join(' ')} 实际前3=${topCells.map(c => c.grid).join(' ')}`)
  ok('前 3 大差异块包含涂改区像素量的 ≥ 70%', boxPixels >= 0.7 * r.diffPixels,
    `前3块差异量=${boxPixels} 全图差异量=${r.diffPixels}`)
  console.log(`         涂改框(物理像素): x[${BOX.left},${BOX.left + BOX.width}) y[${BOX.top},${BOX.top + BOX.height})`)
  r.worstCells.forEach((c, i) => console.log(`         最差#${i + 1} ${c.grid} x[${c.x1},${c.x2}) y[${c.y1},${c.y2}) 差异${c.pixels}px 占比${(100 * c.ratio).toFixed(1)}%`))
  ok('热力图已写盘', fs.existsSync(T('diff-tampered.png')), T('diff-tampered.png'))
}

/* ---------- 用例 4b：确定性 —— 重跑同一参数必须得到同一张图 ---------- */
console.log('')
console.log('用例 4b 渲染确定性（同参数重渲 vs 已落盘参考图，t=0 冻结相位）')
{
  const r = await render({ state: 'WORK', size: 240, bg: 'dark', t: 0, dsf: 2 })
  fs.writeFileSync(T('rerun-WORK-240-dark.png'), r.buffer)
  const c = await compareImages(A('ref-WORK-240-dark.png'), T('rerun-WORK-240-dark.png'))
  ok('重渲帧与黄金样本 0 像素差', c.diffPixels === 0 && c.meanChannelError === 0,
    `差异占比=${pct(c.diffRatio)} 平均通道误差=${c.meanChannelError.toFixed(4)}`)
}

/* ---------- 用例 4c：--alpha 模式（参考图有透明区时必须只比不透明区） ---------- */
console.log('')
console.log('用例 4c  --alpha 模式语义（合成 100x100：透明画布 + 中心 40x40 色块）')
{
  const W = 100, H = 100, BOX = 40, x0 = 30, y0 = 30
  function canvas(r, g, b) {
    const buf = Buffer.alloc(W * H * 4)
    for (let y = y0; y < y0 + BOX; y++) for (let x = x0; x < x0 + BOX; x++) {
      const i = (y * W + x) * 4
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255
    }
    return buf
  }
  const refT = T('alpha-ref.png'), testT = T('alpha-test.png'), sameT = T('alpha-same.png')
  await sharp(canvas(255, 0, 0), { raw: { width: W, height: H, channels: 4 } }).png().toFile(refT)
  await sharp(canvas(0, 0, 255), { raw: { width: W, height: H, channels: 4 } }).png().toFile(testT)
  await sharp(canvas(255, 0, 0), { raw: { width: W, height: H, channels: 4 } }).png().toFile(sameT)

  const opaque = 100 * 100, boxPx = BOX * BOX
  const full = await compareImages(refT, testT)
  const masked = await compareImages(refT, testT, { alpha: true })
  const maskedSame = await compareImages(refT, sameT, { alpha: true })

  ok('参考图透明率符合预期', masked.maskPixels === boxPx,
    `不透明像素=${masked.maskPixels}（期望 ${boxPx} = 40x40）`)
  ok('不带 --alpha：透明处也计入，占比被稀释到 16%', Math.abs(full.diffRatio - boxPx / opaque) < 1e-9,
    `差异占比=${pct(full.diffRatio)}（= ${boxPx}/${opaque}）`)
  ok('带 --alpha：只比不透明区 -> 100% 差异', Math.abs(masked.diffRatioInMask - 1) < 1e-9,
    `不透明区占比=${pct(masked.diffRatioInMask)}（${masked.diffPixelsInMask}/${masked.maskPixels}）`)
  ok('带 --alpha：内容相同的不透明区 -> 0%', maskedSame.diffPixelsInMask === 0 && maskedSame.meanChannelErrorInMask === 0,
    `不透明区占比=${pct(maskedSame.diffRatioInMask)} 不透明区平均通道误差=${maskedSame.meanChannelErrorInMask.toFixed(4)}`)
  ok('两种模式的差异像素数一致（掩膜只影响分母）', full.diffPixels === masked.diffPixelsInMask,
    `full=${full.diffPixels} masked=${masked.diffPixelsInMask}`)
  const cliA = spawnSync(process.execPath, [path.join(__dirname, 'compare.mjs'), 'tmp/alpha-ref.png', 'tmp/alpha-test.png', '--alpha'], { encoding: 'utf8' })
  ok('CLI --alpha 命中 100% -> 退出码 1', cliA.status === 1, `exit=${cliA.status}  ${tail(cliA.stdout + cliA.stderr)}`)
}

/* ---------- 用例 5 / 6：坏输入必须优雅报错 ---------- */
console.log('')
console.log('用例 5  不存在的文件')
{
  let caught = null
  try { await compareImages(A('ref-WORK-240-dark.png'), T('this-file-does-not-exist.png')) } catch (e) { caught = e }
  ok('抛出 CompareError 而不是崩溃', caught instanceof CompareError, caught ? `message="${caught.message}"` : '未抛错')
  ok('错误消息里没有堆栈', caught && !/\n\s+at /.test(caught.message), 'message 为单行')
}
console.log('')
console.log('用例 6  损坏的图片')
{
  const bad = T('corrupt.png')
  fs.writeFileSync(bad, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('this is not a real png body')]))
  let caught = null
  try { await compareImages(A('ref-WORK-240-dark.png'), bad) } catch (e) { caught = e }
  ok('抛出 CompareError 而不是崩溃', caught instanceof CompareError, caught ? `message="${caught.message}"` : '未抛错')

  const empty = T('empty.png')
  fs.writeFileSync(empty, Buffer.alloc(0))
  let caught2 = null
  try { await compareImages(A('ref-WORK-240-dark.png'), empty) } catch (e) { caught2 = e }
  ok('0 字节文件也优雅报错', caught2 instanceof CompareError, caught2 ? `message="${caught2.message}"` : '未抛错')
}

/* ---------- 用例 7：真·CLI 退出码 ---------- */
console.log('')
console.log('用例 7  CLI 子进程退出码（真正被自动化调用的路径）')
function cli(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'compare.mjs'), ...args], { encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
{
  const a = cli(['refs/ref-WORK-240-dark.png', 'refs/ref-WORK-240-dark.png'])
  ok('同图 -> 退出码 0', a.code === 0, `exit=${a.code}  ${tail(a.out)}`)

  const b = cli(['refs/ref-WORK-240-dark.png', 'refs/ref-WAIT-240-dark.png'])
  ok('异状态 -> 退出码 1', b.code === 1, `exit=${b.code}  ${tail(b.out)}`)

  const c = cli(['refs/ref-WORK-240-dark.png', 'refs/ref-WAIT-240-dark.png', '--max-diff', '90'])
  ok('放宽容差后同一次比对 -> 退出码 0', c.code === 0, `exit=${c.code}  ${tail(c.out)}`)

  const d = cli(['refs/ref-WORK-240-dark.png', 'tmp/nope-does-not-exist.png'])
  ok('文件不存在 -> 退出码 2', d.code === 2, `exit=${d.code}  ${tail(d.out)}`)
  ok('文件不存在 -> 无堆栈', !/\n\s+at /.test(d.out), 'stderr 无 at 行')

  const e = cli(['tmp/corrupt.png', 'refs/ref-WORK-240-dark.png'])
  ok('参考图损坏 -> 退出码 2', e.code === 2, `exit=${e.code}  ${tail(e.out)}`)

  const f = cli(['--help'])
  ok('--help -> 退出码 0', f.code === 0, `exit=${f.code}`)

  const g = cli([])
  ok('缺参数 -> 退出码 2', g.code === 2, `exit=${g.code}  ${tail(g.out)}`)

  const h = cli(['refs/ref-WORK-240-dark.png', 'refs/ref-WORK-240-dark.png', '--alpha'])
  ok('--alpha 模式同图 -> 退出码 0', h.code === 0, `exit=${h.code}  ${tail(h.out)}`)
}
function tail(s) { const l = s.trim().split('\n'); return l[l.length - 1].slice(0, 130) }

/* ---------- 汇总 ---------- */
console.log('')
console.log('='.repeat(72))
console.log(`自证结果: PASS ${pass} / FAIL ${fail}`)
if (fail) { console.log('失败用例: ' + fails.join(' | ')); }
console.log('='.repeat(72))
await closeAll()
/* 收尾：确认没有留下无头浏览器进程（硬约束：全程 headless，不留残余窗口/进程） */
const rp = spawnSync(process.execPath, [path.join(__dirname, 'reap.mjs')], { encoding: 'utf8' })
console.log((rp.stdout || '').trim() || ('[reap] 未能执行：' + (rp.stderr || '').trim()))
console.log(`[headless] 本次全程 headless=${isHeadless()}`)
process.exit(fail ? 1 : 0)
