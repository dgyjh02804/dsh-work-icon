/* progress-cpu/main.js —— 设计验证用 CPU 实测台（**不碰生产代码**）
 * 真窗口 460×620 放屏幕右下角，四种情形各 4s，采集中间 2.5s 的 CPU 均值。
 * 情形：idle（悬浮层静止）· panel（完整面板多条条）· advance（进度推进）· complete（任务完成瞬间，每 1.2s 复现一次）
 * 用法: electron tests/progress-cpu --tier standard --out result.json
 */
const { app, BrowserWindow, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const TIER = arg('tier', 'standard')
const OUT = arg('out', path.join(__dirname, 'result-' + TIER + '.json'))
const SCEN = ['idle', 'panel', 'advance', 'complete']
const DUR = 4000

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

app.whenReady().then(() => {
  const a = screen.getPrimaryDisplay().workArea
  const W = 460, H = 620
  const win = new BrowserWindow({
    width: W, height: H,
    x: a.x + a.width - W - 24, y: a.y + a.height - H - 24,     /* 右下角 */
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, resizable: false, show: true,
    webPreferences: { backgroundThrottling: false }
  })
  win.setIgnoreMouseEvents(true, { forward: true })            /* 绝不接收真实输入 */
  win.loadFile(path.join(__dirname, 'index.html'), { query: { tier: TIER } })

  const samples = []
  const t0 = Date.now()
  const timer = setInterval(() => {
    let cpu = 0, mem = 0
    for (const m of app.getAppMetrics()) { cpu += m.cpu.percentCPUUsage; mem += m.memory.workingSetSize / 1024 }
    samples.push({ t: Date.now() - t0, cpu: +cpu.toFixed(2), mem: Math.round(mem) })
  }, 250)

  setTimeout(() => {
    clearInterval(timer)
    const res = {}
    SCEN.forEach((s, i) => {
      const from = i * DUR + 1500, to = (i + 1) * DUR - 100
      const xs = samples.filter((x) => x.t >= from && x.t < to)
      res[s] = {
        cpu: xs.length ? +(xs.reduce((a, b) => a + b.cpu, 0) / xs.length).toFixed(2) : null,
        peak: xs.length ? Math.max(...xs.map((x) => x.cpu)).toFixed(2) : null,
        memMB: xs.length ? Math.round(xs.reduce((a, b) => a + b.mem, 0) / xs.length) : null,
        n: xs.length
      }
    })
    fs.writeFileSync(OUT, JSON.stringify({ tier: TIER, scenarios: res }, null, 2))
    console.log('RESULT ' + JSON.stringify(res))
    win.hide()
    win.destroy()
    app.exit(0)
  }, SCEN.length * DUR + 1500)
})
