#!/usr/bin/env node
/* build-panel-v4.mjs —— 六版（批次一 高密度 ×3 / 批次二 五轴 ×3）
 * 共享语言（沿用 v3 被保留的部分）：深底板 + 1px 刻度尺 + 细网格 + 发丝线 + 等宽数字
 * 新增（v3 被否的两点）：① 引线标注（lead line）② 多区分色（按数据类型分区，不彩虹）
 * 输出：docs/panel-mocks-v4/{id}-{dark,light}.html
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ---------- 图标（与生产 runtime 同几何同色） ---------- */
function makeRnd (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function particles (n, r0, r1, key) {
  const rnd = makeRnd(90210 + 777 + 87 * 131); const o = []
  for (let i = 0; i < n; i++) {
    const th = rnd() * Math.PI * 2, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd()
    o.push({ x: +(100 + Math.cos(th) * r).toFixed(2), y: +(100 + Math.sin(th) * r * 0.94).toFixed(2), r: +(0.85 + z * 1.5).toFixed(2), op: +(0.26 + 0.74 * z).toFixed(3), z })
  }
  o.sort((a, b) => a.z - b.z)
  return o.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${key}" opacity="${p.op}"/>`).join('')
}
function icon (id) {
  return `<svg width="140" height="140" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="p${id}" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#050708" stop-opacity="0.90"/>
    <stop offset="78%" stop-color="#050708" stop-opacity="0.54"/>
    <stop offset="100%" stop-color="#050708" stop-opacity="0"/></radialGradient>
  <filter id="s${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#p${id})"/>
  <circle cx="100" cy="100" r="94" fill="none" stroke="#4d7a74" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${particles(98, 72, 92, '#5fd8c4')}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#5fd8c4" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="#4d7a74" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="#5fd8c4" opacity="0.18" filter="url(#s${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#5fd8c4" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="100" cy="100" r="12" fill="#5fd8c4"/></svg>`
}

/* ---------- 刻度尺 / 网格（v3 保留手法） ---------- */
function ruler (h, x, side) {
  let s = ''; const inw = side === 'l' ? 1 : -1
  for (let y = 6; y < h - 6; y += 7) {
    const long = (y - 6) % 35 === 0
    s += `<line x1="${x}" y1="${y}" x2="${x + inw * (long ? 7 : 3)}" y2="${y}" stroke="#2f3a3b" stroke-width="1"/>`
  }
  return s
}
function grid (w, h, cols = 3) {
  let s = ''
  for (let x = 20; x < w; x += 20) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#fff" stroke-width="1" opacity="0.022"/>`
  for (let y = 20; y < h; y += 20) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#fff" stroke-width="1" opacity="0.022"/>`
  for (let i = 1; i < cols; i++) { const x = (w * i) / cols; s += `<line x1="${x}" y1="8" x2="${x}" y2="${h - 8}" stroke="#fff" stroke-width="1" opacity="0.05"/>` }
  return s
}
/* ---------- 引线标注（v3 缺的东西）：从图标外环拉到数据锚点，端点圆点 + 标签 ---------- */
function leader (ic, x2, y2, label, value, unit, color, side) {
  const dx = x2 - ic[0], dy = y2 - ic[1], L = Math.hypot(dx, dy)
  const x1 = ic[0] + (dx / L) * 101, y1 = ic[1] + (dy / L) * 101
  const tx = x2 + (side === 'l' ? -8 : 8)
  const anchor = side === 'l' ? 'end' : 'start'
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2} ${y2} L${tx.toFixed(1)} ${y2}" fill="none" stroke="${color}" stroke-width="1" opacity="0.55"/>
    <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="2" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.9"/>
    <circle cx="${x2}" cy="${y2}" r="2.6" fill="${color}"/>
    <text x="${tx.toFixed(1)}" y="${y2 - 3}" text-anchor="${anchor}" class="leL" fill="#9aa8a9">${label}</text>
    <text x="${tx.toFixed(1)}" y="${y2 + 9}" text-anchor="${anchor}" class="leV" fill="${color}">${value}<tspan class="leU"> ${unit}</tspan></text>`
}
const HAIR = (c) => `<div class="hair"${c ? ` style="background:${c}"` : ''}></div>`

/* ---------- 数据 ---------- */
const D = {
  act: '跑整轮离屏回归', actD: 'node tests/run-all.mjs · 12 项',
  el: '00:42', think: ['正在核对 clearError 的发送时机：点击必须早于宿主回发的 state，', '否则窗口会先按旧状态渲染一帧再跳。'],
  cost: '0.428', cur: '¥', unit: 'CNY', delta: '▲ 0.021/步',
  tokIn: '112.7k', tokOut: '15.7k', tokAll: '128.4k', ctx: '62%', step: '14', avg: '3.0s',
  tools: [['Bash', 9, 'mint'], ['Read', 12, 'blue'], ['Edit', 3, 'violet']],
  tasks: [['01', 'done', '只读取证：WindowFromPoint 命中测试', '2.4s'], ['02', 'done', '旋转缺陷：核心静止 + 轴心归位', '1.1s'],
    ['03', 'done', '面板几何与穿透划分', '3.8s'], ['04', 'doing', '信息面板最终方案（深底板）', '—'],
    ['05', 'todo', '交给用户挑变体', ''], ['06', 'todo', '并入生产 runtime', '']],
  sess: 'dsh-work-icon · 3a91f2', sub: '2 子代理'
}
const C = { plate: '#101415', text: '#eaf1f1', dim: '#8b9a9b', line: '#2f3a3b', mint: '#5fd8c4', amber: '#ffb257', blue: '#7fd8ff', violet: '#b79cff' }

/* ============================ 变体定义 ============================ */
const V = {}

/* ---------- ①-1 密排仪表：一堆小读数块 = ---------- */
V['d1'] = {
  name: '①-1 密排仪表', batch: '批次一 · 高密度', pw: 320, ph: 214, wh: 399,
  note: '十几个等宽小读数块铺满，像真仪表盘；每块 = 标签 + 值 + 单位，值等宽、标签 8.5px',
  minFont: '8.5px（标签）', colorNote: '青=状态/完成 · 琥珀=金额/进行 · 蓝=tokens/读取 · 紫=编辑 · 灰=中性',
  body: (id) => {
    const gauge = (lab, val, unit, col, w) => `<div class="g" style="width:${w}px"><span class="gl">${lab}</span><span class="gv" style="color:${col}">${val}</span><span class="gu">${unit}</span></div>`
    const tools = D.tools.map(([n, c, k]) => `<div class="g tool"><span class="gl">${n}</span><span class="gv" style="color:${C[k]}">${c}</span><span class="gu">次</span><span class="bar"><i style="width:${Math.min(100, c * 7)}%;background:${C[k]}"></i></span></div>`).join('')
    const tasks = D.tasks.map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')
    return `<svg class="lid" width="320" height="399" viewBox="0 0 320 399">
      ${leader([160, 105], 40, 250, 'COST·SESSION', D.cur + D.cost, D.unit, C.amber, 'r')}
      ${leader([160, 105], 282, 300, 'TOKENS·TOTAL', D.tokAll, 'tok', C.blue, 'l')}
    </svg>
    <div class="plate" style="width:320px;height:214px;top:185px">
      <svg class="bg" width="320" height="214" viewBox="0 0 320 214" preserveAspectRatio="none">${grid(320, 214, 4)}${ruler(214, 13, 'l')}${ruler(214, 307, 'r')}</svg>
      <div class="in">
        <div class="head"><span class="kicker">WORK-ICON · LIVE</span><span class="he">${D.el}</span></div>
        ${HAIR()}
        <div class="act"><span class="dot"></span><span class="t1">${D.act}</span><span class="t2">${D.actD}</span></div>
        ${HAIR()}
        <div class="gwrap">
          ${gauge('STEP', D.step, '步', C.text, 62)}${gauge('AVG', D.avg, '/步', C.dim, 62)}
          ${gauge('CTX', D.ctx, '占用', C.blue, 62)}${gauge('TOK·IN', D.tokIn, '', C.dim, 62)}
          ${gauge('TOK·OUT', D.tokOut, '', C.dim, 62)}${gauge('SUBAGENT', '2', '个子会话', C.violet, 62)}
          ${tools}
        </div>
        ${HAIR()}
        <div class="th"><span class="lab">THINK · TAIL</span><span class="lab r">6 Hz 尾串增量</span></div>
        ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
        ${HAIR()}
        <div class="tw">${tasks}</div>
      </div>
    </div>`
  }
}

/* ---------- ①-2 单列表 + 微读数右栏 ---------- */
V['d2'] = {
  name: '①-2 单列 + 微读数右栏', batch: '批次一 · 高密度', pw: 300, ph: 214, wh: 399,
  note: '左侧一条主信息流（动作/思考/任务），右侧 78px 窄栏塞满细碎读数，两栏同一基准线',
  minFont: '8px（右栏标签）', colorNote: '青=任务完成 · 琥珀=金额 · 蓝=右栏读数 · 灰=中性',
  body: (id) => `<svg class="lid" width="300" height="399" viewBox="0 0 300 399">
      ${leader([150, 105], 262, 224, 'CTX 占用', D.ctx, '', C.blue, 'l')}
    </svg>
    <div class="plate" style="width:300px;height:214px;top:185px">
      <svg class="bg" width="300" height="214" viewBox="0 0 300 214" preserveAspectRatio="none">${grid(300, 214, 3)}${ruler(214, 13, 'l')}${ruler(214, 287, 'r')}</svg>
      <div class="in two">
        <div class="colL">
          <div class="head"><span class="kicker">WORK-ICON</span><span class="he">${D.el}</span></div>
          ${HAIR()}
          <div class="act"><span class="dot"></span><span class="t1">${D.act}</span><span class="t2">${D.actD}</span></div>
          ${HAIR()}
          <div class="th"><span class="lab">THINK · TAIL</span></div>
          ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
          ${HAIR()}
          <div class="th"><span class="lab">TASKS</span><span class="lab r">3 / 6</span></div>
          ${D.tasks.map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}
        </div>
        <div class="colR">
          <div class="mr big"><span class="ml">COST</span><span class="mv" style="color:${C.amber}">${D.cur}${D.cost}</span></div>
          <div class="mr"><span class="ml">Δ/STEP</span><span class="mv s" style="color:${C.amber}">0.021</span></div>
          ${HAIR('rgba(255,255,255,.07)')}
          <div class="mr"><span class="ml">STEP</span><span class="mv s">${D.step}</span></div>
          <div class="mr"><span class="ml">AVG</span><span class="mv s">${D.avg}</span></div>
          ${HAIR('rgba(255,255,255,.07)')}
          <div class="mr"><span class="ml">TOK·IN</span><span class="mv s">${D.tokIn}</span></div>
          <div class="mr"><span class="ml">TOK·OUT</span><span class="mv s">${D.tokOut}</span></div>
          <div class="mr"><span class="ml">CTX</span><span class="mv s" style="color:${C.blue}">${D.ctx}</span></div>
          <div class="ctxtrack"><i style="width:${D.ctx}"></i></div>
          ${HAIR('rgba(255,255,255,.07)')}
          ${D.tools.map(([n, c, k]) => `<div class="mr"><span class="ml">${n}</span><span class="mv s" style="color:${C[k]}">${c}</span></div>`).join('')}
          <div class="mr"><span class="ml">SUBS</span><span class="mv s" style="color:${C.violet}">2</span></div>
        </div>
      </div>
    </div>`
}

/* ---------- ①-3 网格分区（最满） ---------- */
V['d3'] = {
  name: '①-3 网格分区', batch: '批次一 · 高密度', pw: 320, ph: 220, wh: 405,
  note: '4 个区块各自带小标题+刻度：度量区 / 金额区 / 思考区 / 任务区，整体最"满"',
  minFont: '8px（区块标签）', colorNote: '青=状态 · 琥珀=金额 · 蓝=度量 · 紫=编辑 · 灰=思考',
  body: (id) => {
    const cell = (lab, val, unit, col) => `<div class="cl"><span class="cll">${lab}</span><span class="clv" style="color:${col}">${val}</span><span class="clu">${unit}</span></div>`
    return `<svg class="lid" width="320" height="405" viewBox="0 0 320 405">
      ${leader([160, 105], 42, 262, 'COST', D.cur + D.cost, D.unit, C.amber, 'r')}
      ${leader([160, 105], 280, 262, 'CTX', D.ctx, '占用', C.blue, 'l')}
    </svg>
    <div class="plate" style="width:320px;height:220px;top:185px">
      <svg class="bg" width="320" height="220" viewBox="0 0 320 220" preserveAspectRatio="none">${grid(320, 220, 4)}${ruler(220, 13, 'l')}${ruler(220, 307, 'r')}
        ${[0, 1, 2].map((i) => `<line x1="20" y1="${54 + i * 0}" x2="300" y2="${54 + i * 0}" stroke="#fff" stroke-width="1" opacity="0.06"/>`).join('')}
      </svg>
      <div class="in">
        <div class="head"><span class="kicker">WORK-ICON / SESSION 3a91f2</span><span class="he">${D.el} · STEP ${D.step}</span></div>
        ${HAIR()}
        <div class="zone">
          <span class="zlab" style="color:${C.mint}">METRICS</span>
          <div class="clrow">${cell('TOK·IN', D.tokIn, '', C.dim)}${cell('TOK·OUT', D.tokOut, '', C.dim)}${cell('CTX', D.ctx, '占用', C.blue)}${cell('AVG', D.avg, '/步', C.dim)}</div>
        </div>
        ${HAIR()}
        <div class="zone costz">
          <span class="zlab" style="color:${C.amber}">COST · SESSION</span>
          <div class="costline"><span class="cur">${D.cur}</span><span class="cnum">${D.cost}</span><span class="cunit">${D.unit}</span><span class="cdelta">${D.delta}</span></div>
        </div>
        ${HAIR()}
        <div class="zone">
          <span class="zlab" style="color:${C.dim}">THINK · TAIL</span>
          ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
        </div>
        ${HAIR()}
        <div class="zone">
          <span class="zlab" style="color:${C.mint}">TASKS 3/6</span>
          <div class="tgrid">${D.tasks.map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>`
  }
}

/* ---------- ②-1 引线主导 ---------- */
V['m1'] = {
  name: '②-1 引线主导', batch: '批次二 · 五轴', pw: 320, ph: 200, wh: 385,
  note: '引线是主角：4 条极细引线从图标外环拉到面板四角的数据点，标注贴在引线末端',
  minFont: '9px（引线标注）', colorNote: '青=状态 · 琥珀=金额 · 蓝=上下文 · 紫=子代理',
  body: (id) => `<svg class="lid" width="320" height="385" viewBox="0 0 320 385">
      ${leader([160, 105], 46, 246, 'COST·SESSION', D.cur + D.cost, D.unit, C.amber, 'r')}
      ${leader([160, 105], 274, 246, 'CTX 占用', D.ctx, '', C.blue, 'l')}
      ${leader([160, 105], 52, 318, 'TOKENS', D.tokAll, 'tok', C.dim, 'r')}
      ${leader([160, 105], 268, 318, 'SUBAGENT', '2', '会话', C.violet, 'l')}
    </svg>
    <div class="plate" style="width:320px;height:200px;top:185px">
      <svg class="bg" width="320" height="200" viewBox="0 0 320 200" preserveAspectRatio="none">${grid(320, 200, 4)}${ruler(200, 13, 'l')}${ruler(200, 307, 'r')}</svg>
      <div class="in">
        <div class="head"><span class="kicker">WORK-ICON · LIVE</span><span class="he">${D.el}</span></div>
        ${HAIR()}
        <div class="act"><span class="dot"></span><span class="t1">${D.act}</span><span class="t2">${D.actD}</span></div>
        ${HAIR()}
        <div class="th"><span class="lab">THINK · TAIL</span><span class="lab r">6 Hz 增量</span></div>
        ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
        ${HAIR()}
        <div class="th"><span class="lab">TASKS</span><span class="lab r">3 / 6</span></div>
        ${D.tasks.map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}
      </div>
    </div>`
}

/* ---------- ②-2 分区多色 ---------- */
V['m2'] = {
  name: '②-2 分区多色', batch: '批次二 · 五轴', pw: 320, ph: 206, wh: 391,
  note: '每类数据一个色相分区（左色条 + 同色标题），颜色承担"这是什么数据"的分类职责，不承担装饰',
  minFont: '8.5px（分区标签）', colorNote: '青=动作/任务 · 琥珀=金额 · 蓝=度量 · 紫=子代理 · 灰=思考',
  body: (id) => {
    const sec = (col, title, right, inner) => `<div class="sec" style="border-left-color:${col}"><div class="sh"><span class="sl" style="color:${col}">${title}</span><span class="sr">${right || ''}</span></div>${inner}</div>`
    return `<svg class="lid" width="320" height="391" viewBox="0 0 320 391">
      ${leader([160, 105], 268, 232, 'COST', D.cur + D.cost, D.unit, C.amber, 'l')}
    </svg>
    <div class="plate" style="width:320px;height:206px;top:185px">
      <svg class="bg" width="320" height="206" viewBox="0 0 320 206" preserveAspectRatio="none">${grid(320, 206, 4)}${ruler(206, 13, 'l')}${ruler(206, 307, 'r')}</svg>
      <div class="in">
        ${sec(C.mint, 'ACTION', D.el, `<div class="tl">${D.act} · ${D.actD}</div>`)}
        ${sec(C.amber, 'COST', '本会话', `<div class="costline sm"><span class="cur">${D.cur}</span><span class="cnum sm">${D.cost}</span><span class="cunit">${D.unit}</span><span class="cdelta">${D.delta}</span></div>`)}
        ${sec(C.blue, 'METRICS', 'STEP ' + D.step, `<div class="mr3"><span><b class="ml">IN</b><b class="mv">${D.tokIn}</b></span><span><b class="ml">OUT</b><b class="mv">${D.tokOut}</b></span><span><b class="ml">CTX</b><b class="mv" style="color:${C.blue}">${D.ctx}</b></span><span><b class="ml">SUBS</b><b class="mv" style="color:${C.violet}">2</b></span></div>`)}
        ${sec(C.dim, 'THINK · TAIL', '6 Hz', D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join(''))}
        ${sec(C.mint, 'TASKS', '3 / 6', `<div class="t2c">${D.tasks.map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}</div>`)}
      </div>
    </div>`
  }
}

/* ---------- ②-3 折中 ---------- */
V['m3'] = {
  name: '②-3 折中（板 + 关键引线）', batch: '批次二 · 五轴', pw: 300, ph: 196, wh: 381,
  note: '主体仍是信息板；只给金额与上下文两项关键数据拉引线，颜色分区但每个分区最多一个色相',
  minFont: '8.5px', colorNote: '青=状态/任务 · 琥珀=金额 · 蓝=上下文 · 灰=其余',
  body: (id) => `<svg class="lid" width="300" height="381" viewBox="0 0 300 381">
      ${leader([150, 105], 240, 236, 'COST', D.cur + D.cost, D.unit, C.amber, 'l')}
      ${leader([150, 105], 60, 236, 'CTX', D.ctx, '', C.blue, 'r')}
    </svg>
    <div class="plate" style="width:300px;height:196px;top:185px">
      <svg class="bg" width="300" height="196" viewBox="0 0 300 196" preserveAspectRatio="none">${grid(300, 196, 3)}${ruler(196, 13, 'l')}${ruler(196, 287, 'r')}</svg>
      <div class="in">
        <div class="head"><span class="kicker">WORK-ICON</span><span class="he">${D.el} · STEP ${D.step}</span></div>
        ${HAIR()}
        <div class="act"><span class="dot"></span><span class="t1">${D.act}</span><span class="t2">${D.actD} · ${D.tokAll} tok · ${D.avg}/步</span></div>
        ${HAIR()}
        <div class="th"><span class="lab">THINK · TAIL</span></div>
        ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
        ${HAIR()}
        <div class="th"><span class="lab">TASKS</span><span class="lab r">3 / 6 · 2 子代理</span></div>
        ${D.tasks.slice(0, 4).map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}
        <div class="tr more"><span class="ix"></span><span class="mk"></span><span class="tt">…+2 项</span></div>
      </div>
    </div>`
}

/* ============================ CSS ============================ */
const CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{width:500px;font-family:system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
  .desk{position:relative;width:500px;overflow:hidden}
  .win{position:absolute;left:90px}
  .iconWrap{position:absolute;left:calc(50% - 70px);top:35px;width:140px;height:140px}
  .hit{position:absolute;left:calc(50% - 70px);top:35px;width:140px;height:140px;border-radius:50%;outline:1px dashed rgba(255,255,255,.13)}
  .lid{position:absolute;left:0;top:0;pointer-events:none}
  .plate{position:absolute;left:0;overflow:hidden;border-radius:3px;
    background:linear-gradient(180deg,rgba(16,20,21,.955),rgba(9,11,12,.965) 46%,rgba(7,9,10,.97));
    box-shadow:0 18px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.45);
    border-top:1px solid rgba(255,255,255,.10);border-bottom:1px solid rgba(255,255,255,.05)}
  .plate::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(120deg,rgba(255,255,255,.045),rgba(255,255,255,0) 38%)}
  .bg{position:absolute;left:0;top:0}
  .in{position:relative;padding:9px 22px 8px}
  .in.two{display:block;padding-right:0}
  .colL{display:inline-block;width:186px;vertical-align:top}
  .colR{position:absolute;right:11px;top:9px;width:74px;text-align:right}
  .hair{height:1px;background:rgba(255,255,255,.075);margin:5px 0}
  .head{height:12px;line-height:12px}
  .kicker{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:8.5px;letter-spacing:1.4px;color:#7e8e8f}
  .he{float:right;font-family:Consolas,monospace;font-size:9px;color:#7d8b8c;font-variant-numeric:tabular-nums}
  .dot{position:absolute;left:0;top:5px;width:6px;height:6px;border-radius:50%;background:#5fd8c4;box-shadow:0 0 0 3px rgba(95,216,196,.14)}
  .act{position:relative;height:30px;padding-left:14px}
  .t1{display:block;font-size:12.5px;font-weight:700;color:#eaf1f1;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t2{display:block;font-size:9.5px;color:#8b9a9b;line-height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lab{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:1.2px;color:#7e8e8f}
  .lab.r,.th .r{float:right;letter-spacing:.4px;color:#6f7d7e}
  .th{height:12px;line-height:12px}
  .tl{font-size:10px;line-height:14px;color:#cfd9d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl.d{color:#9aa8a9}
  /* 小读数块 */
  .gwrap{margin:2px 0}
  .g{position:relative;display:inline-block;height:26px;vertical-align:top;padding-right:4px}
  .gl{display:block;font-family:Consolas,monospace;font-size:8px;letter-spacing:.9px;color:#7e8e8f}
  .gv{display:inline-block;font-family:Consolas,monospace;font-size:12px;font-variant-numeric:tabular-nums;color:#eaf1f1;line-height:14px}
  .gu{font-size:8px;color:#6f7d7e;margin-left:2px}
  .g.tool .bar{position:absolute;left:0;bottom:3px;width:54px;height:2px;background:rgba(255,255,255,.08)}
  .g.tool .bar i{display:block;height:2px}
  /* 网格分区的 cell */
  .zone{position:relative;padding:1px 0 1px 0}
  .zlab{display:block;font-family:Consolas,monospace;font-size:8px;letter-spacing:1.2px;margin-bottom:1px}
  .clrow{margin:0 -6px}
  .cl{display:inline-block;width:25%;padding:0 6px;vertical-align:top}
  .cll{display:block;font-family:Consolas,monospace;font-size:8px;color:#7e8e8f;letter-spacing:.8px}
  .clv{display:inline-block;font-family:Consolas,monospace;font-size:11.5px;font-variant-numeric:tabular-nums;color:#eaf1f1}
  .clu{font-size:8px;color:#6f7d7e;margin-left:2px}
  .costline{height:30px;line-height:30px}
  .costline.sm{height:22px;line-height:22px}
  .cur{font-size:13px;color:#8b9a9b;vertical-align:5px;margin-right:2px}
  .cnum{font-family:Consolas,monospace;font-size:26px;font-variant-numeric:tabular-nums;color:#f4f8f8;letter-spacing:.4px}
  .cnum.sm{font-size:19px}
  .cunit{font-size:9px;color:#7d8b8c;margin-left:4px;letter-spacing:.7px}
  .cdelta{font-family:Consolas,monospace;font-size:9px;color:#ffb257;margin-left:8px}
  /* 任务 */
  .tr{position:relative;height:13px;line-height:13px;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ix{display:inline-block;width:18px;font-family:Consolas,monospace;font-size:8.5px;color:#71807f}
  .mk{display:inline-block;width:13px;font-size:9px;color:#5d6b6c}
  .tt{color:#cbd5d5}
  .tr.done .tt{color:#93a1a2}.tr.done .mk{color:#5fd8c4}
  .tr.doing .tt{color:#f0f5f5}.tr.doing .mk{color:#5fd8c4}
  .tr.more .tt{color:#6f7d7e}
  .t2c{margin:0 -6px}.t2c .tr{display:inline-block;width:50%;padding:0 6px}
  /* 右栏 */
  .mr{height:13px;line-height:13px}
  .ml{font-family:Consolas,monospace;font-size:8px;color:#7e8e8f;letter-spacing:.6px;margin-right:5px}
  .mv{font-family:Consolas,monospace;font-size:11px;font-variant-numeric:tabular-nums;color:#eaf1f1}
  .mv.s{font-size:9.5px;color:#cbd5d5}
  .mr.big{height:20px;line-height:20px}
  .mr.big .mv{font-size:18px;color:#f4f8f8}
  .ctxtrack{height:3px;background:rgba(255,255,255,.09);margin:1px 0 3px}
  .ctxtrack i{display:block;height:3px;background:#7fd8ff}
  .mr3 span{display:inline-block;margin-right:9px}
  .mr3 .ml{font-size:8px;color:#7e8e8f;margin-right:3px}
  .mr3 .mv{font-size:9.5px;font-family:Consolas,monospace;font-variant-numeric:tabular-nums;color:#cbd5d5}
  /* 分区（②-2） */
  .sec{border-left:2px solid;padding-left:8px;margin:0 0 6px}
  .sh{height:12px;line-height:12px}
  .sl{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:1.2px}
  .sr{float:right;font-family:Consolas,monospace;font-size:8.5px;color:#6f7d7e}
  /* 引线标注 */
  .leL{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:.8px}
  .leV{font-family:Consolas,monospace;font-size:11.5px;font-variant-numeric:tabular-nums}
  .leU{font-size:8.5px;opacity:.72}
  .cap{width:500px;padding:15px 20px 18px;background:#141618;color:#e8ecee}
  .cap h3{margin:0 0 7px;font-size:15px}
  .cap h3 .ref{font-size:9.5px;color:#5fd8c4;border:1px solid #333c3d;border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.72;color:#b6c0c6}
  .cap .k{display:inline-block;width:66px;color:#7d888f}
`
const DESKS = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
}

for (const [vid, v] of Object.entries(V)) {
  for (const [dk, deskCss] of Object.entries(DESKS)) {
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${v.name}</title>
<style>${CSS}</style></head><body>
<div class="desk" style="height:${v.wh + 55}px;${deskCss}">
  <div class="win" style="top:30px;width:${v.pw}px;height:${v.wh}px">
    <div class="iconWrap">${icon(vid + dk)}</div>
    <div class="hit"></div>
    ${v.body(vid)}
  </div>
</div>
<div class="cap">
  <h3>${v.name} <span class="ref">参照：mobiGlas #02 · Spinner 刻度尺 #09 · Razorback 焦点 #11 · MC HUD 密度</span></h3>
  <div><span class="k">批次</span>${v.batch}</div>
  <div><span class="k">尺寸</span>面板 <b>${v.pw} × ${v.ph}</b>　窗口 <b>${v.pw} × ${v.wh}</b>（图标 140 居中，面板顶 = 175 + 10 = 185）</div>
  <div><span class="k">最小字号</span>${v.minFont}</div>
  <div><span class="k">多区分色</span>${v.colorNote}</div>
  <div><span class="k">技法</span>${v.note}</div>
  <div><span class="k">桌面</span>${dk === 'dark' ? '深色壁纸' : '浅色壁纸'}</div>
</div>
</body></html>`
    fs.writeFileSync(path.join(OUT, `${vid}-${dk}.html`), html)
  }
  console.log('written ' + vid + ' (' + v.name + ')')
}
