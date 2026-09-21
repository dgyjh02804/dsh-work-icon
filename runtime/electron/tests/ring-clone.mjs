#!/usr/bin/env node
/* ============================================================================
 * ring-clone.mjs —— 进度环「被渲染的克隆」回归断言
 *
 * ① 它断言什么
 *    被渲染的那一份进度环（`#layers .layer circle[r="88"]`，共 7 个）的
 *    `stroke-dasharray` 会随 host 下发的 progress 变化：
 *        p = 1/6 → "92.2 552.9"      p = 5/6 → "460.8 552.9"
 *    并且 `opacity` 同时被写为 "0.95"；再附带两条防回归的静态断言：
 *        · 文档里不再存在 id 为 progRing 的元素（重复 id 已根除）
 *        · 每个状态层里恰好有 1 份 class 为 progRing 的圆（共 7 份）
 *
 * ② 为什么它能抓到这次的 bug
 *    模板 `<g id="base-h2">` 位于 `<defs>` 内 —— **defs 的内容永远不绘制**；
 *    而七个状态层各 `cloneNode(true)` 复制 `base.children` 时会**把 id 一起复制**。
 *    ⇒ 文档里共 8 个同名 id 的圆（1 个 defs 母本 + 7 个可见克隆）。
 *    旧代码 `v2UpdateRing()` 与 SUCCESS 爆散块都用 `document.getElementById('progRing')`，
 *    它只能取到**文档序第一个 = defs 母本** ⇒ 写它没有任何视觉效果；
 *    7 个可见克隆恒停在标记里的 `stroke-dasharray="0 552.9" opacity="0"` ⇒ 环恒不可见。
 *    ⇒ 「被渲染的那一份的 dasharray 会随 progress 变化」在旧代码上**必然为红**。
 *
 *    ★ 选择器刻意用 `circle[r="88"]` 而不是 `.progRing` / `#progRing`：
 *      这个**几何属性在修复前后都存在**，所以同一个测试同时适用于修复前与修复后 ——
 *      修复前红、修复后绿，且红的原因正是这个 bug（而不是"选择器找不到元素"）。
 *
 * ③ 运行命令（在 runtime/electron 下）
 *      node tests/ring-clone.mjs
 *    （也可从插件包根：node runtime/electron/tests/ring-clone.mjs）
 *
 * ④ 可选：--pixels 额外跑像素铁证（用**现成的** --shot / --shot-payload 通道，
 *    离屏抓 p≈1/6 与 p≈5/6 两张图，比较环带区域差异）。
 *    默认可关闭，因为它需要多起两个 electron 进程（约 4 秒）。
 *
 * 设计说明（给维护者）
 *    · 本文件唯一"发明的"东西是一台 **20 行的测试用 main 进程**（见 HARNESS_MAIN）。
 *      目的是拿到 `webContents.executeJavaScript` 以直接读渲染层 DOM。
 *      被测的 index.html 与 preload.js 是**产品文件的逐字节副本**，
 *      所以断言跑的仍是真实代码路径（真实消息通道 + 真实 v2UpdateRing）。
 *    · 进程纪律：全部 stdio 走 pipe（**绝不关 stdin** —— 真实 main.js 监听 stdin，
 *      关掉会触发 EPIPE 日志风暴）；userData / helper.log 一律钉在本轮独有的临时目录；
 *      收尾**只按本轮 PID** 杀（带启动时间判据，防 PID 复用），绝不按进程名通杀。
 * ========================================================================== */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/* 拷进 runtime/electron/tests/ 后 HERE 就是 tests/，RUNTIME 自然等于 runtime/electron。
   RINGCLONE_RUNTIME 只是给"在别处跑同一个文件做对照实验"留的口子（例如修复前/后两份副本）。 */
const RUNTIME = path.resolve(process.env.RINGCLONE_RUNTIME || path.join(HERE, '..'))
const WANT_PIXELS = process.argv.includes('--pixels') || process.argv.includes('--pixel')

const CANDIDATES = [
  path.join(RUNTIME, 'node_modules', 'electron', 'dist', 'electron.exe'),
  'C:\\Users\\david\\Desktop\\构建\\temp4\\spike\\electron\\node_modules\\electron\\dist\\electron.exe'
]
const ELECTRON = CANDIDATES.find((p) => fs.existsSync(p))
if (!ELECTRON) { console.error('找不到 electron.exe（试过：' + CANDIDATES.join(' | ') + '）'); process.exit(2) }

/* ---- 本轮独有的临时根：产物与 userData 都关在这里 ---- */
const RUN = 'ringclone-' + process.pid.toString(36) + '-' + Date.now().toString(36)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), RUN + '-'))

let pass = 0, fail = 0
const t = (name, ok, detail) => { console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  -> ' + detail : '')); ok ? pass++ : fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
    if (!Number.isFinite(started) || started < 0) continue   /* 已不存在 */
    if (started + 2000 < at) continue                        /* 比我们 spawn 它还早 ⇒ PID 被复用，跳过 */
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }) } catch { /* ignore */ }
  }
}

/* ==========================================================================
 * 测试用 main 进程（唯一"发明"的部分；preload.js 与 index.html 是产品副本）
 * ========================================================================== */
const HARNESS_MAIN = `'use strict'
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
const HOME = arg('home', __dirname)
const INDEX = arg('index', path.join(__dirname, 'index.html'))
try { app.setPath('userData', path.join(HOME, 'userdata')) } catch (e) {}
const out = (o) => process.stdout.write('PROBE ' + JSON.stringify(o) + '\\n')
/* 探针在**页面内**用 try/catch 包住：出错时把真实 message/stack 带回来，而不是只得到一个
   "Script failed to execute"。环按 **几何属性 r=88 在 JS 里筛**（不使用 [r="88"] 属性选择器，
   彻底避开引号嵌套）；该属性修复前后都存在 ⇒ 同一个探针两版通用。 */
const PROBE = "(function(){try{" +
  "var ic=document.getElementById('ico');" +
  "var cand=ic.querySelectorAll('#layers .layer circle');" +
  "var els=[];for(var i=0;i<cand.length;i++){if(cand[i].getAttribute('r')==='88')els.push(cand[i]);}" +
  "var all=[];for(var j=0;j<els.length;j++)all.push(els[j].getAttribute('stroke-dasharray')+'|'+els[j].getAttribute('opacity'));" +
  "return {ok:true,n:els.length," +
  "dash0:els.length?els[0].getAttribute('stroke-dasharray'):null," +
  "op0:els.length?els[0].getAttribute('opacity'):null," +
  "all:all," +
  "idsInDoc:document.querySelectorAll('[id=progRing]').length," +
  "idsInLayers:document.querySelectorAll('#layers .layer [id=progRing]').length," +
  "classInLayers:ic.querySelectorAll('.layer .progRing').length," +
  "defsClassRings:document.querySelectorAll('defs .progRing').length}" +
  "}catch(e){return {ok:false,err:String((e&&(e.stack||e.message))||e)}}})()"
app.whenReady().then(async function () {
  const win = new BrowserWindow({
    width: 144, height: 144, show: false, frame: false, transparent: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  win.webContents.on('console-message', function (e, lvl, msg) { process.stdout.write('RCONSOLE ' + String(msg).slice(0, 220) + '\\n') })
  win.webContents.on('did-fail-load', function (e, c, d) { process.stdout.write('RFAILLOAD ' + c + ' ' + d + '\\n') })
  await win.loadFile(INDEX, { query: { state: 'WORKING', svg: '144', pad: '0', opacity: '100', scale: '140', shot: '1' } })
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
  async function safe (src) {
    try { return { ok: true, v: await win.webContents.executeJavaScript(src, true) } }
    catch (e) { return { ok: false, err: String((e && (e.message || e)) || e) } }
  }
  const sanity = await safe('1+1')
  const send = (done, total) => win.webContents.send('msg', { kind: 'state', state: 'WORKING', progress: { applicable: true, done: done, total: total } })
  await sleepMs(400)
  const before = await safe(PROBE)
  send(1, 6); await sleepMs(400)
  const r1 = await safe(PROBE)
  send(5, 6); await sleepMs(400)
  const r5 = await safe(PROBE)
  out({ page: INDEX, sanity: sanity, before: before, p1of6: r1, p5of6: r5 })
  app.exit(0)
}).catch(function (e) { out({ error: String((e && e.stack) || e) }); app.exit(3) })
`

/** 起一份 electron（app 目录 = appDir），stdout 按行回调；stdin 保持打开绝不关 */
function runApp (appDir, args, { onLine, waitExitMs = 20000 } = {}) {
  const proc = spawn(ELECTRON, [appDir, ...args], {
    cwd: appDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: Object.assign({}, process.env, { ELECTRON_DISABLE_WARNINGS: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' })
  })
  trackSpawn(proc.pid)
  const lines = []
  const err = []
  let buf = ''
  proc.stdout.on('data', (b) => {
    buf += b.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); lines.push(l); onLine && onLine(l) }
  })
  proc.stderr.on('data', (b) => { if (err.join('').length < 6000) err.push(b.toString('utf8')) })
  const done = new Promise((res) => proc.on('exit', (code) => res(code)))
  return { proc, lines, err, done, killed: false, kill () { this.killed = true; try { spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }) } catch { /* ignore */ } } }
}

/** 做一个临时 app 目录：index.html / preload.js 是产品文件的逐字节副本 */
function makeApp (opts) {
  const d = fs.mkdtempSync(path.join(TMP, 'app-'))
  const srcHtml = opts.html || path.join(RUNTIME, 'index.html')
  fs.copyFileSync(srcHtml, path.join(d, 'index.html'))
  fs.copyFileSync(path.join(RUNTIME, 'preload.js'), path.join(d, 'preload.js'))
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'ringclone-harness', version: '1.0.0', main: opts.main || 'main.js' }))
  if (opts.writeMain) fs.writeFileSync(path.join(d, opts.main || 'main.js'), opts.writeMain, 'utf8')
  else fs.copyFileSync(path.join(RUNTIME, 'main.js'), path.join(d, opts.main || 'main.js'))
  return d
}
function tmpHome (tag) { const d = fs.mkdtempSync(path.join(TMP, 'home-' + tag + '-')); return d }

/* ==========================================================================
 * 1) DOM 断言
 * ========================================================================== */
console.log('===== ring-clone: DOM 断言（被渲染的 clone 的 dasharray 必须随 progress 变） =====')
console.log('RUNTIME  = ' + RUNTIME)
console.log('ELECTRON = ' + ELECTRON)
console.log('TMP      = ' + TMP)

const htmlTarget = process.argv.find((a) => a.startsWith('--html=')) ? process.argv.find((a) => a.startsWith('--html=')).slice(7) : null
const appDir = makeApp({ writeMain: HARNESS_MAIN, html: htmlTarget, main: 'main.js' })
const home1 = tmpHome('dom')
const r = runApp(appDir, ['--home', home1])
const code = await Promise.race([r.done, sleep(30000).then(() => 'timeout')])
const probeLine = r.lines.find((l) => l.startsWith('PROBE '))
r.kill()

if (!probeLine) {
  t('拿到渲染层 DOM 探针', false, 'stdout 无 PROBE 行；exit=' + code + '；前几行：' + JSON.stringify(r.lines.slice(0, 4)))
  console.log('  --- app stderr（前 1500 字）---\n' + r.err.join('').slice(0, 1500))
  console.log('  --- app dir = ' + appDir + ' ---')
} else {
  const RAW = JSON.parse(probeLine.slice(6))
  const un = (x) => (x && x.ok === true ? x.v : null)
  const bad = [['sanity', RAW.sanity], ['before', RAW.before], ['p1of6', RAW.p1of6], ['p5of6', RAW.p5of6]]
    .filter(([, x]) => !x || x.ok !== true)
  if (RAW.error || bad.length) {
    t('渲染层未抛错', false, (RAW.error || bad.map(([k, x]) => k + ': ' + (x && x.err)).join(' | ')).slice(0, 500))
    console.log('  --- renderer console ---\n' + r.lines.filter((l) => l.startsWith('RCONSOLE') || l.startsWith('RFAILLOAD')).slice(0, 12).join('\n'))
    console.log('  --- app stderr（前 1200 字）---\n' + r.err.join('').slice(0, 1200))
  } else {
    const P = { before: un(RAW.before), p1of6: un(RAW.p1of6), p5of6: un(RAW.p5of6) }
    t('executeJavaScript 可用（sanity 1+1 === 2）', un(RAW.sanity) === 2, 'sanity=' + JSON.stringify(un(RAW.sanity)))
    const exp1 = '92.2 552.9', exp5 = '460.8 552.9'
    console.log('  p1/6 : n=' + P.p1of6.n + ' dash0=' + JSON.stringify(P.p1of6.dash0) + ' op0=' + JSON.stringify(P.p1of6.op0))
    console.log('  p5/6 : n=' + P.p5of6.n + ' dash0=' + JSON.stringify(P.p5of6.dash0) + ' op0=' + JSON.stringify(P.p5of6.op0))
    console.log('  文档里 [id=progRing] 数 = ' + P.p5of6.idsInDoc + '；#layers 内 .progRing 数 = ' + P.p5of6.classInLayers + '；#layers 内 [id=progRing] 数 = ' + P.p5of6.idsInLayers)
    console.log('  p1/6 全部 7 份: ' + JSON.stringify(P.p1of6.all))

    t('存在被渲染的进度环（#layers .layer circle[r="88"] 共 7 份）', P.p5of6.n === 7, 'n=' + P.p5of6.n)
    t('★ 被渲染的那一份 dasharray 随 progress 变化（1/6 -> 5/6）',
      P.p1of6.dash0 !== P.p5of6.dash0,
      JSON.stringify(P.p1of6.dash0) + ' -> ' + JSON.stringify(P.p5of6.dash0))
    t('p=1/6 时 dasharray 精确等于 ' + exp1, P.p1of6.dash0 === exp1, JSON.stringify(P.p1of6.dash0))
    t('p=5/6 时 dasharray 精确等于 ' + exp5, P.p5of6.dash0 === exp5, JSON.stringify(P.p5of6.dash0))
    t('p=1/6 时 opacity = 0.95（环可见）', P.p1of6.op0 === '0.95', JSON.stringify(P.p1of6.op0))
    t('七份克隆全部被写到（不是只写一份）',
      P.p5of6.all.length === 7 && P.p5of6.all.every((x) => x === exp5 + '|0.95'),
      JSON.stringify(P.p5of6.all))
    t('文档里不再有 id=progRing（重复 id 已根除）', P.p5of6.idsInDoc === 0, 'idsInDoc=' + P.p5of6.idsInDoc)
    t('每个状态层恰好 1 份 .progRing', P.p5of6.classInLayers === 7, 'classInLayers=' + P.p5of6.classInLayers)
    t('#layers 内没有 id=progRing（选择目标不再是 id）', P.p5of6.idsInLayers === 0, 'idsInLayers=' + P.p5of6.idsInLayers)
    t('.progRing 的选择范围没漏到 defs（.layer 内恰好 7 份 = circle[r=88] 的份数）',
      P.p5of6.classInLayers === P.p5of6.n && P.p5of6.n === 7,
      'classInLayers=' + P.p5of6.classInLayers + ' n=' + P.p5of6.n + ' defsClassRings=' + P.p5of6.defsClassRings)
    console.log('  （修复前基线：n=' + P.before.n + ' dash0=' + JSON.stringify(P.before.dash0) +
      ' op0=' + JSON.stringify(P.before.op0) + ' idsInDoc=' + P.before.idsInDoc + '）')
  }
}

/* ==========================================================================
 * 2) 可选：像素铁证（走现成的 --shot / --shot-payload 通道，离屏）
 * ========================================================================== */
if (WANT_PIXELS) {
  console.log('\n===== ring-clone: 像素铁证（--shot 144 离屏抓 p=1/6 与 p=5/6） =====')
  const appPix = makeApp({ html: htmlTarget, main: 'main.js' })
  const shots = {}
  for (const [tag, done] of [['p1', 1], ['p5', 5]]) {
    const pl = path.join(TMP, 'payload-' + tag + '.json')
    fs.writeFileSync(pl, JSON.stringify({ state: { state: 'WORKING', progress: { applicable: true, done, total: 6 } } }))
    const outPng = path.join(TMP, 'shot-' + tag + '.png')
    const homeP = tmpHome('px-' + tag)
    const rr = runApp(appPix, ['--shot', '144', '--ratio', '1.5', '--shot-payload', pl, '--state', 'WORKING',
      '--out', outPng, '--home', homeP, '--no-config', '--settle-ms', '700', '--log', path.join(TMP, 'px-' + tag + '.log')])
    const c = await Promise.race([rr.done, sleep(25000).then(() => 'timeout')])
    rr.kill()
    const okPng = fs.existsSync(outPng) && fs.statSync(outPng).size > 0
    t('抓图 ' + tag + ' 生成', okPng, okPng ? fs.statSync(outPng).size + ' B  sha256=' + sha256(fs.readFileSync(outPng)) + ' exit=' + c : 'exit=' + c)
    if (okPng) shots[tag] = outPng
  }
  if (shots.p1 && shots.p5) {
    const A = decodePng(fs.readFileSync(shots.p1))
    const B = decodePng(fs.readFileSync(shots.p5))
    const cmp = ringBandDiff(A, B)
    console.log('  图像: ' + A.w + 'x' + A.h + ' ch=' + A.ch + '（窗口 144x144 CSS px ⇒ DPR=' + cmp.dpr + '）')
    console.log('  环带（圆心=图像中心，|r-' + cmp.rExpectCss + '| <= ' + cmp.halfCss + ' CSS px）: ' + cmp.diffPct.toFixed(3) + '% 差异（' + cmp.diff + '/' + cmp.total + ' px）')
    console.log('  全图差异: ' + cmp.diffAllPct.toFixed(3) + '%')
    console.log('  差异像素的半径区间（CSS px）: r ∈ [' + cmp.rMinCss.toFixed(2) + ', ' + cmp.rMaxCss.toFixed(2) + ']')
    console.log('  全图差异像素数 = ' + Math.round(cmp.diffAllPct * A.w * A.h / 100) + '；环带内差异 = ' + cmp.diff +
      (Math.abs(cmp.diffAllPct * A.w * A.h / 100 - cmp.diff) < 1 ? '（**两者相等 ⇒ 这张载荷下唯一随 progress 变化的像素就是环**）' : ''))
    t('环带区域 p=1/6 vs p=5/6 有显著差异（>0.5%）', cmp.diffPct > 0.5, cmp.diffPct.toFixed(3) + '%')
    t('差异集中在环半径附近（50 < r < 75 CSS px）', cmp.rMinCss > 50 && cmp.rMaxCss < 75,
      '[' + cmp.rMinCss.toFixed(2) + ', ' + cmp.rMaxCss.toFixed(2) + '] CSS px')
  }
}

cleanup()
console.log('\n===== ring-clone 结果：' + pass + ' PASS / ' + fail + ' FAIL =====')
console.log('（临时产物保留在 ' + TMP + '，可安全删除）')
process.exit(fail ? 1 : 0)

/* ---------------------------------------------------------------- 工具 ---- */
import crypto from 'node:crypto'
function sha256 (buf) { return crypto.createHash('sha256').update(buf).digest('hex') }

/** 最小 PNG 解码器：8bit、非隔行、colorType 0/2/3/4/6。返回 {w,h,ch,data}（data 为 RGBA） */
function decodePng (buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0
  const idat = []
  let plte = null, trns = null
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      depth = data[8]; ctype = data[9]; interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
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
 * 环带差异：圆心取图像中心；环半径由"几何条件"算出并**按实际 DPR 缩放**：
 *   SVG 渲染 144 CSS px，viewBox 200 ⇒ 缩放 0.72；环 r=88 ⇒ 屏幕半径 88*0.72 = 63.36 CSS px；
 *   线宽 3.5*0.72 = 2.52 CSS px ⇒ 半宽 1.26 CSS px；再各留 1.5 CSS px 抗锯齿余量 ⇒ 半宽 2.76 CSS px。
 *   capturePage() 返回的是**物理像素**（本机 device-scale-factor=2 ⇒ 144 CSS px 的窗口出 288×288），
 *   所以 k = 图宽 / 144 就是 DPR，所有半径都要乘 k。报告统一换算回 CSS px，便于核对几何。
 */
function ringBandDiff (A, B, CSS_SIZE = 144, R_CSS = 63.36, HALF_CSS = 2.76) {
  if (A.w !== B.w || A.h !== B.h) throw new Error('尺寸不同')
  const k = A.w / CSS_SIZE
  const R = R_CSS * k, HALF = HALF_CSS * k
  const cx = A.w / 2, cy = A.h / 2
  let diff = 0, total = 0, diffAll = 0
  let rMin = Infinity, rMax = -Infinity
  for (let y = 0; y < A.h; y++) {
    for (let x = 0; x < A.w; x++) {
      const i = (y * A.w + x) * 4
      const d = A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] ||
                A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d) {
        diffAll++
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r)
      }
      if (Math.abs(r - R) <= HALF) { total++; if (d) diff++ }
    }
  }
  return {
    dpr: k, diff, total,
    diffPct: total ? (diff / total) * 100 : 0,
    diffAllPct: (diffAll / (A.w * A.h)) * 100,
    rMinCss: Number.isFinite(rMin) ? rMin / k : 0,
    rMaxCss: Number.isFinite(rMax) ? rMax / k : 0,
    rExpectCss: R_CSS, halfCss: HALF_CSS
  }
}
