/* composite-cpu/main.js —— 三种驱动方式的 CPU 对照（**不碰生产代码**）
 *   static    : 完全静止，不排任何动画帧
 *   composite : 30fps 只动 transform / opacity / background-position（走合成层，不重排不重绘）
 *   paint     : 30fps 动 width / filter:blur / box-shadow（会触发重排重绘——参考表里点名的最贵三类）
 * 窗口 460×620 放屏幕右下角，`setIgnoreMouseEvents(true)` 不收输入；单次会话 ≈10s
 * 用法: electron tests/composite-cpu --mode composite --out result-composite.json
 */
const { app, BrowserWindow, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const MODE = arg('mode', 'static')
const OUT = arg('out', path.join(__dirname, 'result-' + MODE + '.json'))

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

app.whenReady().then(() => {
  const a = screen.getPrimaryDisplay().workArea
  const W = 460, H = 620
  const win = new BrowserWindow({
    width: W, height: H, x: a.x + a.width - W - 24, y: a.y + a.height - H - 24,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, resizable: false, show: true,
    webPreferences: { backgroundThrottling: false }
  })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadFile(path.join(__dirname, 'index.html'), { query: { mode: MODE } })

  const samples = []
  const t0 = Date.now()
  const timer = setInterval(() => {
    let cpu = 0, mem = 0
    for (const m of app.getAppMetrics()) { cpu += m.cpu.percentCPUUsage; mem += m.memory.workingSetSize / 1024 }
    samples.push({ t: Date.now() - t0, cpu: +cpu.toFixed(2), mem: Math.round(mem) })
  }, 200)

  setTimeout(() => {
    clearInterval(timer)
    const xs = samples.filter((x) => x.t >= 3500 && x.t <= 9000)     /* 稳态窗口 */
    const cpu = xs.length ? +(xs.reduce((s, x) => s + x.cpu, 0) / xs.length).toFixed(2) : null
    const peak = xs.length ? +Math.max(...xs.map((x) => x.cpu)).toFixed(2) : null
    const mem = xs.length ? Math.round(xs.reduce((s, x) => s + x.mem, 0) / xs.length) : null
    fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, cpu: cpu, peak: peak, memMB: mem, n: xs.length }, null, 2))
    console.log('RESULT ' + JSON.stringify({ mode: MODE, cpu: cpu, peak: peak, memMB: mem }))
    win.hide(); win.destroy(); app.exit(0)
  }, 10500)
})
