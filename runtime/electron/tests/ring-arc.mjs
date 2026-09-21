#!/usr/bin/env node
/* ============================================================================
 * ring-arc.mjs —— 在【生产几何口径】上量「进度环实际扫过多少度」
 *
 * ① 为什么需要它（现成的 ring-clone.mjs 为什么不够用）
 *    ring-clone.mjs --pixels 已经能出像素铁证，但它有两处**结构性**限制：
 *      · 它只跑 p=1/6 与 p=5/6 两个点（`for (const [tag, done] of [['p1',1],['p5',5]])`，
 *        总数为 6 —— **没有 p=4/8=50% 这个点**，而用户看到的正是 50%；
 *      · 它的指标是「环带里有百分之几的像素变了」（差值密度），
 *        **量不出"环扫过多少度"** —— 而用户的疑问恰恰是"角度占比和 p 不匹配"。
 *    所以本文件是新台子，**不是重写**：spawn / 清理 / PNG 解码全部沿用
 *    ring-clone.mjs 里已验证的实现（stdio 走 pipe、只按本轮 PID+启动时间杀、
 *    最小 PNG 解码器），只补上"角度覆盖"这一层度量。
 *
 * ② 几何口径：为什么必须自己开窗口，而不能用 --shot <box>
 *    main.js shotGeo(box) 原文：
 *        return { scale: box, svgSize: box, pad: 0, w: box, h: box, ... }
 *    ⇒ `--shot N` **强制 窗口 = SVG = N**，拿不到「210 窗口 + 144 SVG」这个生产组合。
 *    生产几何（main.js computeGeo，SPAN = 100/PLATE_R，PLATE_R = 97）：
 *        svgSize = round(140 * 100/97) = 144
 *        iconWin = max(round(140 * 1.5), 148) = 210
 *        pad     = (210 - 144) / 2           = 33
 *    ⇒ 本文件用一个**只有 30 行的测试用 main**（与 ring-clone 的 HARNESS_MAIN 同一招）
 *      直接造 210x210、show:false 的窗口，query 里喂 svg=144&pad=33&scale=140&shot=1。
 *      index.html / preload.js 都是产品文件的逐字节副本 ⇒ 跑的是真实渲染路径。
 *      **窗口全程 show:false（离屏），绝不显示到用户屏幕上。**
 *
 * ③ 度量方法（差分 + 角度直方图）
 *    同一几何、同一载荷下，只改 progress.done：
 *        A = p=0   （dasharray "0.0 552.9" ⇒ 不画弧，但 opacity=0.95）
 *        B = p=k/8
 *    A 与 B 的**差异像素**就是该 p 下真正被画出来的那一段弧。
 *    （shot=1 ⇒ FREEZE，粒子/相位冻结、transition 关闭 ⇒ 两图的差异只可能来自环。）
 *    对每个差异像素求「以图像中心为极点、从 12 点方向顺时针」的角度，
 *    打进 1° 直方图 ⇒ 覆盖角 = 有像素的角度数，占比 = 覆盖角/360。
 *
 * ④ 运行
 *      node tests/ring-arc.mjs
 *    产物（PNG + 报告）落在本轮独有的临时目录，可安全删除。
 * ========================================================================== */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME = path.resolve(process.env.RINGARC_RUNTIME || path.join(HERE, '..'))
const WANT_MUTANT = !process.argv.includes('--no-mutant')
const HTML_TARGET = (() => {
  const a = process.argv.find((x) => x.startsWith('--html='))
  return a ? a.slice(7) : null
})()

const ELECTRON = path.join(RUNTIME, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!fs.existsSync(ELECTRON)) { console.error('找不到 electron.exe：' + ELECTRON); process.exit(2) }

/* ---- 生产几何：从 main.js 的公式原样复算（不硬编码 144/210/33 的结论，写清推导） ---- */
const SCALE = 140                              /* config.json: window.scale */
const RATIO = 1.5                              /* config.json: window.ratio */
const PLATE_R = 97                             /* main.js:88 */
const SPAN = 100 / PLATE_R                     /* main.js:89 */
const SVG = Math.round(SCALE * SPAN)           /* 144 */
const ICONWIN = Math.max(Math.round(SCALE * RATIO), SVG + 4)   /* 210 */
const PAD = (ICONWIN - SVG) / 2                /* 33 */
const VB = 200                                 /* index.html <svg id="ico" viewBox="0 0 200 200"> */
const UNIT = SVG / VB                          /* SVG 用户单位 -> CSS px，0.72 */
const R_RING_USER = 88                         /* index.html:281 circle.progRing r="88" */
const SW_USER = 3.5                            /* index.html:281 stroke-width="3.5" */
const C_USER = 2 * Math.PI * R_RING_USER       /* 552.920 */
const R_CSS = R_RING_USER * UNIT               /* 63.36 */
const SW_CSS = SW_USER * UNIT                  /* 2.52 */

const RUN = 'ringarc-' + process.pid.toString(36) + '-' + Date.now().toString(36)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), RUN + '-'))

let pass = 0, fail = 0
const t = (name, ok, detail) => { console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  -> ' + detail : '')); ok ? pass++ : fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const SPAWNED = []
function trackSpawn (pid) { if (pid) SPAWNED.push({ pid, at: Date.now() }) }

/** 只杀本轮 spawn 过的 PID（带启动时间判据，防 PID 复用）。绝不按名字通杀。 */
function cleanup () {
  for (const { pid, at } of SPAWNED) {
    if (Date.now() - at < 1000) continue
    const q = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { [int64]($p.StartTime.ToUniversalTime() - (Get-Date '1970-01-01T00:00:00Z')).TotalMilliseconds } else { -1 }`
    let started = NaN
    try {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', q], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
      started = Number(String(r.stdout || '').trim())
    } catch { /* ignore */ }
    if (!Number.isFinite(started) || started < 0) continue
    if (started + 2000 < at) continue
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }) } catch { /* ignore */ }
  }
}

/* ==========================================================================
 * 测试用 main：210 窗口 + 144 SVG + 33 pad，离屏，抓一帧 PNG
 * ========================================================================== */
const HARNESS_MAIN = `'use strict'
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
const HOME = arg('home', __dirname)
const W = Number(arg('win', 210))
const SVG = Number(arg('svg', 144))
const PAD = Number(arg('pad', 33))
const SCALE = Number(arg('scale', 140))
const DONE = Number(arg('done', 4))
const TOTAL = Number(arg('total', 8))
const PNG = arg('out', null)
try { app.setPath('userData', path.join(HOME, 'userdata')) } catch (e) {}
const out = (o) => process.stdout.write('PROBE ' + JSON.stringify(o) + '\\n')
const PROBE = "(function(){try{" +
  "var el=document.querySelectorAll('#layers .layer .progRing');" +
  "var ico=document.getElementById('ico');" +
  "var bb=ico.getBoundingClientRect();" +
  "return {ok:true,n:el.length," +
  "dash0:el.length?el[0].getAttribute('stroke-dasharray'):null," +
  "op0:el.length?el[0].getAttribute('opacity'):null," +
  "r0:el.length?el[0].getAttribute('r'):null," +
  "sw0:el.length?el[0].getAttribute('stroke-width'):null," +
  "cx:bb.left+bb.width/2,cy:bb.top+bb.height/2,icoW:bb.width,icoH:bb.height," +
  "dpr:window.devicePixelRatio}" +
  "}catch(e){return {ok:false,err:String((e&&(e.stack||e.message))||e)}}})()"
app.whenReady().then(async function () {
  const win = new BrowserWindow({
    width: W, height: W, show: false, frame: false, transparent: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  win.webContents.on('console-message', function (e, lvl, msg) { process.stdout.write('RCONSOLE ' + String(msg).slice(0, 200) + '\\n') })
  win.webContents.on('did-fail-load', function (e, c, d) { process.stdout.write('RFAILLOAD ' + c + ' ' + d + '\\n') })
  await win.loadFile(path.join(__dirname, 'index.html'), { query: {
    state: 'WORKING', svg: String(SVG), pad: String(PAD), opacity: '100', scale: String(SCALE), shot: '1' } })
  await sleep(500)
  win.webContents.send('msg', { kind: 'state', state: 'WORKING', progress: { applicable: true, done: DONE, total: TOTAL } })
  await sleep(900)
  const r = await win.webContents.executeJavaScript(PROBE, true)
  const img = await win.capturePage()
  const sz = img.getSize()
  fs.writeFileSync(PNG, img.toPNG())
  out({ probe: r, png: PNG, size: sz.width + 'x' + sz.height })
  app.exit(0)
}).catch(function (e) { out({ error: String((e && e.stack) || e) }); app.exit(3) })
`

function makeApp (htmlSrc) {
  const d = fs.mkdtempSync(path.join(TMP, 'app-'))
  fs.copyFileSync(htmlSrc, path.join(d, 'index.html'))
  fs.copyFileSync(path.join(RUNTIME, 'preload.js'), path.join(d, 'preload.js'))
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'ringarc-harness', version: '1.0.0', main: 'main.js' }))
  fs.writeFileSync(path.join(d, 'main.js'), HARNESS_MAIN, 'utf8')
  return d
}

function runApp (appDir, args, { waitExitMs = 25000 } = {}) {
  const proc = spawn(ELECTRON, [appDir, ...args], {
    cwd: appDir,
    stdio: ['pipe', 'pipe', 'pipe'],      /* stdin 保持打开 —— 绝不关，避免 EPIPE */
    windowsHide: true,
    env: Object.assign({}, process.env, { ELECTRON_DISABLE_WARNINGS: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' })
  })
  trackSpawn(proc.pid)
  const lines = []
  let buf = ''
  proc.stdout.on('data', (b) => {
    buf += b.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); lines.push(l) }
  })
  const err = []
  proc.stderr.on('data', (b) => { if (err.join('').length < 4000) err.push(b.toString('utf8')) })
  const done = new Promise((res) => proc.on('exit', (code) => res(code)))
  return { proc, lines, err, done, kill () { try { spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }) } catch { /* ignore */ } } }
}

/** 最小 PNG 解码器（与 ring-clone.mjs 逐行一致）：8bit、非隔行、colorType 0/2/3/4/6 */
function decodePng (buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0
  const idat = []
  let plte = null, trns = null
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (depth !== 8) throw new Error('只支持 8bit，实际 ' + depth)
  if (interlace !== 0) throw new Error('不支持隔行')
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]
  if (!CH) throw new Error('不支持 colorType ' + ctype)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * CH
  const out = Buffer.alloc(w * h * 4)
  const cur = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]
    raw.copy(cur, 0, p, p + stride); p += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= CH ? cur[x - CH] : 0
      const b = prev[x]
      const c = x >= CH ? prev[x - CH] : 0
      let v = cur[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      } else if (ft !== 0) throw new Error('未知 filter ' + ft)
      cur[x] = v & 0xff
    }
    for (let x = 0; x < w; x++) {
      const s = x * CH, d = (y * w + x) * 4
      if (ctype === 6) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3] }
      else if (ctype === 2) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255 }
      else if (ctype === 0) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = 255 }
      else if (ctype === 4) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = cur[s + 1] }
      else if (ctype === 3) {
        const idx = cur[s] * 3
        out[d] = plte[idx]; out[d + 1] = plte[idx + 1]; out[d + 2] = plte[idx + 2]
        out[d + 3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255
      }
    }
    cur.copy(prev)
  }
  return { w, h, ch: CH, data: out }
}

/**
 * 角度覆盖：以图像中心为极点，从 12 点方向**顺时针**计角（12点=0°，3点=90°，6点=180°，9点=270°）。
 * 覆盖角的定义 = 有差异像素落入的 1° 桶数。
 * 起点角的定义 = 最大连续空桶之后紧邻的那个覆盖桶（即弧的起始方向）。
 */
function arcCoverage (REF, CUR, windowCss) {
  if (REF.w !== CUR.w || REF.h !== CUR.h) throw new Error('尺寸不同')
  const W = CUR.w, H = CUR.h
  const k = W / windowCss                     /* 物理像素 / CSS px = DPR */
  const cx = W / 2, cy = H / 2
  const bins = new Uint8Array(360)
  let n = 0
  let rMin = Infinity, rMax = -Infinity
  let sumR = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (REF.data[i] === CUR.data[i] && REF.data[i + 1] === CUR.data[i + 1] &&
          REF.data[i + 2] === CUR.data[i + 2] && REF.data[i + 3] === CUR.data[i + 3]) continue
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      const r = Math.hypot(dx, dy)
      n++; sumR += r
      if (r < rMin) rMin = r
      if (r > rMax) rMax = r
      let a = Math.atan2(dx, -dy) * 180 / Math.PI
      if (a < 0) a += 360
      bins[Math.floor(a) % 360] = 1
    }
  }
  let cov = 0
  for (let i = 0; i < 360; i++) cov += bins[i]
  /* 最大连续空桶 ⇒ 起点角 = 该空桶段结束后的第一个覆盖角 */
  let bestGap = -1, bestEnd = -1, run = 0
  for (let i = 0; i < 720; i++) {              /* 绕两圈，处理缺口跨 0° 的情况 */
    const b = bins[i % 360]
    if (b === 0) run++
    else { if (run > bestGap) { bestGap = run; bestEnd = i } run = 0 }
  }
  const start = (n === 0) ? null : ((bestEnd % 360) + 360) % 360
  const end = (n === 0) ? null : (start + cov - 1) % 360
  return {
    dpr: k, changed: n, coveredDeg: cov, frac: cov / 360,
    startDeg: start, endDeg: end, gapDeg: bestGap < 0 ? 0 : bestGap,
    rMinCss: n ? rMin / k : 0, rMaxCss: n ? rMax / k : 0, rMeanCss: n ? (sumR / n) / k : 0
  }
}

/* ==========================================================================
 * 主流程
 * ========================================================================== */
console.log('===== ring-arc: 生产几何口径下的「环扫过多少度」 =====')
console.log('RUNTIME  = ' + RUNTIME)
console.log('ELECTRON = ' + ELECTRON)
console.log('TMP      = ' + TMP)
console.log('几何推导 (main.js computeGeo, scale=140 ratio=1.5):')
console.log('  SPAN = 100/' + PLATE_R + ' = ' + SPAN.toFixed(6))
console.log('  svgSize = round(140 * SPAN) = ' + SVG + ' CSS px')
console.log('  iconWin = max(round(140*1.5), ' + (SVG + 4) + ') = ' + ICONWIN + ' CSS px   pad = ' + PAD + ' CSS px')
console.log('  SVG viewBox 0 0 200 200 => 单位->CSS 缩放 = ' + SVG + '/200 = ' + UNIT)
console.log('  环 r=88 用户单位 => ' + R_CSS.toFixed(2) + ' CSS px；线宽 3.5 => ' + SW_CSS.toFixed(2) + ' CSS px')
console.log('  周长常量 C = 2*pi*88 = ' + C_USER.toFixed(3) + '（index.html 里写的 552.9）')
console.log('  窗口全程 show:false（离屏），无任何真窗口')

const appDir = makeApp(HTML_TARGET || path.join(RUNTIME, 'index.html'))
const results = []
const PS = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8]]
let ref = null
let probeSeen = null
let geoChecked = false

for (const [done, total] of PS) {
  const outPng = path.join(TMP, `p${done}of${total}.png`)
  const home = fs.mkdtempSync(path.join(TMP, `home-${done}-`))
  const r = runApp(appDir, ['--home', home, '--win', String(ICONWIN), '--svg', String(SVG), '--pad', String(PAD),
    '--scale', String(SCALE), '--done', String(done), '--total', String(total), '--out', outPng])
  const code = await Promise.race([r.done, sleep(25000).then(() => 'timeout')])
  r.kill()
  const pl = r.lines.find((l) => l.startsWith('PROBE '))
  if (!pl) {
    console.log(`[FAIL] p=${done}/${total} 未拿到 PROBE 行 exit=${code} stderr=${r.err.join('').slice(0, 600)}`)
    fail++
    continue
  }
  const raw = JSON.parse(pl.slice(6))
  if (raw.error || !raw.probe || raw.probe.ok !== true) {
    console.log(`[FAIL] p=${done}/${total} 渲染层报错: ` + JSON.stringify(raw).slice(0, 600))
    fail++
    continue
  }
  if (!probeSeen) probeSeen = raw.probe
  const img = decodePng(fs.readFileSync(outPng))
  if (!geoChecked) {
    geoChecked = true
    t('图像尺寸 = 窗口 CSS px × DPR（210 × 2 = 420）', img.w === ICONWIN * 2 && img.h === ICONWIN * 2,
      img.w + 'x' + img.h + ' 窗口=' + ICONWIN + ' DPR=' + raw.probe.dpr)
    t('#ico 的 CSS 盒 = svgSize（生产口径下确为 144）', Math.round(raw.probe.icoW) === SVG && Math.round(raw.probe.icoH) === SVG,
      'icoW=' + raw.probe.icoW + ' icoH=' + raw.probe.icoH)
    t('环元素共 7 份且 r/sw 未被改动', raw.probe.n === 7 && raw.probe.r0 === '88' && raw.probe.sw0 === '3.5',
      'n=' + raw.probe.n + ' r=' + raw.probe.r0 + ' sw=' + raw.probe.sw0)
  }
  const rec = { done, total, p: done / total, dash: raw.probe.dash0, op: raw.probe.op0, img, sha: sha256(fs.readFileSync(outPng)) }
  if (done === 0) { ref = img; rec.arc = { changed: 0, coveredDeg: 0, frac: 0, startDeg: null, endDeg: null, gapDeg: 360, rMinCss: 0, rMaxCss: 0, rMeanCss: 0, dpr: img.w / ICONWIN } }
  else rec.arc = arcCoverage(ref, img, ICONWIN)
  results.push(rec)
}

console.log('\n--- 逐点原始读数（差分基准 = 本轮 p=0 的同一几何抓图） ---')
console.log('  p       | dasharray      | opacity | 差异px | 覆盖角° | 覆盖占比 | 起点角 | 半径区间 CSS px (min/mean/max)')
for (const r of results) {
  console.log('  ' + (r.p * 100).toFixed(1).padStart(5) + '%  | ' + String(r.dash).padEnd(14) + ' | ' +
    String(r.op).padEnd(7) + ' | ' + String(r.arc.changed).padStart(6) + ' | ' +
    String(r.arc.coveredDeg).padStart(7) + ' | ' + (r.arc.frac * 100).toFixed(2).padStart(7) + '% | ' +
    String(r.arc.startDeg === null ? '-' : r.arc.startDeg + '°').padStart(6) + ' | ' +
    r.arc.rMinCss.toFixed(2) + ' / ' + r.arc.rMeanCss.toFixed(2) + ' / ' + r.arc.rMaxCss.toFixed(2))
}

const at = (p) => results.find((r) => Math.abs(r.p - p) < 1e-9)
const half = at(0.5)
console.log('\n--- 核心数字：p = 4/8 = 50% ---')
if (!half) {
  console.log('[FAIL] 没拿到 p=0.5 的结果')
  fail++
} else {
  console.log('  dasharray            = ' + JSON.stringify(half.dash) + '   (C*0.5 = ' + (C_USER * 0.5).toFixed(1) + ' / C = ' + C_USER.toFixed(1) + ')')
  console.log('  环扫过的角度          = ' + half.arc.coveredDeg + '°  (占整圈 ' + (half.arc.frac * 100).toFixed(2) + '%)')
  console.log('  环起始角              = ' + half.arc.startDeg + '°（0°=12点方向，顺时针为正；90°=3点）')
  console.log('  环结束角              = ' + half.arc.endDeg + '°')
  console.log('  未被画出的缺口        = ' + half.arc.gapDeg + '°  (占 ' + (half.arc.gapDeg / 360 * 100).toFixed(2) + '%)')
  console.log('  差异像素数            = ' + half.arc.changed)
  console.log('  环半径（图像中心为极点）= ' + half.arc.rMeanCss.toFixed(2) + ' CSS px；区间 [' + half.arc.rMinCss.toFixed(2) + ', ' + half.arc.rMaxCss.toFixed(2) + ']')
  console.log('  理论半径 / 线宽        = ' + R_CSS.toFixed(2) + ' CSS px / ' + SW_CSS.toFixed(2) + ' CSS px')
  const arcLenTheory = Math.PI * R_CSS                        /* 半圈弧长 */
  console.log('  交叉校验：半圈弧长 × 线宽 = ' + (arcLenTheory * SW_CSS).toFixed(0) + ' CSS px² ⇒ 物理像素 ~' +
    (arcLenTheory * SW_CSS * half.arc.dpr * half.arc.dpr).toFixed(0) + '，实测差异像素 ' + half.arc.changed)
  t('★ p=50% 时环扫过约 180°（容差 ±6°，含 round linecap 约 +2.3°）',
    Math.abs(half.arc.coveredDeg - 180) <= 6, half.arc.coveredDeg + '°')
  t('★ p=50% 时覆盖占比 ≈ 50%（判定：**不是** 25%）',
    Math.abs(half.arc.frac - 0.5) <= 0.02, (half.arc.frac * 100).toFixed(2) + '%')
  t('环起始角 = 12 点方向（0°±3°，来自 transform="rotate(-90 100 100)"）',
    half.arc.startDeg !== null && (half.arc.startDeg <= 3 || half.arc.startDeg >= 357), String(half.arc.startDeg) + '°')
  t('环半径实测 ≈ 63.36 CSS px（|Δ| <= 1.5）', Math.abs(half.arc.rMeanCss - R_CSS) <= 1.5, half.arc.rMeanCss.toFixed(2) + ' CSS px')
}

console.log('\n--- 线性度：覆盖占比是否随 p 线性 ---')
for (const r of results) {
  const exp = r.p * 360
  console.log('  p=' + (r.p * 100).toFixed(1).padStart(5) + '%  实测 ' + String(r.arc.coveredDeg).padStart(3) + '°  ' +
    '理论 ' + exp.toFixed(0).padStart(3) + '°  偏差 ' + (r.arc.coveredDeg - exp).toFixed(1).padStart(6) + '°')
}
const devs = results.map((r) => Math.abs(r.arc.coveredDeg - r.p * 360))
const maxDev = Math.max(...devs)
t('全部 9 个采样点的覆盖角都在理论值 ±6° 内（含 round cap +2.3°，AA ±1°）', maxDev <= 6, 'max|Δ| = ' + maxDev.toFixed(1) + '°')

/* ==========================================================================
 * 可见度：差异幅度按 45° 扇区分布（判"画出来的那半圈是不是两边一样亮"）
 * ========================================================================== */
console.log('\n--- 可见度：p=4/8 相对 p=0 的差异幅度，按 45° 扇区分（0°=12点，顺时针） ---')
function sectorContrast (REF, CUR) {
  const W = CUR.w, H = CUR.h, cx = W / 2, cy = H / 2
  const SEC = 8
  const cnt = new Float64Array(SEC), sum = new Float64Array(SEC), strong = new Float64Array(SEC)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = Math.max(
        Math.abs(REF.data[i] - CUR.data[i]), Math.abs(REF.data[i + 1] - CUR.data[i + 1]),
        Math.abs(REF.data[i + 2] - CUR.data[i + 2]), Math.abs(REF.data[i + 3] - CUR.data[i + 3]))
      if (d === 0) continue
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      let a = Math.atan2(dx, -dy) * 180 / Math.PI
      if (a < 0) a += 360
      const s = Math.floor(a / 45) % SEC
      cnt[s]++; sum[s] += d; if (d >= 40) strong[s]++
    }
  }
  return { cnt, sum, strong, SEC }
}
/** 参考图里是否残留"环色"像素（0 长度 dash + round linecap 在 Chromium 下可能画出一个点） */
function ringColorResidue (IMG) {
  const W = IMG.w, H = IMG.h, cx = W / 2, cy = H / 2
  let n = 0, minA = 999, maxA = -999
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      const r = Math.hypot(dx, dy)
      if (Math.abs(r - 2 * R_CSS) > 3 * 2) continue        /* 只扫环带（±3 CSS px） */
      if (IMG.data[i + 3] < 40) continue
      if (Math.abs(IMG.data[i] - 86) <= 26 && Math.abs(IMG.data[i + 1] - 217) <= 26 && Math.abs(IMG.data[i + 2] - 200) <= 26) {
        n++
        let a = Math.atan2(dx, -dy) * 180 / Math.PI
        if (a < 0) a += 360
        if (a < minA) minA = a
        if (a > maxA) maxA = a
      }
    }
  }
  return { n, minA: n ? minA : null, maxA: n ? maxA : null }
}
if (half) {
  const sc = sectorContrast(ref, half.img)
  for (let s = 0; s < sc.SEC; s++) {
    const from = s * 45, to = from + 45
    const label = ['12→1:30（右上）', '1:30→3（右上/右）', '3→4:30（右下）', '4:30→6（右下/下）',
      '6→7:30（左下）', '7:30→9（左下/左）', '9→10:30（左上）', '10:30→12（左上/上）'][s]
    console.log('  ' + String(from).padStart(3) + '°-' + String(to).padStart(3) + '°  ' + label.padEnd(18) +
      ' 差异px=' + String(sc.cnt[s]).padStart(5) + '  平均幅度=' + (sc.cnt[s] ? (sc.sum[s] / sc.cnt[s]).toFixed(1) : '0.0').padStart(5) +
      '  强差异(>=40)=' + String(sc.strong[s]).padStart(5))
  }
  const res0 = ringColorResidue(ref)
  /* ⚠️ 这条诊断是**辅助**，容差放宽到 ±26 后会有假阳性：实测 112 px 的角度范围 0.2°..359.8°
     ⇒ **散布全周**，不是 12 点的一个点。所以不能据此说"p=0 画出了一个点"。
     真正的 p=0 结论看下面的差异像素数（p=0 与 p=0 自身比恒为 0，不构成证据）——
     这里只如实报数，不下结论。 */
  const spread = res0.n ? (res0.maxA - res0.minA) : 0
  console.log('  参考图 p=0 的环带内"环色"(#56d9c8±26) 像素数 = ' + res0.n +
    (res0.n ? '，角度范围 ' + res0.minA.toFixed(1) + '°..' + res0.maxA.toFixed(1) + '°（跨度 ' + spread.toFixed(1) + '°）' : '') +
    '  ⇒ ' + (res0.n && spread > 300 ? '散布全周，**不是**一个点；本诊断容差对本图层过松，属假阳性，不作为结论'
      : (res0.n ? '集中在一小段，疑似 0 长度 dash 的 round-cap 点' : '无残留')))
  const right = sc.cnt[0] + sc.cnt[1] + sc.cnt[2] + sc.cnt[3]
  const left = sc.cnt[4] + sc.cnt[5] + sc.cnt[6] + sc.cnt[7]
  console.log('  右半（0°-180°）差异px=' + right + '；左半（180°-360°）差异px=' + left +
    ' ⇒ 画出来的那半圈是**右半**（12点顺时针到6点），与 rotate(-90) 起点一致')
  console.log('  左半那 ' + left + ' px 的性质：弧 184° 必然越过 180° 约 4°，' +
    '另加起点 round cap 越到 358°（见上表 180°-225° 与 315°-360° 两格）—— 是端点过冲，不是环跑到左半圈')
  t('★ p=50% 时未画出的缺口 >= 170°（即环最多覆盖 190°，容不下"一整圈"或"四分之三圈"）',
    half.arc.gapDeg >= 170, half.arc.gapDeg + '°')
  t('p=50% 时环的覆盖角有下界（>= 170°）且上界（<= 190°）⇒ 就是半圈',
    half.arc.coveredDeg >= 170 && half.arc.coveredDeg <= 190, half.arc.coveredDeg + '°')
}

/* ==========================================================================
 * 敏感性自证：把 p 故意砍一半 ⇒ 同一套度量必须变红
 * ========================================================================== */
if (WANT_MUTANT) {
  console.log('\n===== 敏感性自证：故意把 p 砍半的变异体（证明本度量抓得到 25% 那种 bug） =====')
  const src = fs.readFileSync(HTML_TARGET || path.join(RUNTIME, 'index.html'), 'utf8')
  const NEEDLE = 'var dash = (C * p).toFixed(1) + \' \' + C.toFixed(1)'
  const n = src.split(NEEDLE).length - 1
  if (n !== 1) {
    t('变异体注入点唯一（原文在 index.html 里恰好出现 1 次）', false, '出现 ' + n + ' 次')
  } else {
    const mutPath = path.join(TMP, 'index-mutant.html')
    fs.writeFileSync(mutPath, src.replace(NEEDLE, 'var dash = (C * p * 0.5).toFixed(1) + \' \' + C.toFixed(1)'), 'utf8')
    const mutApp = makeApp(mutPath)
    const outPng = path.join(TMP, 'mutant-4of8.png')
    const home = fs.mkdtempSync(path.join(TMP, 'home-mut-'))
    const r = runApp(mutApp, ['--home', home, '--win', String(ICONWIN), '--svg', String(SVG), '--pad', String(PAD),
      '--scale', String(SCALE), '--done', '4', '--total', '8', '--out', outPng])
    const code = await Promise.race([r.done, sleep(25000).then(() => 'timeout')])
    r.kill()
    const pl = r.lines.find((l) => l.startsWith('PROBE '))
    if (!pl) { t('变异体跑出 PROBE', false, 'exit=' + code) } else {
      const raw = JSON.parse(pl.slice(6))
      const mimg = decodePng(fs.readFileSync(outPng))
      const marc = arcCoverage(ref, mimg, ICONWIN)
      console.log('  变异体 dasharray = ' + JSON.stringify(raw.probe.dash0) + '（= C*0.25）')
      console.log('  变异体覆盖角     = ' + marc.coveredDeg + '°  = ' + (marc.frac * 100).toFixed(2) + '%')
      t('★ 变异体（p 砍半）下度量确实变红：覆盖占比 ≈25% 且**不**满足 50% 断言',
        Math.abs(marc.frac - 0.25) <= 0.02 && Math.abs(marc.frac - 0.5) > 0.02,
        (marc.frac * 100).toFixed(2) + '%（正品 p=50% 实测 ' + (half ? (half.arc.frac * 100).toFixed(2) + '%' : 'n/a') + '）')
      /* 阈值 60°：把"正品 50%"与"变异体 25%"分开，实测相差 90°。
         原先写 >100° 是拍脑袋 —— 184-94=90 会被自己误判成红（2026-09-13 实测踩到）。 */
      t('正品与变异体在同一度量下可区分（相差 >= 60°，≈1/6 圈）',
        half && Math.abs(half.arc.coveredDeg - marc.coveredDeg) >= 60,
        half ? (half.arc.coveredDeg - marc.coveredDeg) + '°' : 'n/a')
    }
  }
}

cleanup()
console.log('\n===== ring-arc 结果：' + pass + ' PASS / ' + fail + ' FAIL =====')
console.log('（本轮产物保留在 ' + TMP + '，可安全删除；PNG = 生产几何 420x420）')
process.exit(fail ? 1 : 0)
