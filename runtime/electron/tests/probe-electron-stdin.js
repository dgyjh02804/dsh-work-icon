'use strict'
/* stdin-probe.js —— 最小实验：Electron 主进程的 stdin 在管道下到底能不能用 */
const { app } = require('electron')
const fs = require('node:fs')

function L (m) { try { process.stderr.write('[probe] ' + m + '\n') } catch {} }

L('start isTTY=' + process.stdin.isTTY + ' readable=' + process.stdin.readable)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => L('DATA ' + JSON.stringify(String(d))))
process.stdin.on('end', () => L('END (EOF)'))
process.stdin.on('close', () => L('CLOSE'))
process.stdin.on('error', (e) => L('ERR ' + e.message))
try { process.stdin.resume() } catch (e) { L('resume failed ' + e.message) }

/* 备选路径：直接读 fd 0 */
setTimeout(() => {
  try {
    const buf = Buffer.alloc(256)
    const n = fs.readSync(0, buf, 0, 256, null)
    L('readSync(0) -> ' + n + ' bytes: ' + JSON.stringify(buf.slice(0, n).toString('utf8')))
  } catch (e) { L('readSync(0) failed: ' + e.code + ' ' + e.message) }
}, 600)

setTimeout(() => {
  L('state readable=' + process.stdin.readable + ' destroyed=' + process.stdin.destroyed + ' readableEnded=' + process.stdin.readableEnded)
  app.quit()
  setTimeout(() => process.exit(0), 200)
}, 2500)

app.whenReady().then(() => L('app ready'))
