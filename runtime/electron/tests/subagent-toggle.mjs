#!/usr/bin/env node
/* subagent-toggle.mjs —— 断言「勾选态自愈」：盘上 includeSubagents 变了 ⇒ 收到 config 后对齐
   （原先只覆盖"窗口点击 ⇒ 发 setting"，没覆盖这个方向） */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, runDir, sleep, waitFor, section, report, readLog, killStrayElectron } from './harness.mjs'

const DIR = runDir('subagent-toggle')
let pass = 0, fail = 0
const t = (name, ok, detail) => { report(name, ok, detail); ok ? pass++ : fail++ }

section('勾选态自愈：盘上值变化 ⇒ 收到 config 后对齐（不许"启动读一次就永远陈旧"）')
const home = tmpHome('sat')
const cfgDir = path.join(home, '.dsh', 'work-icon')
fs.mkdirSync(cfgDir, { recursive: true })
const cfgFile = path.join(cfgDir, 'config.json')
fs.writeFileSync(cfgFile, JSON.stringify({ includeSubagents: false }, null, 2))
const log = path.join(DIR, 'main.log')
const st = runRuntime(['--hidden', '--state', 'IDLE'], { home, log })
await waitFor(() => readLog(log).includes('includeSubagents 启动值'), { timeout: 12000 }).catch(() => {})
let lg = readLog(log)
t('启动时读到盘上值 false', /includeSubagents 启动值 = false/.test(lg), ((lg.match(/includeSubagents 启动值[^\n]*/) || [''])[0]).slice(0, 110))

fs.writeFileSync(cfgFile, JSON.stringify({ includeSubagents: true }, null, 2))
st.send({ kind: 'config', window: { scale: 140 } })
await sleep(900)
lg = readLog(log)
t('盘上 true ⇒ 勾选态变 true（宿主没回发该键也自愈）', /includeSubagents -> true（config 顺带重读磁盘）/.test(lg),
  ((lg.match(/includeSubagents -> true[^\n]*/) || [''])[0]).slice(0, 130))

fs.writeFileSync(cfgFile, JSON.stringify({ includeSubagents: false }, null, 2))
st.send({ kind: 'config', window: { opacity: 100 } })
await sleep(900)
lg = readLog(log)
t('盘上 false ⇒ 勾选态变回 false（双向）', /includeSubagents -> false（config 顺带重读磁盘）/.test(lg),
  ((lg.match(/includeSubagents -> false[^\n]*/) || [''])[0]).slice(0, 130))

st.send({ kind: 'config', includeSubagents: true })
await sleep(700)
lg = readLog(log)
t('消息里带该键 ⇒ 以消息为准（两条路都认）', /includeSubagents -> true（host config）/.test(lg),
  ((lg.match(/includeSubagents -> true（host config）[^\n]*/) || [''])[0]).slice(0, 130))

try { st.kill() } catch { /* ignore */ }
killStrayElectron()
console.log('\n===== 勾选态自愈结果：' + pass + ' PASS / ' + fail + ' FAIL =====')
process.exit(fail ? 1 : 0)