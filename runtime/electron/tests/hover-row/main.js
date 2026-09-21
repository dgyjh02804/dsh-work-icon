/* hover-row/main.js —— 实测两件事（**不碰生产代码**）
 *  A) 在 setIgnoreMouseEvents(true,{forward:true}) 下，**主进程轮询 screen.getCursorScreenPoint()** 能否稳定判定
 *     "光标在哪一行"（这正是生产代码现在判定悬停的机制）
 *  B) **渲染进程到底收不收得到 DOM mousemove**（forward 是否真的把移动事件转发进来）
 * 窗口放"当前光标所在位置"（由调用方传入，只读探测得到，无任何输入合成），14s 后退出并打印 JSON
 * 用法: electron tests/hover-row --x <screenX> --y <screenY> --out <json>
 */
const { app, BrowserWindow, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
let X = Number(arg('x', '0')), Y = Number(arg('y', '0'))
const OUT = arg('out', path.join(__dirname, 'result.json'))
const W = 440, H = 340

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

app.whenReady().then(() => {
  if (!X && !Y) { const c0 = screen.getCursorScreenPoint(); X = c0.x; Y = c0.y; console.log('CURSOR ' + X + ',' + Y) }
  const wa = screen.getPrimaryDisplay().workArea
  /* 把窗口摆到"光标当前位置"的左上偏移处，使光标落在第一行任务行上 */
  const wx = Math.max(wa.x, Math.min(wa.x + wa.width - W, X - 60))
  const wy = Math.max(wa.y, Math.min(wa.y + wa.height - H, Y - 96))
  const win = new BrowserWindow({
    x: wx, y: wy, width: W, height: H,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, resizable: false, show: true,
    webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') }
  })
  /* ⚠️ 关键：这就是生产代码的点击穿透设置 —— 忽略鼠标，但转发移动事件 */
  win.setIgnoreMouseEvents(true, { forward: true })

  const samples = []
  let lastRow = null, domMoves = 0, hits = 0, cursorMovedInside = false
  let lastCur = null
  const ROWS = [   /* 行 y 区间（窗口内 CSS px，渲染进程的布局与之对应） */
    [96, 118], [118, 140], [140, 162], [162, 184], [184, 206]
  ]
  const timer = setInterval(() => {
    const c = screen.getCursorScreenPoint()          /* ← 只读探测，不合成任何输入 */
    const cx = c.x - wx, cy = c.y - wy
    let row = -1
    ROWS.forEach((r, i) => { if (cy >= r[0] && cy < r[1]) row = i })
    const inside = cx >= 0 && cy >= 0 && cx < W && cy < H
    if (inside && lastCur && (lastCur.x !== c.x || lastCur.y !== c.y)) cursorMovedInside = true
    lastCur = { x: c.x, y: c.y }
    if (row >= 0) hits++
    if (row !== lastRow) {
      if (row >= 0 || lastRow >= 0) samples.push({ t: Date.now(), row })
      lastRow = row
      win.webContents.send('row', row)               /* 主→渲染：告诉我们命中了哪一行 */
    }
  }, 40)

  win.webContents.on('ipc-message', (_e, ch) => { if (ch === 'dom-move') domMoves++ })

  setTimeout(() => {
    clearInterval(timer)
    const res = {
      windowAt: [wx, wy], cursorAt: lastCur, /* 只读探测 */
      rowHits: hits,                        /* 主进程轮询命中"某一行"的样本数（40ms 一次） */
      rowTransitions: samples.length,       /* 行命中变化次数 */
      domMousemove: domMoves,               /* 渲染进程收到的 DOM mousemove 次数 */
      cursorMovedInside: cursorMovedInside, /* 光标是否在窗口内真的移动过（决定 B 是否可判定） */
      ignored: true
    }
    fs.writeFileSync(OUT, JSON.stringify(res, null, 2))
    console.log('RESULT ' + JSON.stringify(res))
    win.hide(); win.destroy(); app.exit(0)
  }, 14000)
})
