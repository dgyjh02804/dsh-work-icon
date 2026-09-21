#!/usr/bin/env node
/* run-all.mjs —— 一键测试汇总
 *
 * 默认：**全部离屏**（show:false / capturePage），不显示任何窗口、不移动光标、不合成任何输入。
 * --with-shown：额外跑真窗口会话（性能 CPU 必须真窗口测才有意义；置顶/不抢焦点也只能真窗口看）。
 *   这些项单次 ≤20 秒、强制屏幕右下角、退出前 hide→destroy、跑完清理 electron.exe —— SPEC 第 10 节第 5 条。
 *   **跑 --with-shown 前请先获得许可**（真窗口会短暂出现在用户屏幕上）。
 *
 * 另外 wfp.mjs（真窗口 WindowFromPoint 命中取证）**不在默认套件里**，需要时单独跑且同样需获准；
 * 离屏版的穿透证据在 passthrough.mjs（exstyle + 命中几何，不需要显示窗口）。
 *
 * 黄金样本比对本步**自带七态渲染**（compare-golden.mjs 内部会先跑 shots.mjs），
 * 所以它单独跑与在套件里跑结果一致 —— 不再依赖"上一次留下的产物"（2026-09-12 修复）。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HERE, killStrayElectron } from './harness.mjs'

/* ============================================================================
 * 并发锁：**同一时刻只允许一套套件在跑**（2026-09-12 事故的修复）
 *
 * 为什么需要：`test/out/<测试名>/` 是**共享产物目录**（main.log / config.json / 截图都按固定名字读写）。
 * 两套 run-all 同时跑会互相覆盖，表现为**"红的项每次都变"的假失败** ——
 * 实测：我并发跑一次得到 3 红（菜单项/面板交互/位置记忆），同一时间另一个 agent 跑得到 1 红（stdio 协议），
 * **两边红的项都不一样**，而这两边在单跑时都是绿的。这类假信号此前已经浪费过一次完整排查（黄金样本那条）。
 *
 * 语义（有意如此）：
 *   · 拿到锁才跑；**拿不到就明确报错并退出码 2**，绝不静默排队 ——
 *     静默排队会让调用方以为"没输出=还在跑"，正是我们要避免的模糊状态。
 *   · 锁里写的是 `pid + 起始时间`；**若该 pid 已不存在，视为陈旧锁直接接管**（绝不要求人工删文件）。
 * ========================================================================== */
const LOCK = path.join(HERE, '..', 'test', 'out', '.run-all.lock')
function pidAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) { return !!(e && e.code === 'EPERM') }
}
function releaseLock () { try { fs.unlinkSync(LOCK) } catch { /* ignore */ } }
function acquireOrExit () {
  try { fs.mkdirSync(path.dirname(LOCK), { recursive: true }) } catch { /* ignore */ }
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); return } catch (e) {
      if (e.code !== 'EEXIST') throw e
      let held = null
      try { held = JSON.parse(fs.readFileSync(LOCK, 'utf8')) } catch { /* 坏锁 -> 当陈旧 */ }
      if (!held || !held.pid || !pidAlive(held.pid)) { try { fs.unlinkSync(LOCK) } catch { /* ignore */ } ; continue }
      console.error('\n❌ 已有一套 run-all 正在跑（pid=' + held.pid + '，开始于 ' + new Date(held.at).toLocaleTimeString() + '）')
      console.error('   原因：test/out/<测试名>/ 是共享产物目录，两套并发会互相覆盖日志与截图，')
      console.error('        制造出"红的项每次都变"的假失败（红的项与另一套不同，单跑却都是绿的）。')
      console.error('   处理：等它跑完；若确认那套进程已死，删掉这个文件即可（陈旧锁本来也会被自动接管）：')
      console.error('        ' + LOCK + '\n')
      process.exit(2)
    }
  }
  console.error('❌ 无法获得测试锁：' + LOCK)
  process.exit(2)
}
acquireOrExit()
process.on('exit', releaseLock)
process.on('SIGINT', () => { releaseLock(); process.exit(130) })

const SHOWN = process.argv.includes('--with-shown')
const SUITE = [
  ['会话生命周期（生产不自杀 / 测试才兜底）', ['lifecycle.mjs']],
  ['帧率配置 + config 实时生效', ['fps-config.mjs']],
  ['菜单项：跟随子代理 / 开机自启已删', ['menu-settings.mjs']],
  ['清除错误状态（点击确认 + 菜单项）', ['clear-error.mjs']],
  ['面板交互：悬停/单击/拖动/双击（双击开关面板）', ['panel-toggle.mjs']],
  ['面板可交互命中判据（图标圆 ∪ 面板矩形；含滚动条可拖的内部路径取证）', ['panel-hit.mjs']],
  ['v2 契约：state 载荷 / 能力声明 / 三种降级 / 跨侧键集合', ['v2.mjs']],
  ['v2 四字段：todos 信封 / cost 退化 / context 口径 / text revision', ['v2-fields.mjs']],
  ['七态离屏渲染 + 黄金样本比对（自渲染，不依赖历史产物）', ['compare-golden.mjs']],
  ['旋转取证：核心静止 + 轴心在视框中心', ['rotation.mjs']],
  ['点击穿透（离屏 exstyle + 命中几何）', ['passthrough.mjs']],
  ['stdio 协议（含 15s 静默超时）', ['protocol.mjs']],
  ['位置记忆（内部 --test-drag 路径）', ['position.mjs']],
  ['300ms 交叉淡入', ['transitions.mjs']],
  ['面板底板深浅四档 + 文字档（像素口径对比度，按实测 alpha 合成到真实壁纸）', ['panel-lightness.mjs']],
  ['主图标粒子运动多样性（车道速度/方向/半径波动，逐车道像素测量 + 省电档不生效）', ['particle-motion.mjs']],
  /* 口径已随任务 D 改动（2026-09-19）：这一行从"悬浮层活动行下面"搬到"#lab 正下方"，
     条目名同步改（旧名"悬浮层代理指标行…"会骗后面的人）。 */
  ['代理指标行：已从悬浮层搬到 #lab 下方（取真实值 / 样式同 #lab / 不越界不重叠 / 无条无百分比）', ['hover-metrics-row.mjs']],
  /* 任务 E（2026-09-19）：图标下那块悬浮信息板（#v2hover）的底被用户拍板**全删**（可调量默认 0）。
     像素口径：改动前/改动后都在用户真实浅色壁纸上量（解码器先自证，再量产品像素）。 */
  ['悬浮信息板全删底（#v2hover 底/框/圆角=0 + 描边补偿；像素口径对比度 + 大面板未动 + 几何 204x55）', ['hover-plate.mjs']],
  /* 任务 F（2026-09-19）：右键菜单「配色设置…」→ 独立普通窗口 → 实时热更新 + 只落 theme.json。 */
  ['配色设置窗口（菜单项 / 普通窗口 / 实时热更新不经宿主 / theme.json 落盘且不碰 config.json / 对比度读数像素复验）', ['settings-window.mjs']],
  /* 任务 G（2026-09-19）：一次渲染 = 一条留痕（用户生产日志里同一 block 被重复打印 15 次）。 */
  ['日志去重：一次渲染里同一条 v2panel blk 留痕最多 1 条（含留痕内容防缩水守卫）', ['log-dedup.mjs']],
  ['README spawn 规格真跑', ['spawn-spec.mjs']],
  /* 任务 B（2026-09-20）：悬浮信息板（#v2hover）里那**三行文字**被用户拍板删掉
     （原话「就是左上角这个字我都不希望留，太碍眼了」）。当时**三个图形全留**（.dot / .bs / .warnv2）
     —— ⚠️ 任务 C（2026-09-21）把那根 `.bs` 也去掉了，所以本项现在断言的是"**两个**图形保留
     + 那根条默认不画"。两个方向都起真实进程：默认（hoverRows=off）= 三行都不在；hoverRows=on = 三行原样回来。 */
  ['悬浮信息板：三行文字已删 / 图形保留（默认 off ↔ on 可回退，双向真机断言）', ['hover-rows.mjs']],
  /* 任务 C（2026-09-21）：悬浮信息板里那根 **150px 横向计划进度条**（`.v2bullet > .bs`）被用户拍板去掉
     （原话「我这个左上角的任务条也不要了，有环形的这样是多此一举」）。
     两路取证：① `hover rows` 留痕的 DOM 计数；② 同参数两帧的**像素差分**（严格色 #56d9c8@α255）
     —— 默认帧 0 个实色像素，hoverBar='on' 帧 2980 个、盒子正好是 .bs 的几何（150×5/6=125 × 6）。
     守恒项：环照旧在画、#lab/#lab2 不动、`.r1>.dot` 与 `.h3>.warnv2` 不动、三行文字保持删除。 */
  ['悬浮信息板：横向计划进度条已去掉（默认 off ↔ hoverBar=on 可回退；DOM 计数 + 像素差分双路）', ['hover-bar.mjs']]
]
const SHOWN_SUITE = [
  ['性能：真窗口 CPU/内存/帧率（140px，右下角，约 13.5s）', ['perf.mjs']],
  ['真机合成/置顶/不抢焦点（右下角，16s）', ['dwm.mjs', '16']],
  ['生产路径存活确认（宿主式无参数启动，右下角，19.5s）', ['production-session.mjs']]
]

const run = (list) => {
  const results = []
  for (const [name, argv] of list) {
    console.log('\n\n############ ' + name + ' ############')
    const r = spawnSync('node', [path.join(HERE, argv[0]), ...argv.slice(1)], { stdio: 'inherit' })
    results.push({ name, code: r.status })
  }
  return results
}
const results = run(SUITE)
if (SHOWN) {
  console.log('\n\n########## 以下是真窗口会话（单次 ≤20s、右下角、测完即清） ##########')
  results.push(...run(SHOWN_SUITE))
} else {
  console.log('\n[提示] 未跑真窗口会话。性能 CPU 需要真窗口才有意义：node tests/run-all.mjs --with-shown（需先获准）')
}

console.log('\n\n================ 汇总 ================')
for (const r of results) console.log((r.code === 0 ? '[PASS] ' : '[FAIL] ') + r.name + '  (exit=' + r.code + ')')
const bad = results.filter((r) => r.code !== 0)
console.log(bad.length ? `\n${bad.length} 项失败` : '\n全部通过')
killStrayElectron()
process.exit(bad.length ? 1 : 0)
