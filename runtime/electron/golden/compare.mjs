#!/usr/bin/env node
/* compare.mjs —— H2 黄金样本像素比对工具
 *
 * 用法:
 *   node compare.mjs <参考图> <待测图> [像素阈值]
 *     [像素阈值] = 单通道差 > 该值才算"差异像素"，默认 16（0-255 量纲）
 * 选项:
 *   --max-diff P   允许的差异像素占比 P%（默认 2，即 2%）。判定用它，超了退出码 1
 *   --alpha        只比对参考图的不透明区域（alpha>tolerance 才计入，判定用不透明区占比）
 *                  推荐：默认 tolerance 0 时能排除"完全透明处被当成差异"，但极低 alpha（<16）
 *                  的边缘像素受合成器舍入影响本身就有噪声，需要更干净时用 --tolerance 16
 *   --tolerance N  参考图 alpha 阈值（配合 --alpha，默认 0）
 *   --out <file>   热力图输出路径（默认 <待测图同名>-diff.png）
 *   --quiet        只输出摘要与判定
 *   --help
 * 退出码: 0 = 差异占比 <= --max-diff；1 = 超了；2 = 参数/文件/解码错误
 */
import { compareImages, writeHeatmap, defaultHeatmapPath, formatReport, CompareError, DEFAULT_THRESHOLD } from './compare-lib.mjs'

function usage() {
  console.log(`用法: node compare.mjs <参考图> <待测图> [像素阈值=${DEFAULT_THRESHOLD}]
选项: --max-diff P(%)  --alpha  --tolerance N  --out <热力图>  --quiet
退出码: 0 通过 / 1 超阈值 / 2 输入错误`)
}

function needNum(v, name) {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new CompareError(`${name} 需要数字，收到：${v}`)
  return n
}

function parse(argv) {
  const pos = []
  const o = { alpha: false, tolerance: 0, out: null, quiet: false, help: false, threshold: DEFAULT_THRESHOLD, maxDiff: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--alpha') o.alpha = true
    else if (a === '--quiet') o.quiet = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a === '--tolerance') o.tolerance = needNum(argv[++i], '--tolerance')
    else if (a.startsWith('--tolerance=')) o.tolerance = needNum(a.slice(12), '--tolerance')
    else if (a === '--max-diff') o.maxDiff = needNum(argv[++i], '--max-diff')
    else if (a.startsWith('--max-diff=')) o.maxDiff = needNum(a.slice(11), '--max-diff')
    else if (a === '--out') { o.out = argv[++i]; if (!o.out) throw new CompareError('--out 需要路径') }
    else if (a.startsWith('--out=')) o.out = a.slice(6)
    else if (a.startsWith('--')) throw new CompareError(`未知选项：${a}`)
    else pos.push(a)
  }
  if (o.help) return o
  if (pos.length < 2) throw new CompareError(`需要两个位置参数：<参考图> <待测图>（收到 ${pos.length} 个）`)
  o.ref = pos[0]; o.test = pos[1]
  if (pos.length >= 3) o.threshold = needNum(pos[2], '像素阈值')
  if (pos.length > 3) throw new CompareError(`多余的位置参数：${pos.slice(3).join(' ')}`)
  if (o.threshold < 0 || o.threshold > 255) throw new CompareError(`像素阈值应在 0-255：${o.threshold}`)
  if (o.maxDiff === null) o.maxDiff = o.alpha ? 2 : 2
  if (o.maxDiff < 0) throw new CompareError('--max-diff 不能为负')
  return o
}

async function main() {
  let o
  try { o = parse(process.argv.slice(2)) } catch (e) { console.error('[参数错误] ' + e.message); console.error(''); usage(); process.exit(2) }
  if (o.help) { usage(); process.exit(0) }

  let res
  try {
    res = await compareImages(o.ref, o.test, { threshold: o.threshold, alpha: o.alpha, tolerance: o.tolerance })
  } catch (e) {
    if (e instanceof CompareError) { console.error('[输入错误] ' + e.message); process.exit(2) }
    console.error('[内部错误] ' + (e && e.message ? e.message : String(e))); process.exit(2)
  }

  const heatPath = o.out || defaultHeatmapPath(o.test)
  let heatOk = true
  try { await writeHeatmap(res, heatPath) } catch (e) { heatOk = false; res.warnings.push(`热力图写盘失败：${e.message}`) }

  const judge = res.alphaMode ? res.diffRatioInMask : res.diffRatio
  const allow = o.maxDiff / 100
  const passed = judge <= allow

  if (!o.quiet) { console.log(formatReport(res)); console.log('') }
  console.log(`热力图 : ${heatOk ? heatPath : '(写盘失败)'}`)
  console.log(`判定   : 差异占比 ${(100 * judge).toFixed(3)}%  vs 允许 ${(o.maxDiff).toFixed(3)}%  ->  ${passed ? 'PASS' : 'FAIL'}`)
  process.exit(passed ? 0 : 1)
}

main()
