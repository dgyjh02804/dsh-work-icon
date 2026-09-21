#!/usr/bin/env node
/* shots.mjs —— 隐藏窗口离屏渲染，导出七态 PNG（三种底：dark / white / none）
 * 全部走 show:false + win.capturePage()，全程不显示真窗口、不弹任何东西。
 * 用法: node shots.mjs [240]
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, HERE, OUT, mkdir, killStrayElectron, sleep, section, runDir } from './harness.mjs'

const BOX = String(process.argv[2] || 240)
const STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']
const DIR = runDir('shots')
const BGS = ['dark', 'white', 'none']

/* ---------------------------------------------------------------------------
 * 抓图必须跑在**本轮 runId 下的临时 home** 里（2026-09-20 修的一处测试隔离洞）
 *
 * 根因：本文件起运行时进程时**没传 home**（runRuntime 的 `home` 选项省略），于是 main.js 的
 *   `homeDir()` 落到最后一档 `os.homedir()/.dsh/work-icon` —— **用户真实的生产目录**。
 *   后果（实测留痕）：离屏抓图读到用户自己的 `theme.json`（iconBright=1.3、textBoost=2、
 *   panelAlpha=0.54），渲染层据此挂上 `body.tuned #zoom{filter:brightness(1.3)}`，
 *   整张图被整体提亮 30%，与中性黄金样本出现 2.5%~10.2% 的差异 ⇒ 黄金样本比对**假红**；
 *   同时 `app.setPath('userData', HOME/userdata)` 让测试实例与用户**正在跑的生产实例共用 userdata**。
 *   证据（改前原文）：
 *     home=C:\Users\david\.dsh\work-icon …
 *     renderer: theme <- {…,"iconBright":1.3,…,"themePath":"C:\\Users\\david\\.dsh\\work-icon\\theme.json"} -> {"tuned":true,…}
 *
 * 改法：走 harness 既有通道 `runRuntime(args, { home })`（它把 home 拼成 `--home <dir>`，
 *   而 main.js `homeDir()` 的第一优先级正是 OPT.home）。**不新造开关**。
 *   home 落在本轮 runId 的产物目录下（本机纪律：产物目录每进程 runId 隔离）：
 *     OUT/<DSH_TEST_RUN>/home-shots
 *   子进程继承 `DSH_TEST_RUN`，所以 compare-golden.mjs 里跑的 shots.mjs 得到的是**同一个 runId**
 *   下的 home（与该文件先例 `runDir('home-golden')` 同构，只是把隔离搬到了真正起进程的地方）。
 *
 * ⚠️ 用 runDir 而不是 tmpHome（两者路径相同，差别只在 tmpHome 会先清空）：runId 本身已按
 *   pid+时间戳唯一（见 harness 注释），不会串味；而不清空才能让"隔离是否真的生效"被**正向证明** ——
 *   往这个 home 里放一份**已知值**的 theme.json（例如 iconBright=0.7），若抓图留痕读到的就是 0.7
 *   而不是生产那份 1.3、也不是默认 1.0，则"读到了临时 home"**有唯一解**，不靠推断。
 * ------------------------------------------------------------------------- */
const SHOT_HOME = runDir('home-shots')

section(`七态离屏渲染（隐藏窗口 capturePage，盒子 ${BOX}px @dpr2 = ${BOX * 2}px 物理）`)
const t0 = Date.now()
for (const bg of BGS) {
  const log = path.join(DIR, `shot-${bg}.log`)
  const st = runRuntime(['--shot', BOX, '--bg', bg, '--shot-states', STATES.join(','), '--out', DIR,
    '--settle-ms', '420', '--hidden'], { home: SHOT_HOME, log })
  const r = await st.waitExit(60000)
  if (!r) { st.kill(); console.log('  [FAIL] ' + bg + ' 超时未退出'); continue }
  const ok = st.stdout.filter((l) => l.startsWith('SHOT ')).length
  console.log(`  bg=${bg.padEnd(6)} exit=${st.code} 抓图 ${ok}/7  ${st.stdout.filter((l) => l.startsWith('SHOT ')).map((l) => l.split(' ')[1]).join(',')}`)
  if (ok !== 7 || st.code !== 0) console.log('  stderr tail: ' + st.stderr.slice(-5).join('\n             '))
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()
section('产物')
for (const f of files) {
  const p = path.join(DIR, f)
  const size = fs.statSync(p).size
  const buf = fs.readFileSync(p)
  /* PNG IHDR：宽高在 16..24 字节 */
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
  console.log(`  ${f.padEnd(34)} ${w}x${h}  ${size} B`)
}
console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，共 ${files.length} 张`)
killStrayElectron()
await sleep(300)
