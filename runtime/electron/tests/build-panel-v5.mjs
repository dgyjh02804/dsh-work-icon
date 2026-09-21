#!/usr/bin/env node
/* build-panel-v5.mjs —— 收敛稿：③-1 引线主导 / ③-2 分区多色 / ③-3 折中
 * 定位：「中等密度 + 在跑数据」= **中等元素数**，但每个元素带更多微读数（数值/单位/刻度/百分比/微型条/小环）
 *        + 纹理与动效线索（扫描带、边框呼吸、逐位跳动、微型火花线）—— **不靠加元素数量**
 * 交付物只是 DSH 图标的信息面板（不改任何客户端）
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ---------- 图标（与生产同几何同色） ---------- */
function makeRnd (s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function parts (n, r0, r1, col) {
  const rnd = makeRnd(90210 + 777 + 87 * 131), o = []
  for (let i = 0; i < n; i++) { const th = rnd() * 6.283, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd(); o.push({ x: +(100 + Math.cos(th) * r).toFixed(2), y: +(100 + Math.sin(th) * r * 0.94).toFixed(2), r: +(0.85 + z * 1.5).toFixed(2), op: +(0.26 + 0.74 * z).toFixed(3), z }) }
  o.sort((a, b) => a.z - b.z)
  return o.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${col}" opacity="${p.op}"/>`).join('')
}
const icon = (id) => `<svg width="140" height="140" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="Q${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#050708" stop-opacity=".90"/><stop offset="78%" stop-color="#050708" stop-opacity=".54"/><stop offset="100%" stop-color="#050708" stop-opacity="0"/></radialGradient>
  <filter id="F${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#Q${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#4d7a74" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${parts(98, 72, 92, '#5fd8c4')}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#5fd8c4" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="#4d7a74" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="#5fd8c4" opacity=".18" filter="url(#F${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#5fd8c4" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#5fd8c4"/></svg>`

/* ---------- 骨架件 ---------- */
function ruler (h, x, side) { let s = ''; const iw = side === 'l' ? 1 : -1; for (let y = 6; y < h - 6; y += 7) { const L = (y - 6) % 35 === 0; s += `<line x1="${x}" y1="${y}" x2="${x + iw * (L ? 7 : 3)}" y2="${y}" stroke="#2f3a3b" stroke-width="1"/>` } return s }
function grid (w, h, cols) { let s = ''; for (let x = 20; x < w; x += 20) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#fff" stroke-width="1" opacity=".022"/>`; for (let y = 20; y < h; y += 20) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#fff" stroke-width="1" opacity=".022"/>`; for (let i = 1; i < cols; i++) s += `<line x1="${(w * i) / cols}" y1="8" x2="${(w * i) / cols}" y2="${h - 8}" stroke="#fff" stroke-width="1" opacity=".05"/>`; return s }
/* 引线：从图标外环 r=101 拉到锚点，端点实心圆 + 标签/值/单位 */
function lead (ic, x2, y2, label, value, unit, col, side) {
  const dx = x2 - ic[0], dy = y2 - ic[1], L = Math.hypot(dx, dy)
  const x1 = ic[0] + (dx / L) * 101, y1 = ic[1] + (dy / L) * 101
  const tx = x2 + (side === 'l' ? -9 : 9), an = side === 'l' ? 'end' : 'start'
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2} ${y2} L${tx.toFixed(1)} ${y2}" fill="none" stroke="${col}" stroke-width="1" opacity=".5"/>
  <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="2" fill="none" stroke="${col}" stroke-width="1.2" opacity=".9"/>
  <circle cx="${x2}" cy="${y2}" r="2.6" fill="${col}"/>
  <text x="${tx.toFixed(1)}" y="${y2 - 3}" text-anchor="${an}" class="leL" fill="#9aa8a9">${label}</text>
  <text x="${tx.toFixed(1)}" y="${y2 + 9}" text-anchor="${an}" class="leV" fill="${col}">${value}<tspan class="leU"> ${unit}</tspan></text>`
}
/* 微型火花线（12 根柱，让金额"在跳"） */
const spark = (vals, col, w = 54, h = 9) => `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${vals.map((v, i) => `<rect x="${i * 4.5}" y="${(h - v * h).toFixed(1)}" width="2.6" height="${(v * h).toFixed(1)}" fill="${col}" opacity="${(0.35 + 0.65 * (i / vals.length)).toFixed(2)}"/>`).join('')}</svg>`
/* 微型刻度尺（10 格，用于金额下方） */
const tickline = (lit, col, dim, w = 96) => `<svg class="tk" width="${w}" height="4" viewBox="0 0 ${w} 4">${Array.from({ length: 20 }, (_, i) => `<rect x="${i * (w / 20)}" y="${i % 5 === 0 ? 0 : 1.4}" width="1.6" height="${i % 5 === 0 ? 4 : 2.6}" fill="${i < lit ? col : dim}" opacity="${i < lit ? 0.95 : 0.5}"/>`).join('')}</svg>`
/* 小环（上下文占用），比进度条更像仪表 */
const ring = (p, col, size = 26) => {
  const r = 10, c = 2 * Math.PI * r, on = c * p
  return `<svg class="rg" width="${size}" height="${size}" viewBox="0 0 26 26"><circle cx="13" cy="13" r="${r}" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
  <circle cx="13" cy="13" r="${r}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${on.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 13 13)"/></svg>`
}

/* ---------- 数据（中等元素数，但每个读数都带单位/刻度） ---------- */
const D = {
  act: '跑整轮离屏回归', actD: 'node tests/run-all.mjs · 12 项', el: '00:42', step: '14', avg: '3.0',
  think: ['正在核对 clearError 的发送时机：点击必须早于宿主回发的 state，', '否则窗口会先按旧状态渲染一帧再跳。'],
  cost: '0.428', cur: '¥', unit: 'CNY', delta: '▲0.021', perStep: '/步',
  tokIn: '112.7', tokOut: '15.7', tokAll: '128.4', ctx: 0.62, subs: '2',
  tasks: [['01', 'done', '只读取证：WindowFromPoint 命中测试'], ['02', 'done', '旋转缺陷：核心静止 + 轴心归位'], ['03', 'done', '面板几何与穿透划分'],
    ['04', 'doing', '信息面板最终方案'], ['05', 'todo', '交给用户挑变体'], ['06', 'todo', '并入生产 runtime']],
  sparks: [0.18, 0.32, 0.26, 0.45, 0.38, 0.55, 0.48, 0.62, 0.58, 0.72, 0.66, 0.85]
}
const C = { plate: '#101415', text: '#eaf1f1', dim: '#8b9a9b', line: '#2f3a3b', mint: '#5fd8c4', amber: '#ffb257', blue: '#7fd8ff', violet: '#b79cff' }

/* 分段任务条（6 段，每段带状态色） */
const segbar = () => `<svg width="150" height="5" viewBox="0 0 150 5">${D.tasks.map(([, k], i) => {
  const col = k === 'done' ? C.mint : k === 'doing' ? C.amber : '#ffffff'
  const op = k === 'todo' ? 0.16 : 1
  return `<rect x="${i * 26}" y="0" width="21" height="5" rx="1" fill="${col}" opacity="${op}"/>`
}).join('')}</svg>`

/* ============================ ③-1 引线主导 ============================ */
const v1 = {
  id: 'c1', name: '③-1 引线主导', pw: 320, ph: 196, wh: 381,
  note: '引线是主角：4 条极细引线从图标外环拉到数据点，标注贴末端（圆点 + 标签 + 值 + 单位）；板内只留动作/思考/任务三段，保证中等元素数',
  minFont: '8.5px（引线标签 / 微型标签）', colors: 5, elements: 14,
  body: () => `<svg class="lid" width="320" height="381" viewBox="0 0 320 381">
      ${lead([160, 105], 48, 244, 'COST·SESSION', D.cur + D.cost, D.unit, C.amber, 'r')}
      ${lead([160, 105], 272, 244, 'CTX', '62', '%', C.blue, 'l')}
      ${lead([160, 105], 54, 312, 'TOKENS', D.tokAll + 'k', 'tok', C.dim, 'r')}
      ${lead([160, 105], 266, 312, 'SUBAGENT', D.subs, '会话', C.violet, 'l')}
    </svg>
    <div class="plate" style="width:320px;height:196px;top:185px">
      <svg class="bg" width="320" height="196" viewBox="0 0 320 196" preserveAspectRatio="none">${grid(320, 196, 4)}${ruler(196, 13, 'l')}${ruler(196, 307, 'r')}</svg>
      <div class="scan"></div>
      <div class="in">
        <div class="head"><span class="live"><i></i><i></i><i></i></span><span class="kicker">WORK-ICON · LIVE</span><span class="he">${D.el} · STEP ${D.step} · ${D.avg}s/步</span></div>
        <div class="hair"></div>
        <div class="act"><span class="dot"></span><span class="t1">${D.act}</span><span class="t2">${D.actD}</span></div>
        <div class="hair"></div>
        <div class="th"><span class="lab">THINK · TAIL</span><span class="lab r">6 Hz 尾串增量 · 数字逐位跳动</span></div>
        ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
        <div class="hair"></div>
        <div class="th"><span class="lab">TASKS</span><span class="lab r">3 / 6</span></div>
        <div class="segrow">${segbar()}<span class="seglab">01 ✓ · 02 ✓ · 03 ✓ · 04 ● · 05 · · 06 ·</span></div>
      </div>
    </div>`
}

/* ============================ ③-2 分区多色主导 ============================ */
const v2 = {
  id: 'c2', name: '③-2 分区多色主导', pw: 320, ph: 202, wh: 387,
  note: '5 个色相分区（左色条 + 同色标签）承担"这是什么数据"的分类职责；每个读数都带单位与微型条/环，只有金额一项拉引线',
  minFont: '8px（分区标签 / 微型读数标签）', colors: 6, elements: 17,
  body: () => {
    const sec = (col, title, right, inner) => `<div class="sec" style="border-left-color:${col}"><div class="sh"><span class="sl" style="color:${col}">${title}</span><span class="sr">${right}</span></div>${inner}</div>`
    const mr = (l, v, u, col) => `<span class="mr"><b class="ml">${l}</b><b class="mv"${col ? ` style="color:${col}"` : ''}>${v}</b><i class="mu">${u}</i></span>`
    return `<svg class="lid" width="320" height="387" viewBox="0 0 320 387">
      ${lead([160, 105], 268, 236, 'COST', D.cur + D.cost, D.unit, C.amber, 'l')}
    </svg>
    <div class="plate" style="width:320px;height:202px;top:185px">
      <svg class="bg" width="320" height="202" viewBox="0 0 320 202" preserveAspectRatio="none">${grid(320, 202, 4)}${ruler(202, 13, 'l')}${ruler(202, 307, 'r')}</svg>
      <div class="scan"></div>
      <div class="in">
        ${sec(C.mint, 'ACTION', `<span class="live"><i></i><i></i><i></i></span> ${D.el}`, `<div class="tl">${D.act} · ${D.actD}</div>`)}
        ${sec(C.amber, 'COST · SESSION', `<span class="mu">CNY</span>`, `<div class="costrow"><span class="cur">${D.cur}</span><span class="cnum">${D.cost}</span><span class="cdelta">${D.delta}<i class="mu">${D.perStep}</i></span>${spark(D.sparks, C.amber)}</div><div class="tkrow">${tickline(13, C.amber, '#3a4446')}<span class="mufoot">41 / 60 格 · 上限 ¥0.65</span></div>`)}
        ${sec(C.blue, 'METRICS', `<span class="mu">STEP ${D.step}</span>`, `<div class="mrow">${mr('TOK·IN', D.tokIn, 'k', C.dim)}${mr('OUT', D.tokOut, 'k', C.dim)}${mr('ALL', D.tokAll, 'k', C.text)}${mr('AVG', D.avg, 's/步', C.dim)}${mr('SUBS', D.subs, '个', C.violet)}<span class="ringw">${ring(D.ctx, C.blue)}<b class="mv" style="color:${C.blue}">62</b><i class="mu">%CTX</i></span></div>`)}
        ${sec(C.dim, 'THINK · TAIL', `<span class="mu">2 行 · 200 字</span>`, D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join(''))}
        ${sec(C.mint, 'TASKS', `<span class="mu">3 / 6 · 12 段上限</span>`, `<div class="t2c">${D.tasks.map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}</div>`)}
      </div>
    </div>`
  }
}

/* ============================ ③-3 折中 ============================ */
const v3 = {
  id: 'c3', name: '③-3 折中', pw: 300, ph: 196, wh: 381,
  note: '信息板为主体；只有金额与上下文两项关键数据拉引线；分区多色但每个分区最多一个色相，微型读数点缀在值后面',
  minFont: '8.5px', colors: 5, elements: 15,
  body: () => `<svg class="lid" width="300" height="381" viewBox="0 0 300 381">
      ${lead([150, 105], 58, 240, 'COST', D.cur + D.cost, D.unit, C.amber, 'r')}
      ${lead([150, 105], 240, 240, 'CTX', '62', '%', C.blue, 'l')}
    </svg>
    <div class="plate" style="width:300px;height:196px;top:185px">
      <svg class="bg" width="300" height="196" viewBox="0 0 300 196" preserveAspectRatio="none">${grid(300, 196, 3)}${ruler(196, 13, 'l')}${ruler(196, 287, 'r')}</svg>
      <div class="scan"></div>
      <div class="in">
        <div class="head"><span class="live"><i></i><i></i><i></i></span><span class="kicker">WORK-ICON</span><span class="he">${D.el} · STEP ${D.step} · ${D.avg}s/步</span></div>
        <div class="hair"></div>
        <div class="act"><span class="dot"></span><span class="t1">${D.act}</span><span class="t2">${D.actD} · <b class="mv">${D.tokAll}k</b><i class="mu">tok</i> · <b class="mv" style="color:${C.blue}">62</b><i class="mu">%ctx</i></span></div>
        <div class="hair"></div>
        <div class="th"><span class="lab" style="color:${C.dim}">THINK · TAIL</span><span class="lab r">6 Hz 增量</span></div>
        ${D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join('')}
        <div class="hair"></div>
        <div class="th"><span class="lab" style="color:${C.mint}">TASKS</span><span class="lab r">3 / 6 · 2 子代理</span></div>
        ${D.tasks.slice(0, 4).map(([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span></div>`).join('')}
        <div class="tr more"><span class="ix"></span><span class="mk"></span><span class="tt">…+2 项（12 条为上限）</span></div>
      </div>
    </div>`
}

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
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
  /* 扫描带（"在跑数据"的纹理线索；生产里由 JS 驱动 0.35Hz 自上而下掠过） */
  .scan{position:absolute;left:0;right:0;top:36%;height:30px;pointer-events:none;
    background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.055) 45%,rgba(255,255,255,.02) 60%,rgba(255,255,255,0) 100%)}
  .bg{position:absolute;left:0;top:0}
  .in{position:relative;padding:9px 22px 8px}
  .hair{height:1px;background:rgba(255,255,255,.075);margin:5px 0}
  .head{height:12px;line-height:12px}
  .kicker{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:8.5px;letter-spacing:1.4px;color:#7e8e8f}
  .he{float:right;font-family:Consolas,monospace;font-size:9px;color:#7d8b8c;font-variant-numeric:tabular-nums}
  .live{display:inline-block;margin-right:6px;vertical-align:1px}
  .live i{display:inline-block;width:3px;height:3px;border-radius:50%;background:#5fd8c4;margin-right:2px;opacity:.4}
  .live i:nth-child(2){opacity:.7}.live i:nth-child(3){opacity:1}
  .dot{position:absolute;left:0;top:5px;width:6px;height:6px;border-radius:50%;background:#5fd8c4;box-shadow:0 0 0 3px rgba(95,216,196,.14)}
  .act{position:relative;height:30px;padding-left:14px}
  .t1{display:block;font-size:12.5px;font-weight:700;color:#eaf1f1;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t2{display:block;font-size:9.5px;color:#8b9a9b;line-height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lab{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:1.2px;color:#7e8e8f}
  .th .r{float:right;letter-spacing:.3px;color:#6f7d7e}
  .th{height:12px;line-height:12px}
  .tl{font-size:10px;line-height:14px;color:#cfd9d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl.d{color:#9aa8a9}
  .tr{position:relative;height:13px;line-height:13px;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ix{display:inline-block;width:18px;font-family:Consolas,monospace;font-size:8.5px;color:#71807f}
  .mk{display:inline-block;width:13px;font-size:9px;color:#5d6b6c}
  .tt{color:#cbd5d5}
  .tr.done .tt{color:#93a1a2}.tr.done .mk{color:#5fd8c4}.tr.doing .tt{color:#f0f5f5}.tr.doing .mk{color:#5fd8c4}.tr.more .tt{color:#6f7d7e}
  .t2c{margin:0 -6px}.t2c .tr{display:inline-block;width:50%;padding:0 6px}
  .segrow{height:14px;line-height:14px}
  .seglab{font-family:Consolas,monospace;font-size:8.5px;color:#6f7d7e;margin-left:8px;letter-spacing:.4px}
  /* 分区（③-2） */
  .sec{border-left:2px solid;padding-left:8px;margin:0 0 4px}
  .sh{height:12px;line-height:12px}
  .sl{font-family:Consolas,monospace;font-size:8px;letter-spacing:1.2px}
  .sr{float:right;font-family:Consolas,monospace;font-size:8px;color:#6f7d7e}
  .mu{font-style:normal;font-family:Consolas,monospace;font-size:8px;color:#6f7d7e;margin-left:2px}
  .mufoot{font-family:Consolas,monospace;font-size:8px;color:#6f7d7e;margin-left:6px}
  .costrow{position:relative;height:26px;line-height:26px}
  .cur{font-size:13px;color:#8b9a9b;vertical-align:5px;margin-right:2px}
  .cnum{font-family:Consolas,monospace;font-size:24px;font-variant-numeric:tabular-nums;color:#f4f8f8}
  .cdelta{font-family:Consolas,monospace;font-size:9px;color:#ffb257;margin-left:7px}
  .spark{position:absolute;right:0;top:8px}
  .tkrow{height:12px;line-height:12px}
  .mrow{height:26px;line-height:26px}
  .mr{display:inline-block;margin-right:7px;white-space:nowrap}
  .ml{font-family:Consolas,monospace;font-size:8px;color:#7e8e8f;margin-right:3px;font-weight:400}
  .mv{font-family:Consolas,monospace;font-size:10px;font-variant-numeric:tabular-nums;color:#cbd5d5;font-weight:400}
  .ringw{display:inline-block;white-space:nowrap}
  .ringw .rg{vertical-align:-7px;margin-right:2px}
  .leL{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:.8px}
  .leV{font-family:Consolas,monospace;font-size:11.5px;font-variant-numeric:tabular-nums}
  .leU{font-size:8.5px;opacity:.72}
  .cap{width:500px;padding:15px 20px 18px;background:#141618;color:#e8ecee}
  .cap h3{margin:0 0 7px;font-size:15px}
  .cap h3 .ref{font-size:9.5px;color:#5fd8c4;border:1px solid #333c3d;border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.72;color:#b6c0c6}
  .cap .k{display:inline-block;width:72px;color:#7d888f}
`
const DESK = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
}
for (const v of [v1, v2, v3]) {
  for (const [dk, css] of Object.entries(DESK)) {
    fs.writeFileSync(path.join(OUT, `${v.id}-${dk}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${v.name}</title>
<style>${CSS}</style></head><body>
<div class="desk" style="height:${v.wh + 55}px;${css}">
  <div class="win" style="top:30px;width:${v.pw}px;height:${v.wh}px">
    <div class="iconWrap">${icon(v.id + dk)}</div><div class="hit"></div>${v.body()}
  </div>
</div>
<div class="cap">
  <h3>${v.name} <span class="ref">中等密度 + 在跑数据</span></h3>
  <div><span class="k">尺寸</span>面板 <b>${v.pw} × ${v.ph}</b>　窗口 <b>${v.pw} × ${v.wh}</b>（图标 140 居中，面板顶 = 175 + 10 = 185）</div>
  <div><span class="k">元素 / 字号</span>数据元素 <b>${v.elements} 个</b>（中等）· 最小字号 <b>${v.minFont}</b> · 配色 <b>${v.colors} 色</b>（≤6）</div>
  <div><span class="k">在跑数据</span>每个读数带单位/刻度/微型条/小环 + 扫描带、状态点脉冲、金额逐位跳动、火花线随金额增长</div>
  <div><span class="k">呈现方式</span>${v.note}</div>
  <div><span class="k">桌面</span>${dk === 'dark' ? '深色壁纸' : '浅色壁纸（仅用于对比度实测）'}</div>
</div></body></html>`)
  }
  console.log('written ' + v.id + ' — ' + v.name)
}
