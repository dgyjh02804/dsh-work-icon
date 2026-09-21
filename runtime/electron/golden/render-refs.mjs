#!/usr/bin/env node
/* render-refs.mjs —— 一键重跑全部 H2 七态参考图（黄金样本）
 *
 * 本机 dpr = 2.0：deviceScaleFactor 固定 2，CSS 240px -> 物理 480x480，CSS 96px -> 物理 192x192。
 * 动画相位全部由 URL 的 t 决定（t=0）——与页面加载时刻无关，这是可复现的前提。
 *
 * 关于"确定性"（实测结论，见 tmp/analyse96.mjs、tmp/repeatability.mjs）：
 *   浏览器光栅化器对粒子/辉光的抗锯齿边缘偶发会落到另一个"特征态"：
 *   240px 下典型是 2/8 次渲染出现同样 9 个物理像素的差异（最大单通道差 19/255）。
 *   这不是页面里有什么在动（相位是冻结的、粒子是定种子的），是 Chromium 合成器自身的抖动。
 *   因此本脚本默认对同一张图连渲 REPS 次，选出"离其余帧总差异最小"的那一帧作为黄金样本
 *   （多数派/中位帧），从而让不同人不同时间跑出来的参考图是同一张。
 *
 * 用法: node render-refs.mjs [--out <目录>] [--reps N] [--dsf N] [--json <file>]
 * 退出码: 0 全部生成成功；1 有渲染失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { render, closeAll, sha256, sharp, isHeadless } from './h2render.mjs'
import { compareImages } from './compare-lib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const OUT = arg('--out', path.join(__dirname, 'refs'))
const DSF = Number(arg('--dsf', process.env.H2_DSF || '2'))
const REPS = Math.max(1, Math.min(9, Number(arg('--reps', '5'))))
const JSON_OUT = arg('--json', null)

const STATES = ['IDLE', 'THINK', 'WORK', 'WAIT', 'OK', 'ERR', 'OFF']
const T = 0        // 冻结相位（秒）

const manifest = []
for (const s of STATES) {
  manifest.push({ state: s, size: 240, bg: 'dark', t: T, dsf: DSF, file: `ref-${s}-240-dark.png` })
  manifest.push({ state: s, size: 240, bg: 'white', t: T, dsf: DSF, file: `ref-${s}-240-white.png` })
  manifest.push({ state: s, size: 240, bg: 'none', t: T, dsf: DSF, file: `ref-${s}-240-alpha.png` })
}
manifest.push({ state: 'WORK', size: 96, bg: 'dark', t: T, dsf: DSF, file: 'ref-WORK-96-dark.png' })
manifest.push({ state: 'WAIT', size: 96, bg: 'dark', t: T, dsf: DSF, file: 'ref-WAIT-96-dark.png' })

const TMPD = path.join(__dirname, 'tmp')
fs.mkdirSync(TMPD, { recursive: true })

/** 连渲 REPS 帧，返回 { buf, eigen, reps, maxRatio } —— eigen = 离其余帧总差异最小的那一帧 */
async function renderStable(m, onProbe) {
  const files = []
  for (let i = 0; i < REPS; i++) {
    const r = await render(m)
    const f = path.join(TMPD, '.cand-' + i + '.png')
    fs.writeFileSync(f, r.buffer)
    files.push({ f, buf: r.buffer, hash: sha256(r.buffer) })
  }
  const eigenCount = new Set(files.map(x => x.hash)).size
  let best = 0, bestScore = Infinity, maxRatio = 0
  const pairs = {}
  for (let i = 0; i < files.length; i++) {
    let score = 0
    for (let j = 0; j < files.length; j++) {
      if (i === j) continue
      const key = i + '-' + j
      const c = await compareImages(files[i].f, files[j].f, {})
      pairs[key] = c
      score += c.diffRatio
      if (c.diffRatio > maxRatio) maxRatio = c.diffRatio
    }
    if (score < bestScore) { bestScore = score; best = i }
  }
  if (onProbe) onProbe({ eigenCount, maxRatio })
  files.forEach(x => { try { fs.unlinkSync(x.f) } catch (e) { } })
  return { buf: files[best].buf, eigenCount, maxRatio, index: best, reps: REPS }
}

async function run() {
  if (DSF !== 2) console.warn(`[警告] deviceScaleFactor=${DSF}，本机 dpr=2.0；非 2 时物理像素与屏幕不对齐`)
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`输出目录 : ${OUT}`)
  console.log(`deviceScaleFactor = ${DSF}   （本机 dpr=2.0；CSS 240 -> 物理 ${240 * DSF}）`)
  console.log(`冻结相位 t = ${T}s（全部参考图同相位）   每张连渲 ${REPS} 次取"多数派帧"`)
  console.log('')
  console.log('文件                            状态   尺寸     物理像素   通道  alpha  字节     sha256[:12]  帧态/最大自差')
  console.log('-'.repeat(114))

  let fail = 0
  const rows = []
  const t0 = Date.now()
  for (const m of manifest) {
    const out = path.join(OUT, m.file)
    let buf = null, meta = null, st = null
    try {
      st = await renderStable(m)
      buf = st.buf
      fs.writeFileSync(out, buf)
      meta = await sharp(buf).metadata()
    } catch (e) {
      fail++
      console.log(`${m.file.padEnd(32)}${m.state.padEnd(7)} 渲染失败: ${e.message}`)
      continue
    }
    const hash = sha256(buf)
    const stableMark = st.eigenCount === 1 ? '全同类' : `${st.eigenCount} 种/取#${st.index}`
    rows.push({ ...m, file: path.basename(out), sha256: hash, bytes: buf.length, width: meta.width, height: meta.height, channels: meta.channels, hasAlpha: !!meta.hasAlpha, eigenStates: st.eigenCount, reps: st.reps, maxSelfDiffRatio: st.maxRatio })
    console.log(`${m.file.padEnd(32)}${m.state.padEnd(7)}${(m.size + 'px').padEnd(9)}${(meta.width + 'x' + meta.height).padEnd(11)}`
      + `${String(meta.channels).padEnd(6)}${(meta.hasAlpha ? 'yes' : 'no').padEnd(7)}${String(buf.length).padEnd(8)}${hash.slice(0, 12)}  ${stableMark} / 最大自差 ${(100 * st.maxRatio).toFixed(4)}%`)
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const flaky = rows.filter(r => r.eigenStates > 1)
  console.log('-'.repeat(114))
  console.log(`共 ${rows.length} 张，失败 ${fail} 张，耗时 ${secs}s`)
  console.log(`浏览器光栅化抖动：${flaky.length}/${rows.length} 张出现多种帧态` +
    (flaky.length ? `（最大自差 ${(100 * Math.max(...flaky.map(r => r.maxSelfDiffRatio))).toFixed(4)}%，已在选帧时被吸收）` : ''))

  // 透明底的物理证据
  const alphaRef = path.join(OUT, 'ref-WORK-240-alpha.png')
  if (fs.existsSync(alphaRef)) {
    const { data, info } = await sharp(alphaRef).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let a0 = 0, aF = 0
    for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) a0++; if (data[i] === 255) aF++ }
    console.log(`透明底证据：${path.basename(alphaRef)} ${info.width}x${info.height} 全透明像素=${a0} 不透明像素=${aF} 角像素 alpha=${data[3]}`)
  }
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), dsf: DSF, t: T, reps: REPS, headless: isHeadless(), files: rows }, null, 2))
    console.log(`清单: ${JSON_OUT}`)
  }
  await closeAll()
  /* 收尾：确认没有留下无头浏览器进程（硬约束：全程 headless，不留残余窗口/进程） */
  const rp = spawnSync(process.execPath, [path.join(__dirname, 'reap.mjs')], { encoding: 'utf8' })
  console.log((rp.stdout || '').trim() || ('[reap] 未能执行：' + (rp.stderr || '').trim()))
  console.log(`[headless] 本次全程 headless=${isHeadless()}`)
  process.exit(fail ? 1 : 0)
}

run().catch(async e => { console.error('[失败] ' + (e && e.stack || e)); await closeAll(); process.exit(1) })
