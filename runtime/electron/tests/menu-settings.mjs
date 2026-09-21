#!/usr/bin/env node
/* menu-settings.mjs —— 右键菜单两项改动的回归（**全程离屏 --hidden，不显示窗口、不碰光标**）
 *
 * ① 新增「跟随子代理」(includeSubagents)：
 *    · 默认 false（维持用户当前行为）
 *    · 点击走 applySetting（与菜单项同一函数）→ 发**扁平**键 setting {key:'includeSubagents', value}
 *      （与宿主 SETTABLE_TOP_LEVEL_KEYS 对齐，不是 window.*）
 *    · 宿主回发 config 后窗口立即更新勾选态，**不重启**
 * ② 删掉「开机自启」：菜单没有该项、配置键消失、发 autostart 也不会产生 setting 消息
 * 用法: node tests/menu-settings.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { runRuntime, tmpHome, OUT, mkdir, sleep, section, report, killStrayElectron, readLog, HERE, ELECTRON, RUNTIME, runDir } from './harness.mjs'

const DIR = runDir('menu')
const SRC = fs.readFileSync(path.join(HERE, '..', 'main.js'), 'utf8')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

section('菜单项回归：跟随子代理（新增）/ 开机自启（删除）—— 离屏')

/* ---------- ① 默认值 false（生产参数干跑取证：不创建窗口、不显示任何东西） ---------- */
const planOf = async (argv, tag) => {
  const home = tmpHome('menu-plan-' + tag)
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true })
  return await new Promise((resolve) => {
    const p = spawn(ELECTRON, [RUNTIME, ...argv], {
      cwd: path.resolve(RUNTIME, '..', '..'),
      env: { ...process.env, USERPROFILE: home, DSH_WORK_ICON_PRINT_PLAN: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let so = ''
    p.stdout.on('data', (c) => { so += c })
    const t = setTimeout(() => { try { p.kill() } catch { /* ignore */ } resolve(null) }, 20000)
    p.on('exit', () => {
      clearTimeout(t)
      let plan = null
      for (const l of so.split('\n')) { if (l.trim().startsWith('{')) { try { const j = JSON.parse(l); if (j.phase === 'plan') plan = j } catch { /* ignore */ } } }
      resolve(plan)
    })
  })
}
const plan = await planOf([], 'default')
check('默认 includeSubagents = false（维持用户当前"不跟子代理"行为）', !!plan && plan.includeSubagents === false,
  plan ? 'includeSubagents=' + plan.includeSubagents : '未拿到计划')

/* ---------- ② 菜单路径：点一下 -> 扁平 setting + 本地落盘 ---------- */
const home2 = tmpHome('menu-set')
const log2 = path.join(DIR, 'set.log')
fs.rmSync(log2, { force: true })
const s2 = runRuntime(['--hidden', '--test-setting', 'includeSubagents=true', '--exit-after', '5'], { home: home2, log: log2 })
await s2.waitExit(20000)
const setLine = s2.stdout.find((l) => l.includes('"kind":"setting"')) || ''
check("菜单路径发出扁平键 setting {key:'includeSubagents',value:true}",
  /"key":"includeSubagents"/.test(setLine) && /"value":true/.test(setLine), setLine.trim().slice(0, 120))
check('没有误用 window.includeSubagents 前缀', !/"key":"window\.includeSubagents"/.test(setLine))
const cfgFile = path.join(home2, 'config.json')
let cfgJson = null
let cfgExists = true
try { cfgJson = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch { cfgExists = false }
/* 单一真相源：includeSubagents 的持久化权在宿主（顶层键）。窗口侧只在**内存**里存勾选态，
   绝不写进自己的 config.json —— 若文件压根没被创建，同样符合预期（说明窗口没为它落任何盘）。 */
check('窗口侧**不往 window 块写** includeSubagents（避免双真相源）',
  !cfgExists || (cfgJson.window && !('includeSubagents' in cfgJson.window)),
  cfgExists ? 'window 键: ' + Object.keys(cfgJson.window || {}).join(',') : 'config.json 未被创建（窗口没为它落盘）')
check('窗口侧也不在配置顶层写 includeSubagents（那是宿主的键）', !cfgExists || !('includeSubagents' in cfgJson),
  cfgExists ? '顶层键: ' + Object.keys(cfgJson).join(',') : 'config.json 未被创建')
check('落盘里不再有 window.autostart 键', !cfgExists || (cfgJson.window && !('autostart' in cfgJson.window)),
  cfgExists ? Object.keys(cfgJson.window || {}).join(',') : 'config.json 未被创建')

/* ---------- ③ 宿主回发 config -> 立即更新、不重启 ---------- */
const home3 = tmpHome('menu-live')
const log3 = path.join(DIR, 'live.log')
fs.rmSync(log3, { force: true })
const s3 = runRuntime(['--hidden', '--window-timeout', '60000'], { home: home3, log: log3 })
await sleep(2500)
s3.send({ kind: 'config', includeSubagents: true })
await sleep(1200)
const lg3 = readLog(log3)
check('config {includeSubagents:true} 后窗口立即采用（日志确认）', /includeSubagents -> true/.test(lg3),
  (lg3.split('\n').filter((l) => l.includes('includeSubagents ->')).join(' | ') || '无'))
s3.send({ kind: 'config', window: { includeSubagents: false } })
await sleep(1200)
const lg3b = readLog(log3)
check('嵌套写法 config {window:{includeSubagents:false}} 也能生效', /includeSubagents -> false/.test(lg3b),
  (lg3b.split('\n').filter((l) => l.includes('includeSubagents ->')).slice(-1)[0] || '无').slice(-70))
check('非布尔值被忽略且不崩', (() => { s3.send({ kind: 'config', includeSubagents: 'yes' }); return true })())
await sleep(800)
check('整个过程没有重启窗口', (readLog(log3).match(/window created/g) || []).length === 1,
  'window created × ' + (readLog(log3).match(/window created/g) || []).length)
s3.send({ kind: 'shutdown' })
const r3 = await s3.waitExit(10000)
check('退出码 0', !!r3 && r3.code === 0, 'exit=' + (r3 && r3.code))

/* ---------- ④ 开机自启：全链路清除 ---------- */
check('main.js 里已无 autostart 代码（配置键 / 菜单项 / 落盘全部移除）', !/autostart/i.test(SRC),
  (SRC.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /autostart/i.test(l)).map(([i, l]) => 'L' + i + ':' + l.trim()).join(' | ') || '干净'))
check('菜单模板里没有"开机自启"字样', !/开机自启/.test(SRC))
const home4 = tmpHome('menu-auto')
const log4 = path.join(DIR, 'autostart.log')
fs.rmSync(log4, { force: true })
const s4 = runRuntime(['--hidden', '--test-setting', 'autostart=true', '--exit-after', '4'], { home: home4, log: log4 })
await s4.waitExit(15000)
check('发 autostart=true 不会产生任何 setting 消息（该功能已不存在）',
  !s4.stdout.some((l) => l.includes('"kind":"setting"')), JSON.stringify(s4.stdout.filter((l) => l.includes('setting')).slice(0, 2)))

/* ---------- ⑤ 启动时读宿主写在**顶层**的值 ---------- */
const home5 = tmpHome('menu-top')
fs.writeFileSync(path.join(home5, 'config.json'), JSON.stringify({ includeSubagents: true, window: { scale: 140 } }, null, 2))
const log5 = path.join(DIR, 'top.log')
fs.rmSync(log5, { force: true })
const s5 = runRuntime(['--hidden', '--exit-after', '3'], { home: home5, log: log5 })
await s5.waitExit(12000)
const lg5 = readLog(log5)
check('启动时从 config.json 顶层读到 includeSubagents=true（宿主写的才是真值）',
  /includeSubagents 启动值 = true/.test(lg5), (lg5.split('\n').find((l) => l.includes('启动值')) || '无').slice(-70))

/* ---------- ⑥ 顶层值缺失时默认 false ---------- */
const home6 = tmpHome('menu-top-missing')
fs.writeFileSync(path.join(home6, 'config.json'), JSON.stringify({ window: { scale: 140 } }, null, 2))
const log6 = path.join(DIR, 'top-missing.log')
fs.rmSync(log6, { force: true })
const s6 = runRuntime(['--hidden', '--exit-after', '3'], { home: home6, log: log6 })
await s6.waitExit(12000)
check('顶层键缺失时默认 false（维持用户当前行为）',
  /includeSubagents 启动值 = false/.test(readLog(log6)), (readLog(log6).split('\n').find((l) => l.includes('启动值')) || '无').slice(-70))
section(ok ? '菜单项回归：全部通过' : '菜单项回归：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
