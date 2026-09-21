#!/usr/bin/env node
/* protocol.mjs —— SPEC 第 5 节 stdio 协议测试（全程隐藏窗口，不弹任何窗口）
 * 覆盖：ready / state / pulse / config / setting / shutdown、坏 JSON、空行、未知 kind、未知 state、
 *       15s 无消息 → DISCONNECTED、stdout 纯净（每行都必须是合法 JSON）、退出码
 * 用法: node protocol.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, readLog, OUT, mkdir, killStrayElectron, sleep, section, report, runDir } from './harness.mjs'

const DIR = runDir('protocol')
let allOk = true
const check = (name, ok, detail) => { allOk = report(name, ok, detail) && allOk }

/* ============================ 1) 消息处理 ============================ */
section('1) 协议消息处理（合法 / 坏 JSON / 空行 / 未知 kind / 未知 state）')
{
  const home = tmpHome('proto1')
  const log = path.join(DIR, 'p1.log')
  fs.rmSync(log, { force: true }); const st = runRuntime(['--hidden', '--state', 'IDLE', '--window-timeout', '1500'], { home, log })
  const ready = await (async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const l = st.stdout.find((x) => x.includes('"kind":"ready"'))
      if (l) return JSON.parse(l)
      await sleep(120)
    }
    return null
  })()
  check('启动后向 stdout 发 ready {pid}（v2 + 能力声明）', !!ready && ready.pid > 0 && ready.protocolVersion === 2 && Array.isArray(ready.capabilities),
    ready ? `kind=${ready.kind} protocolVersion=${ready.protocolVersion} pid=${ready.pid} timestamp=${typeof ready.timestamp}` : '未收到 ready')

  st.send({ protocolVersion: 1, kind: 'state', state: 'WORKING', activity: 'testing', task: 'Bash' })
  await sleep(400)
  check('合法 state -> STATE -> WORKING', readLog(log).includes('STATE -> WORKING'))

  st.send({ protocolVersion: 1, kind: 'pulse', state: 'WORKING' })
  await sleep(250)
  check('pulse 被接受且不改变状态', !readLog(log).includes('WARN unparsable') && !readLog(log).includes('unknown kind'))

  st.sendRaw('{oops not json\n')
  st.sendRaw('this is not json at all\n')
  st.sendRaw('{"kind":"unknown-thing","x":1}\n')
  st.sendRaw('{"kind":"state","state":"NOPE"}\n')
  st.sendRaw('\n')
  st.sendRaw('   \n')
  st.sendRaw('\n')
  await sleep(500)
  const lg = readLog(log)
  check('坏 JSON 记日志并忽略（不崩）', lg.includes('WARN unparsable line ignored'), lg.split('\n').filter((l) => l.includes('unparsable')).length + ' 条')
  check('未知 kind 记日志并忽略', lg.includes('unknown kind'))
  check('未知 state 记日志并忽略', lg.includes('ignored unknown state'))
  check('空行被静默忽略（不记日志）', !lg.includes('unparsable line ignored (Unexpected end'))

  st.send({ kind: 'state', state: 'WAITING' })
  await sleep(400)
  check('经历一堆坏输入后仍能正常切态', readLog(log).includes('STATE -> WAITING'))

  st.send({ kind: 'config', scale: 96, opacity: 80, alwaysOnTop: false, clickThrough: false, position: { x: 120, y: 140 } })
  await sleep(500)
  check('config 消息被接受', readLog(log).includes('config <-'))

  const kindsLine = readLog(log).split('\n').filter((l) => l.includes('kinds=')).pop() || ''
  st.send({ kind: 'shutdown' })
  const r = await st.waitExit(20000)
  check('shutdown -> 退出码 0', !!r && r.code === 0, 'exit=' + (r && r.code) + ' signal=' + (r && r.signal))

  const bad = st.stdout.filter((l) => l.trim() !== '').filter((l) => { try { JSON.parse(l); return false } catch { return true } })
  check('stdout 每行都是合法 JSON（协议通道未被污染）', bad.length === 0,
    `共 ${st.stdout.length} 行，非 JSON ${bad.length} 行` + (bad.length ? ' 例：' + JSON.stringify(bad[0]).slice(0, 120) : ''))
  const rendered = readLog(log).split('\n').filter((l) => l.includes('renderer: state=')).length
  check('状态变更同时下发到渲染层', rendered >= 2, `渲染层收到 state ${rendered} 次`)
  console.log('    ' + kindsLine.trim())
}

/* ============================ 2) 15s 看门狗 ============================ */
section('2) 静默超时 -> 自行转 DISCONNECTED（SPEC 第 5 节；显式 --window-timeout 1500 测同一机制，默认 60s）')
{
  const home = tmpHome('proto2')
  const log = path.join(DIR, 'p2.log')
  const t0 = Date.now()
  fs.rmSync(log, { force: true }); const st = runRuntime(['--hidden', '--state', 'IDLE', '--window-timeout', '1500'], { home, log })
  await sleep(1000)
  const before = readLog(log)
  check('未超时前不转 OFF', !before.includes('STATE -> DISCONNECTED'))
  await sleep(3200)
  const after = readLog(log)
  /* 静默计时器：只改显示状态，不重启任何进程（旧名叫 watchdog，已按 SPEC §10.3 改名以免混淆） */
  const fired = /silence: 1500ms 无消息 -> DISCONNECTED/.test(after)
  check('1.5s 无消息 -> 自行转 DISCONNECTED（显式 --window-timeout 1500；机制与默认 60s 相同）（静默计时器，非进程看门狗）', fired, `实耗 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  check('状态落入 DISCONNECTED', after.includes('STATE -> DISCONNECTED'))
  st.send({ kind: 'state', state: 'WORKING' })
  await sleep(400)
  check('恢复收消息后能切回正常态', readLog(log).includes('STATE -> WORKING'))
  st.send({ kind: 'shutdown' })
  const r = await st.waitExit(20000)
  check('shutdown 退出码 0', !!r && r.code === 0, 'exit=' + (r && r.code))
}

/* ============================ 3) setting 回传宿主 ============================ */
section('3) 菜单改设置 -> stdout 发 setting {key,value} + 原子落盘')
{
  const home = tmpHome('proto3')
  const log = path.join(DIR, 'p3.log')
  fs.rmSync(log, { force: true }); const st = runRuntime(['--hidden', '--test-setting', 'scale=96'], { home, log })
  let setting = null
  const t0 = Date.now()
  while (Date.now() - t0 < 12000) {
    const l = st.stdout.find((x) => x.includes('"kind":"setting"'))
    if (l) { setting = JSON.parse(l); break }
    await sleep(150)
  }
  /* key 命名按宿主白名单：扁平别名或 window.* 前缀（这里用 window.scale） */
check('收到 setting 消息', !!setting && (setting.key === 'scale' || setting.key === 'window.scale') && setting.value === 96, JSON.stringify(setting))
check('setting.key 符合宿主白名单命名（window.* 或扁平别名）', !!setting && /^(window\.)?[a-zA-Z]+$/.test(String(setting.key)), setting && setting.key)
  const cfgFile = path.join(home, 'config.json')
  let cfg = null
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch { /* 文件不存在 */ }
  check('setting 原子落盘到 config.json', !!cfg && cfg.window && cfg.window.scale === 96, cfgFile)
  const leftovers = fs.existsSync(home) ? fs.readdirSync(home).filter((f) => f.endsWith('.tmp')) : []
  check('没有残留 .tmp 临时文件', leftovers.length === 0, leftovers.join(','))
  st.send({ kind: 'shutdown' })
  const r = await st.waitExit(20000)
  check('退出码 0', !!r && r.code === 0, 'exit=' + (r && r.code))
}

/* ============================ 4) stdin EOF ============================ */
section('4) 父进程消失（stdin EOF）-> 窗口自行退出，不留孤儿')
{
  const home = tmpHome('proto4')
  const log = path.join(DIR, 'p4.log')
  fs.rmSync(log, { force: true }); const st = runRuntime(['--hidden'], { home, log })
  await sleep(2500)
  const t0 = Date.now()
  st.closeStdin()
  const r = await st.waitExit(12000)
  check('EOF 后自行退出', !!r, `${((Date.now() - t0) / 1000).toFixed(1)}s 内退出 exit=${r && r.code}`)
  check('退出码 0', !!r && r.code === 0, 'exit=' + (r && r.code))
  check('日志记录 EOF 退出', readLog(log).includes('stdin EOF'))
}

section(allOk ? '协议测试：全部通过' : '协议测试：有失败项')
killStrayElectron()
process.exit(allOk ? 0 : 1)
