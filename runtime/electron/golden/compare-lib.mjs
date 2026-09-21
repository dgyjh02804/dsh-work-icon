/* compare-lib.mjs —— 像素比对内核（compare.mjs 与 selftest.mjs 共用） */
import fs from 'node:fs'
import { sharp } from './h2render.mjs'

export const DEFAULT_THRESHOLD = 16
export const GRID = 8

export class CompareError extends Error {
  constructor(msg) { super(msg); this.name = 'CompareError' }
}

async function readRGBA(file) {
  if (typeof file !== 'string' || !file.length) throw new CompareError('路径为空')
  let st
  try { st = fs.statSync(file) } catch (e) { throw new CompareError(`读不到文件：${file}（${e.code || e.message}）`) }
  if (!st.isFile()) throw new CompareError(`不是文件：${file}`)
  if (st.size === 0) throw new CompareError(`文件是空的（0 字节），无法解码：${file}`)
  try {
    // 第一步只读元数据，格式不对会在这里就抛
    await sharp(file, { failOn: 'none' }).metadata()
    const { data, info } = await sharp(file, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (!info.width || !info.height) throw new CompareError(`解码后尺寸为 0：${file}`)
    return { data, W: info.width, H: info.height, file, bytes: st.size }
  } catch (e) {
    if (e instanceof CompareError) throw e
    throw new CompareError(`解码失败（不是有效图片？）：${file} —— ${e.message}`)
  }
}

function px(buf, W, x, y) {
  const i = (y * W + x) * 4
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
}

/**
 * 比对两张图。
 * @param {string} refFile 参考图（黄金样本）
 * @param {string} testFile 待测图
 * @param {{threshold?:number, alpha?:boolean, tolerance?:number}} opts
 *        threshold: 单通道差异 > threshold 记为"差异像素"（默认 16）
 *        alpha: true = 只比参考图不透明区域（alpha>tolerance）
 */
export async function compareImages(refFile, testFile, opts = {}) {
  const threshold = opts.threshold === undefined ? DEFAULT_THRESHOLD : Number(opts.threshold)
  if (!Number.isFinite(threshold) || threshold < 0) throw new CompareError(`阈值非法：${opts.threshold}`)
  const alphaMode = !!opts.alpha
  const tolerance = opts.tolerance === undefined ? 0 : Number(opts.tolerance)

  const ref = await readRGBA(refFile)
  let test = await readRGBA(testFile)

  const warnings = []
  let resized = null
  if (test.W !== ref.W || test.H !== ref.H) {
    const before = `${test.W}x${test.H}`
    const r = await sharp(test.data, { raw: { width: test.W, height: test.H, channels: 4 } })
      .resize(ref.W, ref.H, { kernel: 'lanczos3', fit: 'fill' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    test = { data: r.data, W: r.info.width, H: r.info.height, file: test.file, bytes: test.bytes }
    resized = { from: before, to: `${ref.W}x${ref.H}` }
    warnings.push(`尺寸不一致，已把待测图从 ${before} 缩放到 ${ref.W}x${ref.H}（lanczos3）—— 缩放本身会引入像素差异`)
  }

  const W = ref.W, H = ref.H, R = ref.data, T = test.data
  const total = W * H
  const mask = new Uint8Array(total)
  let maskCount = 0
  if (alphaMode) {
    for (let p = 0; p < total; p++) if (R[p * 4 + 3] > tolerance) { mask[p] = 1; maskCount++ }
    if (maskCount === 0) throw new CompareError('--alpha 模式下参考图没有任何不透明像素，无从比对')
    warnings.push(`--alpha 模式：只比对参考图 alpha>${tolerance} 的 ${maskCount}/${total} 个像素（${(100 * maskCount / total).toFixed(1)}%）`)
  } else {
    mask.fill(1); maskCount = total
    let refAlphaUniq = new Set()
    for (let p = 0; p < total; p++) refAlphaUniq.add(R[p * 4 + 3])
    if (refAlphaUniq.size > 1 || !refAlphaUniq.has(255)) {
      warnings.push('参考图含透明像素，但未开 --alpha：透明处也参与比对（原生窗口抓图没有 alpha 时建议加 --alpha）')
    }
  }

  const diff = new Uint8Array(total)
  const heat = Buffer.alloc(total * 3)
  const cellDiff = new Int32Array(GRID * GRID), cellMask = new Int32Array(GRID * GRID)
  let flagged = 0, flaggedMasked = 0
  let sumCh = 0, sumChMasked = 0, nChMasked = 0
  let worst = { cd: -1, x: 0, y: 0 }
  let maxChError = 0
  let refColors = 0, testColors = 0

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, i = p * 4
      const inMask = mask[p] === 1
      const d0 = Math.abs(R[i] - T[i]), d1 = Math.abs(R[i + 1] - T[i + 1]), d2 = Math.abs(R[i + 2] - T[i + 2])
      const cd = d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2)
      sumCh += d0 + d1 + d2
      if (cd > maxChError) maxChError = cd
      if (inMask) { sumChMasked += d0 + d1 + d2; nChMasked += 3 }
      if (cd > threshold) {
        flagged++; diff[p] = 1
        if (inMask) flaggedMasked++
        if (cd > worst.cd) worst = { cd, x, y }
      }
      if (inMask && cd > 0) {
        const gi = Math.min(GRID - 1, (y * GRID / H) | 0), gj = Math.min(GRID - 1, (x * GRID / W) | 0)
        cellDiff[gi * GRID + gj]++
      }
      if (inMask) { const gi = Math.min(GRID - 1, (y * GRID / H) | 0), gj = Math.min(GRID - 1, (x * GRID / W) | 0); cellMask[gi * GRID + gj]++ }
      // 参考图有颜色的像素 / 待测图有颜色的像素（仅在被比对区域内统计；用于"待测图整块空白/黑图"的粗体检）
      if (inMask && R[i + 3] > 8 && (R[i] > 8 || R[i + 1] > 8 || R[i + 2] > 8)) refColors++
      if (inMask && T[i + 3] > 8 && (T[i] > 8 || T[i + 1] > 8 || T[i + 2] > 8)) testColors++
      const a = cd > threshold ? 1 : 0.22
      const inten = Math.min(1, cd / 128)
      const rr = a === 1 ? Math.round(70 + 185 * inten) : Math.round(R[i] * a)
      const gg = a === 1 ? Math.round(20 * (1 - inten)) : Math.round(R[i + 1] * a)
      const bb = a === 1 ? Math.round(30 * (1 - inten)) : Math.round(R[i + 2] * a)
      heat[p * 3] = rr; heat[p * 3 + 1] = gg; heat[p * 3 + 2] = bb
    }
  }

  // 8x8 网格：按"该块内差异像素占该块被比对像素的比例"排序，取前 3
  const cells = []
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const idx = gy * GRID + gx
      const x1 = Math.round(gx * W / GRID), x2 = Math.round((gx + 1) * W / GRID)
      const y1 = Math.round(gy * H / GRID), y2 = Math.round((gy + 1) * H / GRID)
      const bg = (x2 - x1) * (y2 - y1)
      const n = cellDiff[idx]
      cells.push({
        grid: `[${gx},${gy}]`, x1, y1, x2, y2, pixels: n,
        cellPixels: bg, maskedPixels: cellMask[idx],
        ratio: cellMask[idx] ? n / cellMask[idx] : 0
      })
    }
  }
  const worstCells = cells.slice().sort((a, b) => b.pixels - a.pixels || b.ratio - a.ratio).slice(0, 3)

  if (testColors < 0.005 * maskCount) warnings.push('待测图在被比对区域内几乎没有非黑像素（黑图/空白图？），比对结果无意义')
  if (refColors < 0.005 * maskCount) warnings.push('参考图在被比对区域内几乎没有非黑像素，样本可能选错了')

  return {
    ref: { file: refFile, width: W, height: H, bytes: ref.bytes },
    test: { file: testFile, width: test.W, height: test.H, bytes: test.bytes },
    threshold, alphaMode, tolerance,
    resized, warnings,
    totalPixels: total,
    maskPixels: maskCount,
    diffPixels: flagged,
    diffRatio: flagged / total,
    diffPixelsInMask: flaggedMasked,
    diffRatioInMask: maskCount ? flaggedMasked / maskCount : 0,
    meanChannelError: sumCh / (total * 3),
    meanChannelErrorInMask: nChMasked ? sumChMasked / nChMasked : 0,
    maxChannelError: maxChError,
    worstPixel: worst.cd < 0 ? null : worst,
    worstCells,
    refColorPixels: refColors,
    testColorPixels: testColors,
    heat: { data: heat, width: W, height: H }
  }
}

export async function writeHeatmap(res, outFile) {
  await sharp(res.heat.data, { raw: { width: res.heat.width, height: res.heat.height, channels: 3 } })
    .png({ compressionLevel: 9 }).toFile(outFile)
  return outFile
}

export function defaultHeatmapPath(testFile) {
  const dir = testFile.replace(/[\\/][^\\/]*$/, '')
  const base = testFile.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return (dir ? dir + '\\' : '') + base + '-diff-heatmap.png'
}

export function formatReport(res) {
  const L = []
  const pct = (v) => (100 * v).toFixed(3) + '%'
  L.push(`参考图 : ${res.ref.file}  (${res.ref.width}x${res.ref.height})`)
  L.push(`待测图 : ${res.test.file}  (${res.test.width}x${res.test.height})`)
  L.push(`阈值   : 单通道差 > ${res.threshold} 记为差异像素${res.alphaMode ? `；--alpha 模式（alpha>${res.tolerance} 才计入）` : ''}`)
  for (const w of res.warnings) L.push(`[提示] ${w}`)
  L.push('')
  L.push(`差异像素占比        : ${pct(res.diffRatio)}   (${res.diffPixels} / ${res.totalPixels})`)
  if (res.alphaMode) L.push(`差异像素占比(不透明区): ${pct(res.diffRatioInMask)}   (${res.diffPixelsInMask} / ${res.maskPixels})   <= 判定用这一行`)
  L.push(`平均通道误差        : ${res.meanChannelError.toFixed(3)} / 255` + (res.alphaMode ? `   (不透明区内 ${res.meanChannelErrorInMask.toFixed(3)})` : ''))
  L.push(`最大单通道差        : ${res.maxChannelError} / 255` + (res.worstPixel ? `   最强差异像素 @ (${res.worstPixel.x}, ${res.worstPixel.y})，该点差 ${res.worstPixel.cd}` : ''))
  L.push(`有颜色像素          : 参考 ${res.refColorPixels} / 待测 ${res.testColorPixels}`)
  L.push('')
  L.push('最大差异区域（8x8 网格，按块内差异像素数排序前 3）：')
  res.worstCells.forEach((c, i) => {
    L.push(`  ${i + 1}. ${c.grid} 像素框 x[${c.x1},${c.x2}) y[${c.y1},${c.y2})  差异 ${c.pixels} 个 / 块内 ${c.maskedPixels} 个被比对像素  (${(100 * c.ratio).toFixed(1)}%)`)
  })
  return L.join('\n')
}
