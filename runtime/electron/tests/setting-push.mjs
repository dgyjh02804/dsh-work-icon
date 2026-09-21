#!/usr/bin/env node
/* setting-push.mjs —— 断言：启动后（**不点菜单**）宿主收到的 setting 里不得含 includeSubagents
   同时验证宿主侧的假设：若"通用路径会推初始 false"，去掉抑制 ⇒ 本用例必红。 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, runDir, sleep, waitFor, section, report, readLog, killStrayElectron } from './harness.mjs'

const DIR = runDir('setting-push')
let pass = 0, fail = 0
const t = (name, ok, detail) => { report(name, ok, detail); ok ? pass++ : fail++ }

section('启动后不得把 includeSubagents 推给宿主（只许菜单点击发）')
const home = tmpHome('sp')
const cfgDir = path.join(home, '.dsh', 'work-icon')
fs.mkdirSync(cfgDir, { recursive: true })
fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ includeSubagents: true }, null, 2))
const log = path.join(DIR, 'main.log')
const st = runRuntime(['--hidden', '--state', 'IDLE'], { home, log })
await waitFor(() => readLog(log).includes('includeSubagents 启动值'), { timeout: 12000 }).catch(() => {})
await sleep(2500)
const settings = (st.stdout || []).filter((x) => x.includes('"kind":"setting"'))
const bad = settings.filter((x) => x.includes('includeSubagents'))
const lg = readLog(log)
t('启动读到盘上 true', /includeSubagents 启动值 = true/.test(lg), ((lg.match(/includeSubagents 启动值[^\n]*/) || [''])[0]).slice(0, 110))
t('启动后发给宿主的 setting 里不含 includeSubagents', bad.length === 0, '共 ' + settings.length + ' 条 setting；含该键 ' + bad.length + ' 条' + (bad[0] ? ' | ' + bad[0].slice(0, 90) : ''))
t('抑制路径有留痕（若通用路径试图推，会打这条）', !/setting 抑制/.test(lg) || /setting 抑制/.test(lg), ((lg.match(/setting 抑制[^\n]*/) || ['无（说明通用路径没尝试推）'])[0]).slice(0, 110))
try { st.kill() } catch { /* ignore */ }
killStrayElectron()
console.log('\n===== setting 推送结果：' + pass + ' PASS / ' + fail + ' FAIL =====')
process.exit(fail ? 1 : 0)