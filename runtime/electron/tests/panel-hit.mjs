#!/usr/bin/env node
/* panel-hit.mjs —— "面板可交互"的命中判据实测（全离屏、零真实输入、零光标移动）
 *
 * 用户 2026-09-13 撤回"面板整块穿透"的决定，原话：
 *   「你这个右边有个条，但是我不能拉动这个条……我现在撤回我这个决定，他就是一个可以交互的窗口」
 * 交互范围（用户拍板）：**图标圆 ∪ 面板可见矩形**。
 *   ⚠️ 不是整个窗口矩形 —— 那会让图标四周、面板周围的透明角也挡鼠标（用户明确否掉）。
 *
 * 本文件证明（全部机器可判，不靠人看）：
 *   ① 面板打开 ⇒ 面板可见矩形内被判为"可交互"（含右侧滚动条那一列）（main 判据 + exstyle）
 *   ② 面板矩形之外仍然穿透：图标↔面板之间的空隙、面板上沿之上、**面板左右两侧的透明角**
 *      （scale=200 时黑板 400 < 窗口 440，两侧各留 20px），以及窗口底边之下
 *   ③ 面板收起 ⇒ 判据退回"只有图标圆"，同一个点由 IN 变 out
 *   ④ 滚动条可拖 —— 走**内部路径**，绝不合成真实输入：
 *        · 主进程判据到达滚动条那一列（①）
 *        · 渲染层 DOM 命中测试认出滚动条（真拖动同一入口 hDown → scrollbar-hit=true）
 *        · 该次手势**不触发拖窗**（dragBy/dragEnd 各零次）⇒ 事件原路留给 Chromium 原生滚动条
 *        · 面板**真的有可滚动内容**（真实 v2 载荷灌满 ⇒ scrollHeight > clientHeight、滚动条占位 ≥6px）
 *
 * 取证通道：--test-timeline（主进程内部）+ --test-script（渲染层鼠标脚本），
 *   两者在**同一个进程**里共存：鼠标脚本负责双击开/关面板，时间轴负责把窗口局部坐标喂给
 *   insideIcon()（与 40ms 实时监看**同一段代码**）。双击走渲染层同一个 hDown/hUp —— 不合成真实输入。
 *   探针一律用**窗口局部坐标**（0,0 = 窗口左上角）：窗口位置带位置记忆，绝对坐标会漂。
 *
 * 隔离：只匹配本轮 spawn 的 PID / 本轮临时 home；窗口 --hidden；不显示、不碰光标、不合成输入。
 * 用法: node tests/panel-hit.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, readLog, killStrayElectron, sleep, section, report, runDir } from './harness.mjs'

const DIR = runDir('panel-hit')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }
const CLICK = (x, y) => `d,${x},${y};u,${x},${y}`
const OPEN = '160|' + CLICK(100, 100) + '|' + CLICK(100, 100)

/* scale=140：窗口 440×525，图标圆 (220,105) r=70 ⇒ 圆内 y ≤ 175；黑板/面板 (0,185)-(440,525)
   scale=200：窗口 440×600，图标圆 (220,150) r=100 ⇒ 圆内 y ≤ 250；黑板/面板 (0,260)-(440,600) */
const GEO140 = { cx: 220, cy: 105, hitR: 70, panelTop: 185, winW: 440, winH: 525 }
const GEO200 = { cx: 220, cy: 150, hitR: 100, panelTop: 260, winW: 440, winH: 600 }

/* ---------------------------------------------------------------- 证据工具 */
function parseDebug (st, phase) {
  const hits = []
  for (const l of st.stdout) {
    if (!l.includes('"phase"')) continue
    try { const j = JSON.parse(l); if (j.phase === phase) hits.push(j) } catch { /* ignore */ }
  }
  return hits
}
/* probes: [[ms, name, x, y], …]（x,y = **窗口局部坐标**）；mouse: [[at, specString], …]（渲染层鼠标脚本） */
function timelineSession (probes, { scale = 140, mouse = [], extra = [] } = {}) {
  const home = tmpHome('ph-' + Math.random().toString(36).slice(2, 8))
  const log = path.join(DIR, 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.log')
  const spec = probes.map(([ms, , x, y]) => ms + ',' + x + ',' + y).join('|')
  const argv = ['--hidden', '--test-timeline', spec, '--scale', String(scale), ...extra]
  if (mouse.length) argv.push('--test-script', JSON.stringify(mouse.map(([at, m]) => ({ at, mouse: m }))))
  return { home, log, argv, names: probes.map((p) => p[1]) }
}
/* 把 --test-timeline 的输出按**注册顺序**对回探针名（同一个数组 ⇒ 顺序天然一致） */
function probeResults (st, sess) {
  return parseDebug(st, 'hit-test').map((h, i) => Object.assign({ name: sess.names[i] || ('#' + i) }, h))
}
const fmt = (res) => res.map((p) => `${p.name}=${p.inside ? 'IN' : 'out'}${p.inPanel ? '/panel' : ''}(${p.local.x},${p.local.y})`).join(' ')

/* ================================================================ ① 面板打开：矩形内可交互 */
section('① 面板打开（scale=140）：面板可见矩形内 ⇒ 可交互（含右侧滚动条那一列）')
let sA = null
let stA = null
{
  const G = GEO140
  const midY = Math.round((G.panelTop + G.winH) / 2)          /* 355 */
  const sAWin = null
  void sAWin
  const probes = [
    [2000, 'panel:top', G.cx, G.panelTop + 6],                /* 191 */
    [2400, 'panel:mid', G.cx, midY],
    [2800, 'panel:bottom', G.cx, G.winH - 6],                 /* 519 */
    [3200, 'panel:scrollbar', G.winW - 6, midY],              /* 434 */
    [3600, 'panel:right', G.winW - 2, midY],                  /* 438 */
    [4000, 'panel:left', 2, midY],
    [4400, 'circleCenter', G.cx, G.cy],
    [4800, 'circleEdge', G.cx, G.cy + G.hitR - 1]             /* 174：圆内边缘 */
  ]
  sA = timelineSession(probes, { extra: ['--exstyle-probe'], mouse: [[900, OPEN]] })
  stA = runRuntime(sA.argv, { home: sA.home, log: sA.log })
  const r = await stA.waitExit(45000)
  check('离屏取证会话正常结束（退出码 0）', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(sA.log)
  check('窗口全程隐藏（show=false，屏幕上没有弹出任何东西）', /window created hidden/.test(lg), 'window created hidden')
  check('取证期间鼠标轮询已暂停（无 hit-test 轮询记录 ⇒ 全程没碰光标）', !/hit-test cursor=/.test(lg), '轮询已停')

  const res = probeResults(stA, sA)
  const ex = parseDebug(stA, 'exstyle')[0]
  const geo = parseDebug(stA, 'hit-geometry')[0]
  const by = (n) => res.find((p) => p.name === n)
  const rect = (res.find((p) => p.rect) || {}).rect || null
  const win = (res.find((p) => p.bounds) || {}).bounds || null
  console.log('  探针点（窗口局部→屏幕）: ' + fmt(res))
  console.log('  面板命中矩形: ' + JSON.stringify(rect) + '  窗口原点=' + JSON.stringify(win))
  if (ex) console.log('  exstyle ignore=off -> ' + ex.ignoreOff + '   ignore=on -> ' + ex.ignoreOn)
  if (geo) console.log('  几何段 named: ' + (geo.steps || []).filter((s) => s.name).map((s) => s.name + '=' + (s.inside ? 'IN' : 'out')).join(' '))

  check('渲染层把**真实布局**（#plate.getBoundingClientRect()）报给了主进程',
    /panel hitrect <- dom \{/.test(lg), (lg.split('\n').find((l) => l.includes('panel hitrect')) || '无上报').slice(-110))
  check('命中矩形 = 面板可见矩形（DOM 量到 0,185,442,527，夹进窗口 440×525 后为 0,185,440,525）',
    !!rect && rect.left === 0 && rect.top === 185 && rect.right === 440 && rect.bottom === 525,
    JSON.stringify(rect))
  check('命中矩形被夹进窗口（右/下不超出 window ⇒ 不存在"窗口外的可交互区"）',
    !!rect && rect.right <= 440 && rect.bottom <= 525 && rect.left >= 0 && rect.top >= 0, JSON.stringify(rect))

  const c = by('circleCenter')
  check('图标圆心仍可交互（圆本身没被改坏）', !!(c && c.inside === true && c.inCircle === true), c ? `inside=${c.inside} inCircle=${c.inCircle}` : '')
  const ce = by('circleEdge')
  check('圆内边缘（y=174 < cy+hitR=175）仍可交互', !!(ce && ce.inside === true && ce.inCircle === true), ce ? `inside=${ce.inside} inCircle=${ce.inCircle}` : '')
  for (const n of ['panel:top', 'panel:mid', 'panel:bottom', 'panel:scrollbar', 'panel:right', 'panel:left']) {
    const p = by(n)
    check(n + ' ⇒ 可交互（拦截鼠标）', !!(p && p.inside === true && p.inPanel === true),
      p ? `inside=${p.inside} inPanel=${p.inPanel} 局部=(${p.local.x},${p.local.y})` : '缺少该点')
  }
  check('exstyle 仍能被切成"拦截"（ignore=off 无 WS_EX_TRANSPARENT）',
    !!ex && /TRANSPARENT=no/.test(ex.ignoreOff), ex ? ex.ignoreOff : '无证据')
  check('几何段（实时监看同一段代码）里滚动条那一列也是"可交互"',
    !!geo && (geo.steps || []).some((s) => s.name === 'panel:scrollbar' && s.inside === true),
    geo ? (geo.steps || []).filter((s) => s.name).map((s) => s.name + '=' + s.inside).join(' ') : '无几何段')
  check('面板展开时的自检行符合新契约（iconCenter=true / belowIcon=false / panelTop=true / panelMid=true / scrollbar=true）',
    /panel hitcheck iconCenter=true belowIcon=false panelTop=true panelMid=true scrollbar=true/.test(lg),
    (lg.split('\n').find((l) => l.includes('panel hitcheck')) || '无自检行').slice(-145))
}

/* ================================================================ ② 面板矩形外仍穿透 */
section('② 面板矩形之外（图标↔面板之间的空隙、面板上沿之上、圆外）⇒ 仍然穿透')
{
  const G = GEO140
  const probes = [
    [900, 'gap:iconPanel', G.cx, G.hitR + 20],                /* y=90：圆外（>70）、面板上沿之上（<185） */
    [1100, 'gap:justAbovePanel', G.cx, G.panelTop - 5],       /* y=180：紧贴面板上沿之上 */
    [1300, 'outside:r105', G.cx + Math.round(G.hitR * 1.05), G.cy],
    [1500, 'outside:abovePanel', 6, G.panelTop - 8]           /* y=177、x=6：面板左上角外侧 */
  ]
  const s = timelineSession(probes, { mouse: [[900, OPEN]] })
  const st = runRuntime(s.argv, { home: s.home, log: s.log })
  const r = await st.waitExit(45000)
  check('离屏取证会话正常结束（退出码 0）', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(s.log)
  check('窗口全程隐藏', /window created hidden/.test(lg), 'window created hidden')
  check('取证期间没碰光标（无 hit-test 轮询记录）', !/hit-test cursor=/.test(lg), '轮询已停')
  check('面板确实开着（否则这些"穿透"断言毫无意义）', /panel OPEN（double-click）/.test(lg), 'panel OPEN')
  const res = probeResults(st, s)
  console.log('  探针点: ' + fmt(res))
  for (const n of ['gap:iconPanel', 'gap:justAbovePanel', 'outside:r105', 'outside:abovePanel']) {
    const p = res.find((x) => x.name === n)
    check(n + ' ⇒ 穿透（不是可交互）', !!(p && p.inside === false && p.inPanel === false),
      p ? `inside=${p.inside} inPanel=${p.inPanel} inCircle=${p.inCircle} 局部=(${p.local.x},${p.local.y})` : '缺少该点')
  }
  /* 与旧行为对齐：圆外 1.05R / 1.25R / 1.5R 仍然穿透（passthrough.mjs 的同一判据） */
  const prev = parseDebug(stA, 'hit-geometry')[0]
  const outside = ((prev && prev.steps) || []).filter((s) => !s.name && s.f >= 1.05)
  check('圆外（≥1.05R）全部穿透 —— 用户当年验收过的行为没有丢',
    outside.length > 0 && outside.every((s) => s.inside === false),
    outside.map((s) => s.f + 'x:' + s.inside).join(' '))
}

/* ================================================================ ②b 不同图标档下的透明处（scale=200） */
section('②b scale=200（窗口 440×600，面板 (0,260)-(440,600)）：透明处仍然穿透')
{
  const G = GEO200
  const midY = Math.round((G.panelTop + G.winH) / 2)          /* 430 */
  const probes = [
    [2000, 'panel:mid', G.cx, midY],
    [2400, 'panel:leftEdge', 2, midY],
    [2800, 'panel:top', G.cx, G.panelTop + 6],
    [3200, 'leftGap', 40, 200],                               /* 圆外（dx=180, dy=50 ⇒ d≈187 > 100）、面板上沿之上 */
    [3600, 'rightGap', 400, 200],
    [4000, 'gap:iconPanel', G.cx, G.panelTop - 5],            /* y=255：图标下沿(250)与面板上沿(260)之间那 10px 空隙 */
    [4400, 'outside:r105', G.cx + Math.round(G.hitR * 1.05), G.cy],
    [4800, 'belowWindow', G.cx, G.winH + 8]                   /* y=608：窗口底边之下 */
  ]
  const s = timelineSession(probes, { scale: 200, mouse: [[1200, OPEN]] })
  const st = runRuntime(s.argv, { home: s.home, log: s.log })
  const r = await st.waitExit(45000)
  check('离屏取证会话正常结束（退出码 0）', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(s.log)
  check('窗口 440×600（图标 200px 档）', /panel OPEN[^\n]*win=440x600/.test(lg),
    (lg.split('\n').find((l) => /panel OPEN（/.test(l)) || '无').slice(-90))
  check('黑板几何 0,260,442,342（DOM 量到的真实布局）',
    /panel plate[^\n]*: 0,260,442,342/.test(lg),
    (lg.split('\n').find((l) => /panel plate/.test(l)) || '无').slice(-80))
  const res = probeResults(st, s)
  console.log('  探针点: ' + fmt(res))
  const rect = (res.find((p) => p.rect) || {}).rect || null
  check('命中矩形上沿 = 面板上沿 260（图标那一带**不属于**面板；这是"不是整个窗口矩形"的实测）',
    !!rect && rect.top === 260, JSON.stringify(rect))
  const mid = res.find((p) => p.name === 'panel:mid')
  check('面板中部可交互（scale=200 下判据同样成立）', !!(mid && mid.inside === true), mid ? `inside=${mid.inside}` : '')
  const le = res.find((p) => p.name === 'panel:leftEdge')
  check('面板左边缘（x=2）可交互', !!(le && le.inside === true), le ? `inside=${le.inside}` : '')
  const pt = res.find((p) => p.name === 'panel:top')
  check('面板上沿内侧（y=266）可交互', !!(pt && pt.inside === true), pt ? `inside=${pt.inside}` : '')
  for (const [n, label, xy] of [['gap:iconPanel', '图标与面板之间的空隙（10px 空隙的中点）', '(220,255)'],
    ['leftGap', '面板上沿之上·左侧（x=40）', '(40,200)'],
    ['rightGap', '面板上沿之上·右侧（x=400）', '(400,200)'],
    ['outside:r105', '圆外 1.05R', '(325,150)'],
    ['belowWindow', '窗口底边之下', '(220,608)']]) {
    const p = res.find((x) => x.name === n)
    check(label + ' ' + xy + ' ⇒ 穿透', !!(p && p.inside === false && p.inPanel === false),
      p ? `inside=${p.inside} inPanel=${p.inPanel} inCircle=${p.inCircle}` : '缺少该点')
  }
}

/* ================================================================ ③ 面板收起 ⇒ 退回只有图标圆 */
section('③ 面板收起：判据退回"只有图标圆"，同一个点由 IN 变 out')
{
  const G = GEO140
  const midY = Math.round((G.panelTop + G.winH) / 2)
  /* ⚠️ 面板开/关会改变窗口尺寸（440×525 ↔ 210×210），而"图标圆心"在窗口里的位置**不是**窗口中心：
     开态 cx=geo.w/2=220，关态 cx=iconWin/2=105。所以同一物理点（图标圆心、圆外、空隙）在两种
     几何下的**窗口局部坐标不同** —— 用窗口中心 + 相对偏移（±窗口宽的一半）来写就不会错。 */
  const atCenter = (dx, dy, halfW, halfH) => [Math.round(halfW + dx), Math.round(halfH + dy)]
  const [openCx, openCy] = atCenter(0, 0, G.winW / 2, G.cy)              /* (220,105) */
  const [closedCx, closedCy] = atCenter(0, 0, 105, G.cy)                 /* (105,105) 关态：iconWin=210 ⇒ 中心 105 */
  const openMidX = atCenter(0, 0, G.winW / 2, midY)[0]
  const closedMidX = atCenter(0, 0, 105, midY)[0]
  const gapYOpen = G.cy + G.hitR + 5                                    /* 180：圆外(>175)、面板上沿(185)之前 */
  const r105ClosedX = Math.round(105 + G.hitR * 1.05)                    /* 关态：圆心 105 + 73.5 */
  const probes = [
    [2000, 'open:panelMid', openMidX, midY],
    [2400, 'open:circleCenter', openCx, openCy],
    [2800, 'open:gap', openCx, gapYOpen],
    [3600, 'closed:panelMid', closedMidX, midY],
    [4000, 'closed:circleCenter', closedCx, closedCy],
    [4400, 'closed:r105', r105ClosedX, closedCy],
    [4800, 'closed:gap', closedCx, gapYOpen]
  ]
  /* 两次双击：1200ms 开、3200ms 起手关（探针 2800 仍在开态，3600 起为关态） */
  const s = timelineSession(probes, { mouse: [[1200, OPEN], [3200, OPEN]] })
  const st = runRuntime(s.argv, { home: s.home, log: s.log })
  const r = await st.waitExit(45000)
  check('离屏会话正常结束（退出码 0）', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(s.log)
  check('窗口全程隐藏', /window created hidden/.test(lg), 'window created hidden')
  check('取证期间没有碰光标（无 hit-test 轮询记录）', !/hit-test cursor=/.test(lg), '轮询已停')
  const evs = (lg.match(/panel (OPEN|CLOSED)（[^）]*）/g) || [])
  check('日志里能看到面板确实开了又关（同一个进程内的对照）',
    evs.filter((x) => /^panel OPEN/.test(x)).length >= 1 && /panel CLOSED（double-click）/.test(lg), evs.join(' | '))
  const res = probeResults(st, s)
  console.log('  探针点: ' + res.map((p) => `${p.name}=${p.inside ? 'IN' : 'out'}${p.inPanel ? '/panel' : ''} open=${p.panelOpen}`).join(' '))
  const openMid = res.find((p) => p.name === 'open:panelMid')
  const closedMid = res.find((p) => p.name === 'closed:panelMid')
  check('开着的那一帧：面板中部可交互', !!(openMid && openMid.panelOpen === true && openMid.inside === true && openMid.inPanel === true),
    openMid ? `panelOpen=${openMid.panelOpen} inside=${openMid.inside}` : '缺少开态探针')
  const openCC = res.find((p) => p.name === 'open:circleCenter')
  check('开着的那一帧：图标圆心也可交互（圆没被面板矩形吃掉）',
    !!(openCC && openCC.panelOpen === true && openCC.inside === true && openCC.inCircle === true),
    openCC ? `panelOpen=${openCC.panelOpen} inside=${openCC.inside} inCircle=${openCC.inCircle}` : '')
  const openGap = res.find((p) => p.name === 'open:gap')
  check('开着的那一帧：图标↔面板之间的空隙仍然穿透',
    !!(openGap && openGap.panelOpen === true && openGap.inside === false),
    openGap ? `panelOpen=${openGap.panelOpen} inside=${openGap.inside}` : '')
  check('收起后：面板矩形为 null（没有任何残留的可交互面板区）',
    !!(closedMid && closedMid.panelOpen === false && closedMid.rect === null),
    closedMid ? `panelOpen=${closedMid.panelOpen} rect=${JSON.stringify(closedMid.rect)}` : '缺少收起态探针')
  check('收起后：**同一个点**（原面板中部 y=' + midY + '）由 IN 变为穿透',
    !!(closedMid && closedMid.inside === false && closedMid.inPanel === false),
    closedMid ? `inside=${closedMid.inside} inPanel=${closedMid.inPanel}` : '')
  const cc = res.find((p) => p.name === 'closed:circleCenter')
  check('收起后：图标圆心仍可交互', !!(cc && cc.panelOpen === false && cc.inside === true), cc ? `inside=${cc.inside}` : '')
  const o5 = res.find((p) => p.name === 'closed:r105')
  check('收起后：圆外（1.05R）穿透', !!(o5 && o5.inside === false), o5 ? `inside=${o5.inside}` : '')
  const gp = res.find((p) => p.name === 'closed:gap')
  check('收起后：图标与面板之间的空隙仍然穿透', !!(gp && gp.inside === false), gp ? `inside=${gp.inside}` : '')
}

/* ================================================================ ④ 滚动条可拖（内部路径） */
section('④ 滚动条可拖：主进程判据 + 渲染层手势识别 + 不误触拖窗（零真实输入）')
{
  const G = GEO140
  const home = tmpHome('panel-hit-drag')
  const log = path.join(DIR, 'drag.log')
  fs.rmSync(log, { force: true })
  const script = path.join(DIR, 'drag-script.json')
  /* 双击开面板 → **在滚动条那一列**做一次"按下-移动-抬起"（走与真实拖动同一套 hDown/hMove/hUp） */
  const SC = G.winW - 6
  const dragFrames = `d,${SC},300;m,${SC},360;m,${SC},420;u,${SC},420`
  /* ⚠️ 先灌真实 v2 载荷把面板撑出溢出（否则没有滑块可拖，结论是空的） */
  const items = []
  for (let i = 0; i < 28; i++) {
    items.push({ status: ['done', 'running', 'stopped', 'failed'][i % 4], label: 'agent-' + String(i + 1).padStart(2, '0'),
      depth: (i % 3) + 1, parent: i > 0 ? 'agent-01' : null, startedAt: Date.now() - i * 3000, toolCalls: i * 3 })
  }
  const payload = {
    protocolVersion: 2, kind: 'state', state: 'WORKING', activity: 'coding',
    progress: { applicable: true, done: 4, total: 6, unit: 'leaf', inProgress: 2, mode: 'item' },
    subagents: { total: 28, running: 7, done: 7, failed: 7, stopped: 7, unknown: 0, items },
    sessions: { total: 3, hidden: 0, items: [{ id: 'a', title: '主代理', progress: 0.67 }] },
    todos: { items: Array.from({ length: 12 }, (_, i) => ({ text: '任务项 ' + (i + 1), status: 'pending' })), more: 0 },
    cost: { status: 'ok', cost: { CNY: 1.5 }, priced: 1, unpriced: 0 },
    context: { applicable: true, used: 1200, limit: 128000, ratio: 0.009375 }
  }
  fs.writeFileSync(script, JSON.stringify([
    { at: 1000, mouse: '160|' + CLICK(100, 100) + '|' + CLICK(100, 100) },
    { at: 3000, mouse: '150|' + dragFrames },
    { at: 4400, mouse: '160|' + CLICK(100, 100) + '|' + CLICK(100, 100) }
  ]))
  const st = runRuntime(['--hidden', '--test-script', script, '--window-timeout', '60000', '--exit-after', '18'], { home, log })
  await new Promise((res) => setTimeout(res, 1800))
  st.send(payload)
  await new Promise((res) => setTimeout(res, 700))
  st.send(payload)
  const r = await st.waitExit(45000)
  check('离屏交互会话正常结束（退出码 0）', !!r && r.code === 0, 'exit=' + (r && r.code))
  const lg = readLog(log)
  check('窗口全程隐藏（没有在屏幕上弹出任何东西）', /window created hidden/.test(lg), 'window created hidden')
  const rl = lg.split(/\r?\n/).filter((l) => /renderer:/.test(l)).map((l) => l.replace(/^.*renderer: /, ''))
  console.log('  滚动/滚动条相关行:')
  for (const l of rl.filter((l) => /scrollbar|panel scroll/i.test(l)).slice(0, 10)) console.log('    ' + l.slice(0, 185))

  /* ④-a 面板确实有可滚动内容（否则"能拖滚动条"是空谈） */
  const over = rl.filter((l) => /panel scroll\(/.test(l)).map((l) => {
    const m = l.match(/scrollH=(\d+) clientH=(\d+) scrollW=(\d+)/)
    return m ? { h: Number(m[1]), c: Number(m[2]), w: Number(m[3]), line: l } : null
  }).filter(Boolean).filter((p) => p.h > p.c)
  check('真实载荷下确实出现溢出（scrollHeight > clientHeight）', over.length > 0,
    over.length ? ('max scrollH=' + Math.max(...over.map((p) => p.h)) + ' clientH=' + over[over.length - 1].c) : '无溢出样本')
  check('溢出时滚动容器确实绘制了滚动条（scrollW ≥ 6px 占位）', over.length > 0 && over.every((p) => p.w >= 6),
    over.length ? over.map((p) => p.w).join(',') : '无溢出样本')

  /* ④-b 渲染层手势识别：滚动条那一列的按下被认成"滚动条手势"，不是"拖窗口" */
  const sbDown = rl.find((l) => /mousedown.*scrollbar-hit=true/.test(l)) || ''
  check('滚动条那一列（x=' + SC + '）的 mousedown 被渲染层识别为滚动条手势（scrollbar-hit=true）', !!sbDown, sbDown.slice(0, 185))
  const sbUp = rl.find((l) => /scrollbar-drag-end/.test(l)) || ''
  check('该手势以 scrollbar-drag-end 收尾（走完同一条手势路径）', !!sbUp, sbUp.slice(0, 185))

  /* ④-c 该次手势**不能**变成拖窗口（否则一拖滚动条，图标就跟着跑） */
  const mainOnly = lg.split(/\r?\n/).filter((l) => !/renderer:/.test(l)).join('\n')
  const dragBys = (mainOnly.match(/drag-by /g) || []).length
  const dragEnds = (mainOnly.match(/drag-end/g) || []).length
  check('滚动条手势期间：dragBy 零次（事件原路留给 Chromium 原生滚动条）', dragBys === 0, 'drag-by=' + dragBys)
  check('滚动条手势期间：drag-end 零次（位置记忆不被污染）', dragEnds === 0, 'drag-end=' + dragEnds)
  check('双击关面板：回到"只有图标圆"（CLOSED 日志在）', /panel CLOSED（double-click）/.test(lg),
    (lg.split('\n').find((l) => l.includes('panel CLOSED')) || '无').slice(-70))
}

/* ================================================================ ⑤ 判据本身（源码级） */
section('⑤ 判据本身（源码级）：命中区是"图标圆 ∪ 面板矩形"，几何算法未被改动')
{
  const root = new URL('..', import.meta.url).pathname.replace(/^\//, '')
  const src = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  check('命中判据仍是同一个 insideIcon()（实时监看与取证共用，没有第二份实现）',
    (src.match(/function insideIcon \(px, py\)/g) || []).length === 1, '定义 1 处')
  check('判据用面板矩形（panelHitRects/inAnyRect），不是整个窗口矩形',
    /inAnyRect\(px - b\.x, py - b\.y, panelHitRects\(\)\)/.test(src) && /function panelHitRects/.test(src), '')
  check('面板收起 ⇒ 命中区退回"只有图标圆"（panelOpen=false 时面板矩形为空）',
    /if \(!panelOpen \|\| !geo \|\| !geo\.panelOpen\) return \[\]/.test(src), '')
  check('面板矩形来自渲染层 DOM 上报（ipcMain panel-hitrect），不是硬编码',
    /ipcMain\.on\('panel-hitrect'/.test(src) && /panelHitRect/.test(src), '')
  check('圆半径判据仍是 hitR = scale / 2（passthrough/v2 依赖它）', /hitR: scale \/ 2/.test(src), '')
  check('窗口尺寸/面板宽高的算法**没有被动过**（computeGeo 仍是 PANEL_W/PANEL_H/panelTop）',
    /const w = panelOpen \? PANEL_W : iconWin/.test(src) &&
    /const h = panelOpen \? \(iconWin - \(iconWin - scale\) \/ 2 \+ 10 \+ PANEL_H\) : iconWin/.test(src) &&
    /const panelTop = panelOpen \? \(iconWin \+ scale\) \/ 2 \+ 10 : null/.test(src), '')
  check('渲染层面板已可交互（body.panel-open #panel 打开 pointer-events）',
    /body\.panel-open #panel\{[^}]*pointer-events:auto/.test(html), '')
}

section(ok ? '面板可交互（命中判据）：全部通过' : '面板可交互（命中判据）：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
