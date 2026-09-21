/* h2render.mjs —— 供 render-refs.mjs / selftest.mjs 共用的渲染底座
 * 事实来源：本机 dpr=2.0。所有截图走 Playwright + 系统 Edge(Chromium)，deviceScaleFactor 显式可控。
 * 不用 vision_html_screenshot：实测它 hasAlpha=false（透明处被合成成白底）、dpr 固定 1.0。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire('C:/Users/david/.dsh/profiles/')
export const sharp = require('sharp')

const PW_ROOT = 'C:/Users/david/.dsh/profiles/web/'
let _pw = null
export function playwright() {
  if (!_pw) {
    const r = createRequire(PW_ROOT)
    _pw = r('playwright')
  }
  return _pw
}

let _server = null, _base = null, _browser = null

export async function startServer(root = __dirname) {
  if (_server) return _base
  const mime = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png', '.json': 'application/json; charset=utf-8'
  }
  _server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      const rel = decodeURIComponent(u.pathname)
      const file = path.resolve(root, '.' + rel)
      if (!file.startsWith(path.resolve(root))) { res.writeHead(403); return res.end('forbidden') }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found') }
      res.writeHead(200, { 'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' })
      fs.createReadStream(file).pipe(res)
    } catch (e) { res.writeHead(500); res.end('err') }
  })
  await new Promise((ok, no) => { _server.once('error', no); _server.listen(0, '127.0.0.1', ok) })
  _base = `http://127.0.0.1:${_server.address().port}/`
  return _base
}

/* ============================================================================
 * 硬约束：一律 headless。后台测试绝不允许弹出可见浏览器窗口打扰用户。
 * 唯一出口是显式设置环境变量 H2_ALLOW_HEADFUL=1（会大声警告）。
 * 需要真实 GPU 合成等 headless 做不到的事时，先问用户，不要自己开这个开关。
 * ========================================================================== */
const HEADLESS = assertHeadless()
function assertHeadless() {
  if (process.env.H2_ALLOW_HEADFUL === '1') {
    console.warn('[警告] H2_ALLOW_HEADFUL=1 —— 本次会启动**可见**浏览器窗口，会抢占桌面焦点、干扰用户。')
    console.warn('[警告] 仅在你已明确向用户申请并获准后使用；用完请立刻结束进程。')
    return false
  }
  return true
}
const HEADLESS_ARGS = ['--force-color-profile=srgb', '--disable-lcd-text']

export async function getBrowser() {
  if (!_browser) {
    const { chromium } = playwright()
    _browser = await chromium.launch({ channel: 'msedge', headless: HEADLESS, args: HEADLESS_ARGS })
  }
  return _browser
}

/** 收尾自检：确认浏览器进程已经真的关掉了 */
export async function assertClosed() {
  if (!_browser) return { browserClosed: true, serverClosed: !_server }
  let connected = false
  try { connected = _browser.isConnected() } catch (e) { connected = false }
  if (connected) {
    console.warn('[警告] 浏览器仍在运行，正在强制关闭…')
    try { await _browser.close() } catch (e) { }
    try { connected = _browser.isConnected() } catch (e) { connected = false }
  }
  _browser = null
  return { browserClosed: !connected, serverClosed: !_server }
}

export function isHeadless() { return HEADLESS }

export async function closeAll() {
  if (_browser) { try { await _browser.close() } catch (e) { } _browser = null }
  if (_server) { await new Promise(r => _server.close(r)); _server = null; _base = null }
  return { browserClosed: !_browser, serverClosed: !_server }
}

/**
 * 渲染一帧 H2 黄金样本。
 * @param {{state?:string,size?:number,bg?:'none'|'dark'|'white',t?:number,dist?:'disk'|'annulus',glow?:boolean,plate?:boolean,fx?:boolean,dsf?:number}} o
 * @returns {Promise<{buffer:Buffer,width:number,height:number,url:string,requested:object}>}
 */
export async function render(o = {}) {
  const state = (o.state || 'WORK').toUpperCase()
  const size = o.size || 240
  const bg = o.bg || 'none'
  const t = o.t === undefined ? 0 : o.t
  const dsf = o.dsf === undefined ? 1 : o.dsf
  const dist = o.dist === 'annulus' ? 'annulus' : 'disk'   // 默认 disk = 既有黄金样本行为，不变
  const base = await startServer()
  const q = new URLSearchParams({ state, size: String(size), bg, t: String(t) })
  if (dist !== 'disk') q.set('dist', dist)
  if (o.glow === false) q.set('glow', '0')
  if (o.plate === false) q.set('plate', '0')
  if (o.fx === false) q.set('fx', '0')
  const url = base + 'h2-golden.html?' + q.toString()
  const browser = await getBrowser()
  let ctx = null
  try {
    ctx = await browser.newContext({ deviceScaleFactor: dsf, viewport: { width: size, height: size }, reducedMotion: 'reduce', colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction('window.__goldenReady === true', null, { timeout: 10000 })
    const buffer = await page.screenshot({
      omitBackground: bg === 'none', animations: 'disabled',
      clip: { x: 0, y: 0, width: size, height: size }
    })
    return { buffer, width: size * dsf, height: size * dsf, url, requested: { size, dsf, dist } }
  } finally {
    if (ctx) { try { await ctx.close() } catch (e) { } }
  }
}

/** 渲染并直接落盘 */
export async function renderTo(file, o = {}) {
  const r = await render(o)
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.writeFile(file, r.buffer)
  const meta = await sharp(r.buffer).metadata()
  return { file, width: meta.width, height: meta.height, channels: meta.channels, hasAlpha: meta.hasAlpha, bytes: r.buffer.length, sha256: sha256(r.buffer) }
}

export function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
export const ROOT = __dirname
