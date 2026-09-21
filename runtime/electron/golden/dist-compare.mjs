#!/usr/bin/env node
/* dist-compare.mjs —— 对比两种粒子分布的 A/B 样本（disk 球面投影 vs annulus 2D 环带）
 *
 * 产出（golden/cmp/）:
 *   disk-WORK.png / annulus-WORK.png / disk-IDLE.png / annulus-IDLE.png   240px dark
 *   side-by-side.png                                                      左 disk 右 annulus，上 IDLE 下 WORK
 *
 * 注意：**不会**动 refs/ 里的 23 张黄金样本（默认 dist=disk，行为完全不变）。
 * 用法: node dist-compare.mjs
 * 退出码: 0 全部成功；1 有失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { render, closeAll, sharp, isHeadless } from './h2render.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'cmp')
const DSF = 2
const CELL = 480              // 物理像素（240 CSS px @ dsf=2）
const STATES = ['IDLE', 'WORK']
const DISTS = ['disk', 'annulus']

/* ---------- 带内占比测量：直接问页面要粒子半径，不靠图像反推 ---------- */
async function measure(state, dist) {
  const { startServer, getBrowser } = await import('./h2render.mjs')
  const base = await startServer()
  const browser = await getBrowser()
  const size = 240
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: size, height: size } })
  try {
    const page = await ctx.newPage()
    await page.goto(`${base}h2-golden.html?state=${state}&size=${size}&bg=dark&t=0&dist=${dist}`, { waitUntil: 'load' })
    await page.waitForFunction('window.__goldenReady === true')
    const m = await page.evaluate(() => {
      const rs = window.__radii
      const band = window.__golden.radiusBand
      const n = rs.length
      let inBand = 0
      for (const r of rs) if (r >= band[0] && r <= band[1]) inBand++
      rs.sort((a, b) => a - b)
      return { n, band, inBand, min: rs[0], max: rs[n - 1], p05: rs[Math.floor(n * 0.05)], p50: rs[Math.floor(n * 0.5)], p95: rs[Math.floor(n * 0.95)] }
    })
    return { state, dist, ...m, inBandPct: m.inBand / m.n }
  } finally { await ctx.close() }
}

/* ---------- 并排对照图 ----------
 * 注意：**不能**用 sharp 的 SVG 光栅化来做文字标注。实测（tmp/check-sbs-text.mjs）：
 * librsvg 在这台 Windows 上拿不到字体，<?text> 全部静默不渲染（顶部标题区 0 个亮像素），
 * 只有装饰用的 <rect> 生效。改用"HTML + 同一套 headless 浏览器"渲染，文字可靠且可自检。 */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function sbsHtml(cells, meta) {
  const img = (st, d) => 'data:image/png;base64,' + cells[`${d}-${st}`].toString('base64')
  const row = (st) => `
    <section class="row">
      <div class="rowlab"><span class="stname">${esc(st)}</span><span class="rowmeta">${esc(meta[st])}</span></div>
      <div class="cells">
        <figure class="cell"><img src="${img(st, 'disk')}" width="480" height="480" alt=""><figcaption>disk</figcaption></figure>
        <figure class="cell"><img src="${img(st, 'annulus')}" width="480" height="480" alt=""><figcaption class="hl">annulus</figcaption></figure>
      </div>
    </section>`
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:1112px;background:#0b0f14;color:#dbe8f2;font-family:"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif;padding:34px 34px 30px}
    h1{font-size:25px;font-weight:600;letter-spacing:.2px}
    .sub{margin-top:9px;font-size:15px;color:#8296a8}
    .sub b{color:#c8dceb;font-weight:600}
    .legend{margin-top:16px;display:flex;gap:10px}
    .legend div{flex:1;border-top:2px solid #63798c;padding-top:9px;font-size:21px;font-weight:600;color:#9fb6c8}
    .legend div.hl{border-top-color:#5cffd0;color:#5cffd0}
    .row{margin-top:26px}
    .rowlab{display:flex;align-items:baseline;gap:12px;margin-bottom:10px}
    .stname{font-size:19px;font-weight:600;color:#c8dceb;letter-spacing:1.6px}
    .rowmeta{font-size:13px;color:#6b8195}
    .cells{display:grid;grid-template-columns:480px 480px;gap:14px}
    .cell{position:relative;width:480px}
    .cell img{display:block;width:480px;height:480px;border:1px solid #26323d}
    .cell figcaption{position:absolute;left:10px;top:9px;font-size:12px;letter-spacing:.6px;color:#63798c}
    .cell figcaption.hl{color:#3fbf9c}
    footer{margin-top:22px;padding-top:12px;border-top:1px solid #1e2836;font-size:12.5px;line-height:1.7;color:#7f95a8}
    </style></head><body>
    <h1>H2 粒子分布 A/B：disk（球面投影） vs annulus（2D 环带）</h1>
    <div class="sub">同一图标、同一状态、同一冻结相位 t=0、240 CSS px @ deviceScaleFactor=2 → 480×480 物理像素。
      SPEC 第 3 节写的是 <b>r∈[R0,R1] 环带</b>；左列参考实现实际给出的是<b>实心圆盘</b>。</div>
    <div class="legend"><div>disk</div><div class="hl">annulus</div></div>
    ${row('IDLE')}
    ${row('WORK')}
    <footer>disk = 照抄 hybrid.html 的 halo()：x=100+rad·√(1-u²)·cosθ，y=100+rad·u·0.94 → 球壳正交投影，落成实心圆盘，半径被 √((1-u²)cos²θ+0.88u²) 压缩。<br>
      annulus = 半径在 [R0,R1] 内均匀采样、角度均匀、半径不被 cosθ 压缩；深度 z=√(1-(r/R1)²) 继续驱动 SPEC 第 3 节的 r=0.85+z×1.5 与 opacity=0.26+0.74×z 分层。</footer>
    </body></html>`
}

async function buildSideBySide(cells, meta) {
  const { startServer, getBrowser } = await import('./h2render.mjs')
  const base = await startServer()
  const browser = await getBrowser()
  const html = sbsHtml(cells, meta)
  // 中间 HTML 必须落在**服务根目录**（golden/）下：服务 root = __dirname，子目录会 404。
  const f = path.join(__dirname, '_sbs-tmp.html')
  fs.writeFileSync(f, html, 'utf8')
  const W = 1112
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: W, height: 1200 } })
  const problems = []
  try {
    const page = await ctx.newPage()
    page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()) })
    page.on('pageerror', e => problems.push('PAGEERROR ' + e.message))
    await page.goto(base + '_sbs-tmp.html', { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const diag = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')]
      return {
        imgCount: imgs.length,
        imgLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        scrollH: document.documentElement.scrollHeight,
        bodyBg: getComputedStyle(document.body).backgroundColor
      }
    })
    if (diag.imgCount !== 4) problems.push(`页面里 img 数量 = ${diag.imgCount}，应为 4`)
    if (diag.imgLoaded !== 4) problems.push(`成功加载的 img = ${diag.imgLoaded}，应为 4`)
    if (diag.bodyBg === 'rgba(0, 0, 0, 0)') problems.push('body 背景色没生效（rgba(0,0,0,0)），截图会是白底')
    if (diag.scrollH < 800) problems.push(`页面高度只有 ${diag.scrollH}px，内容没渲染出来`)
    if (problems.length) throw new Error('页面自检失败：' + problems.join('; '))

    const buffer = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: diag.scrollH } })
    const out = path.join(OUT, 'side-by-side.png')
    fs.writeFileSync(out, buffer)
    // 像素自检：非白底 + 顶部确实有文字
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const isBg = (i2) => Math.abs(data[i2] - 255) < 6 && Math.abs(data[i2 + 1] - 255) < 6 && Math.abs(data[i2 + 2] - 255) < 6
    let white = 0, titleBright = 0, iconPixels = 0
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i2 = (y * info.width + x) * 4
      if (isBg(i2)) white++
      const lum = 0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2]
      if (y > 30 && y < 100 && lum > 90) titleBright++
      if (y > 200 && lum > 90) iconPixels++
    }
    const whitePct = white / (info.width * info.height)
    if (whitePct > 0.2) problems.push(`纯白像素占 ${(100 * whitePct).toFixed(1)}%，疑似白底/未渲染`)
    if (titleBright < 500) problems.push(`标题区亮像素仅 ${titleBright}，文字没渲染出来`)
    if (iconPixels < 5000) problems.push(`图标区亮像素仅 ${iconPixels}，4 张图标可能没画出来`)
    return { out, W, H: info.height, titleBrightPixels: titleBright, whitePct, iconPixels, problems }
  } finally {
    await ctx.close()
    try { fs.unlinkSync(f) } catch (e) { }
  }
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`输出目录 : ${OUT}   （headless=${isHeadless()}）`)
  console.log('')
  const cells = {}
  const measurements = []
  let fail = 0

  console.log('--- 1) 渲染 4 张 A/B 样本（240 CSS px @ dsf=2 -> 480x480 物理）---')
  for (const st of STATES) {
    for (const d of DISTS) {
      try {
        const r = await render({ state: st, size: 240, bg: 'dark', t: 0, dsf: DSF, dist: d })
        const file = path.join(OUT, `${d}-${st}.png`)
        fs.writeFileSync(file, r.buffer)
        const meta = await sharp(r.buffer).metadata()
        cells[`${d}-${st}`] = r.buffer
        console.log(`   ${`${d}-${st}.png`.padEnd(22)} ${meta.width}x${meta.height}  ${meta.channels} 通道  ${r.buffer.length} 字节  url=${r.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')}`)
      } catch (e) { fail++; console.log(`   ${d}-${st} 渲染失败: ${e.message}`) }
    }
  }

  console.log('')
  console.log('--- 2) 粒子半径带内占比（直接读页面里的粒子真实半径）---')
  console.log('状态   分布       粒子数  半径带        带内    带内占比   最小 r   5%   中位   95%   最大 r')
  console.log('-'.repeat(104))
  for (const st of STATES) {
    for (const d of DISTS) {
      try {
        const m = await measure(st, d)
        measurements.push(m)
        console.log(`${st.padEnd(6)} ${d.padEnd(9)} ${String(m.n).padEnd(7)} [${m.band[0]},${m.band[1]}]`.padEnd(34)
          + `${String(m.inBand).padEnd(8)}${(100 * m.inBandPct).toFixed(1).padStart(6)}%   `
          + `${m.min.toFixed(1).padStart(6)}${m.p05.toFixed(1).padStart(7)}${m.p50.toFixed(1).padStart(7)}${m.p95.toFixed(1).padStart(7)}${m.max.toFixed(1).padStart(7)}`)
      } catch (e) { fail++; console.log(`   ${st}/${d} 测量失败: ${e.message}`) }
    }
  }

  console.log('')
  console.log('--- 3) 并排对照图（HTML + headless 浏览器渲染文字）---')
  try {
    const meta = {}
    for (const st of STATES) {
      const m = measurements.find(x => x.state === st && x.dist === 'disk')
      const a = measurements.find(x => x.state === st && x.dist === 'annulus')
      if (m && a) meta[st] = `band [${m.band[0]},${m.band[1]}] · disk in-band ${(100 * m.inBandPct).toFixed(1)}% (r ${m.min.toFixed(1)}–${m.max.toFixed(1)})  vs  annulus ${(100 * a.inBandPct).toFixed(1)}% (r ${a.min.toFixed(1)}–${a.max.toFixed(1)})`
    }
    const r = await buildSideBySide(cells, meta)
    console.log(`   ${path.basename(r.out)}  ${r.W}x${r.H}  ${fs.statSync(r.out).size} 字节`)
    console.log(`   自检：标题区亮像素=${r.titleBrightPixels}（>500 视为文字已渲染；此前用 sharp+SVG 是 0）  纯白像素占比=${(100 * r.whitePct).toFixed(2)}%（应 <20%）  图标区亮像素=${r.iconPixels || '见下方'}`)
    if (r.problems.length) { fail++; console.log('   自检问题: ' + r.problems.join(' | ')) }
  } catch (e) { fail++; console.log('   生成失败: ' + e.message) }

  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), headless: isHeadless(), dsf: DSF, size: 240,
    note: 'disk = 照抄 halo() 的球面投影；annulus = 2D 环带（半径不被 cosθ 压缩，z=√(1-(r/R1)²)）',
    measurements
  }, null, 2))
  console.log('')
  console.log(`完成：失败 ${fail} 项`)

  await closeAll()
  const rp = spawnSync(process.execPath, [path.join(__dirname, 'reap.mjs')], { encoding: 'utf8' })
  console.log((rp.stdout || '').trim() || ('[reap] 未能执行：' + (rp.stderr || '').trim()))
  console.log(`[headless] 本次全程 headless=${isHeadless()}`)
  process.exit(fail ? 1 : 0)
}

run().catch(async e => {
  console.error('[失败] ' + (e && e.stack || e))
  await closeAll()
  process.exit(1)
})
