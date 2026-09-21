#!/usr/bin/env node
/* build-panel-v6.mjs —— ③-2 放大版（深蓝半透明底 + 淡蓝结构线 + 分区着色 + 每值配图形）
 *
 * 如何避免滑进「深蓝黑 + 荧光青发光字」这个俗套（用户红线，FUI 指南列的头号错误）：
 *   ① 底读作"深蓝"而非"发蓝的黑"：#18293f→#0f1c2c→#0b1521 三层渐变 + 22px 网格 + 斜向微高光 + 顶部 1px 高光，
 *      明度明显高于纯黑（底板相对亮度 ≈0.012，纯黑是 0），有材质有层次，不是平涂。
 *   ② **文字一律不发光**：全卡 0 处 text-shadow / drop-shadow 落在文字上；对比度靠冷白 + 色相区分。
 *      唯一的"光"是状态点/图形元素上的极淡 halo（≤0.14 alpha），且不是文字。
 *   ③ **多区分色**：青只是 5 个分区色之一（动作），另有金（花费）/淡蓝（度量）/中性冷灰（思考）/紫（任务），
 *      单色铺满全屏的情况不存在。
 * 每值配形：金额→火花线+微型刻度 · 上下文→环形 · 任务→分段条+行内微条 · tokens→条形 · 步数→细密刻度尺
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ---------- 图标（主图标同色系：青作为分区色之一） ---------- */
function makeRnd (s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function parts (n, r0, r1, col) {
  const rnd = makeRnd(90210 + 777 + 87 * 131), o = []
  for (let i = 0; i < n; i++) { const th = rnd() * 6.283, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd(); o.push({ x: +(100 + Math.cos(th) * r).toFixed(2), y: +(100 + Math.sin(th) * r * 0.94).toFixed(2), r: +(0.85 + z * 1.5).toFixed(2), op: +(0.26 + 0.74 * z).toFixed(3), z }) }
  o.sort((a, b) => a.z - b.z)
  return o.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${col}" opacity="${p.op}"/>`).join('')
}
const icon = (id) => `<svg width="140" height="140" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="P${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#07121d" stop-opacity=".92"/><stop offset="78%" stop-color="#07121d" stop-opacity=".56"/><stop offset="100%" stop-color="#07121d" stop-opacity="0"/></radialGradient>
  <filter id="G${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#P${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#3f6f86" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${parts(98, 72, 92, '#56d9c8')}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#56d9c8" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="#3f6f86" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="#56d9c8" opacity=".18" filter="url(#G${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#56d9c8" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#56d9c8"/></svg>`

/* ---------- 骨架件 ---------- */
function ruler (h, x, side) { let s = ''; const iw = side === 'l' ? 1 : -1; for (let y = 6; y < h - 6; y += 7) { const L = (y - 6) % 35 === 0; s += `<line x1="${x}" y1="${y}" x2="${x + iw * (L ? 7 : 3)}" y2="${y}" stroke="#31536e" stroke-width="1"/>` } return s }
function grid (w, h, cols) { let s = ''; for (let x = 22; x < w; x += 22) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#9dc4e6" stroke-width="1" opacity=".035"/>`; for (let y = 22; y < h; y += 22) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#9dc4e6" stroke-width="1" opacity=".035"/>`; for (let i = 1; i < cols; i++) s += `<line x1="${(w * i) / cols}" y1="10" x2="${(w * i) / cols}" y2="${h - 10}" stroke="#9dc4e6" stroke-width="1" opacity=".07"/>`; return s }
function lead (ic, x2, y2, label, value, unit, col, side) {
  const dx = x2 - ic[0], dy = y2 - ic[1], L = Math.hypot(dx, dy)
  const x1 = ic[0] + (dx / L) * 101, y1 = ic[1] + (dy / L) * 101
  const tx = x2 + (side === 'l' ? -10 : 10), an = side === 'l' ? 'end' : 'start'
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2} ${y2} L${tx.toFixed(1)} ${y2}" fill="none" stroke="${col}" stroke-width="1" opacity=".55"/>
  <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="2.2" fill="none" stroke="${col}" stroke-width="1.2" opacity=".9"/>
  <circle cx="${x2}" cy="${y2}" r="2.8" fill="${col}"/>
  <text x="${tx.toFixed(1)}" y="${y2 - 4}" text-anchor="${an}" class="leL" fill="#a8c4dc">${label}</text>
  <text x="${tx.toFixed(1)}" y="${y2 + 11}" text-anchor="${an}" class="leV" fill="${col}">${value}<tspan class="leU"> ${unit}</tspan></text>`
}
/* 图表件（每个数值都配一个形状） */
const spark = (vals, col, w, h) => `<svg class="sp" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${vals.map((v, i) => { const bh = Math.max(1.5, v * h); return `<rect x="${(i * (w / vals.length)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(w / vals.length - 1.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="0.6" fill="${col}" opacity="${(0.30 + 0.70 * (i / (vals.length - 1))).toFixed(2)}"/>` }).join('')}</svg>`
const tickruler = (lit, total, col, dim, w) => `<svg class="tr2" width="${w}" height="9" viewBox="0 0 ${w} 9">${Array.from({ length: total }, (_, i) => { const x = i * (w / total); const on = i < lit; const big = i % 5 === 0; return `<rect x="${x.toFixed(1)}" y="${big ? 0 : 2.4}" width="1.4" height="${big ? 9 : 4.2}" fill="${on ? col : dim}" opacity="${on ? .95 : .5}"/>` }).join('')}</svg>`
const ring = (p, col, size, label) => {
  const r = (size - 9) / 2, c = 2 * Math.PI * r
  return `<svg class="rg2" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#9dc4e6" stroke-opacity=".18" stroke-width="2.6"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  <text x="${size / 2}" y="${size / 2 + 3.4}" text-anchor="middle" class="rgt" fill="${col}">${label}</text></svg>`
}
const bar = (p, col, w = 44, h = 5) => `<svg class="br" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="1" fill="#9dc4e6" opacity=".14"/><rect width="${(w * p).toFixed(1)}" height="${h}" rx="1" fill="${col}"/></svg>`
const segbar = (tasks, w) => { const seg = (w - (tasks.length - 1) * 3) / tasks.length; return `<svg class="sg" width="${w}" height="6" viewBox="0 0 ${w} 6">${tasks.map(([, k], i) => { const col = k === 'done' ? Z.task : k === 'doing' ? Z.money : '#9dc4e6'; const op = k === 'todo' ? .22 : 1; return `<rect x="${(i * (seg + 3)).toFixed(1)}" y="0" width="${seg.toFixed(1)}" height="6" rx="1" fill="${col}" opacity="${op}"/>` }).join('')}</svg>` }

/* ---------- 数据 + 分区色（青只是其一） ---------- */
const D = {
  act: '跑整轮离屏回归', actD: 'node tests/run-all.mjs · 12 项', el: '00:42', step: '14', avg: '3.0',
  think: ['正在核对 clearError 的发送时机：点击必须早于宿主回发的 state，', '否则窗口会先按旧状态渲染一帧再跳。'],
  cost: '0.428', cur: '¥', delta: '▲0.021', perStep: '/步', cap: '0.65',
  tokIn: 112.7, tokOut: 15.7, tokAll: '128.4', ctxP: 0.62, subs: '2',
  tasks: [['01', 'done', '只读取证：WindowFromPoint 命中测试'], ['02', 'done', '旋转缺陷：核心静止 + 轴心归位'], ['03', 'done', '面板几何与穿透划分'],
    ['04', 'doing', '信息面板最终方案'], ['05', 'todo', '交给用户挑变体'], ['06', 'todo', '并入生产 runtime']],
  sparks: [0.16, 0.28, 0.22, 0.4, 0.34, 0.5, 0.44, 0.58, 0.52, 0.68, 0.62, 0.82, 0.74, 0.9]
}
const Z = { act: '#56d9c8', money: '#ffc266', metric: '#6fb6ff', think: '#9fb0c4', task: '#b79cff', ink: '#e8f0fa', dim: '#98b0c6' }

/* ---------- 面板（两档尺寸共用同一结构，仅间距/列数不同） ----------
   A = 底板不透明度（本轮新增：把"通透感 vs 可读性"的取舍直接出图给用户看）
   ⚠️ backdrop-filter（真毛玻璃）在 Electron 透明窗口上无效（背后无可采样内容），
      所以"半透明"只能靠降 alpha，做不到"模糊透出背景"——这是硬约束。 */
function panel (W, H, big, A = 0.96) {
  const pad = big ? 18 : 15
  const cols = big ? 4 : 3
  const pl = (hex, a) => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a.toFixed(3)})` }
  const PA = `linear-gradient(168deg,${pl('#18293f', Math.min(1, A + 0.02))} 0%,${pl('#122134', A)} 38%,${pl('#0f1c2c', A)} 66%,${pl('#0b1521', Math.min(1, A + 0.01))} 100%)`
  const sec = (col, title, right, inner) => `<div class="sec" style="border-left-color:${col}"><div class="sh"><span class="sl" style="color:${col}">${title}</span><span class="sr">${right}</span></div>${inner}</div>`
  const metric = (l, v, u, p, col) => `<span class="mt"><b class="ml">${l}</b><b class="mv" style="color:${col}">${v}</b><i class="mu">${u}</i>${bar(p, col, big ? 40 : 34, 4)}</span>`
  const mgrid = `<div class="mgrid" style="grid-template-columns:repeat(${cols},1fr)">
      ${metric('TOK·IN', D.tokIn, 'k', D.tokIn / 200, Z.metric)}
      ${metric('TOK·OUT', D.tokOut, 'k', D.tokOut / 200, Z.metric)}
      ${metric('TOK·ALL', D.tokAll, 'k', 128.4 / 200, Z.ink)}
      ${metric('AVG', D.avg, 's/步', 0.3, Z.dim)}
    </div>`
  const ctxRing = `<span class="cw">${ring(D.ctxP, Z.metric, big ? 46 : 40, '62%')}<b class="cwlab">CTX 占用<br><i class="mu">上限 200k</i></b></span>`
  const taskRow = ([n, k, t]) => `<div class="tr ${k}"><span class="ix">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span><span class="tt">${t}</span>${bar(k === 'done' ? 1 : k === 'doing' ? 0.5 : 0, k === 'todo' ? '#5f7893' : k === 'done' ? Z.task : Z.money, big ? 46 : 36, 4)}</div>`
  return `<div class="plate" style="width:${W}px;height:${H}px;top:185px;background:${PA}">
      <svg class="bg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid(W, H, cols + 1)}${ruler(H, 13, 'l')}${ruler(H, W - 13, 'r')}</svg>
      <div class="sheen" style="opacity:${(A / 0.96).toFixed(2)}"></div><div class="scan"></div>
      <div class="in" style="padding:${big ? 13 : 11}px ${big ? 26 : 22}px ${big ? 12 : 10}px">
        <div class="head"><span class="live"><i></i><i></i><i></i></span><span class="kicker">WORK-ICON · LIVE</span>
          <span class="he">${D.el} · STEP ${D.step} · ${D.avg}s/步${big ? ' · 3a91f2' : ''}</span></div>
        ${sec(Z.act, 'ACTION', `${D.el} · STEP ${D.step}`, `<div class="tl"><b class="t1">${D.act}</b> · ${D.actD}</div><div class="tstrip">${segbar(D.tasks, big ? 220 : 170)}<span class="slab">6 段 = 任务上限</span></div>`)}
        ${sec(Z.money, 'COST · SESSION', `上限 ¥${D.cap}`, `<div class="costrow"><span class="cur" style="color:${Z.money}">${D.cur}</span><span class="cnum" style="color:${Z.money}">${D.cost}</span><span class="cdelta">${D.delta}<i class="mu">${D.perStep}</i></span>${spark(D.sparks, Z.money, big ? 108 : 84, big ? 24 : 20)}</div>
          <div class="tkrow">${tickruler(13, 30, Z.money, '#3a5a76', big ? 200 : 150)}<span class="slab">13 / 30 格 ≈ 41%</span></div>`)}
        <div class="mrow">${ctxRing}${mgrid}
          <span class="mt l"><b class="ml">SUBAGENT</b><b class="mv" style="color:${Z.metric}">${D.subs}</b><i class="mu">个</i>${bar(0.34, Z.metric, big ? 40 : 34, 4)}</span>
        </div>
        ${sec(Z.think, 'THINK · TAIL', '2 行 · 200 字 · 6 Hz 增量', D.think.map((t, i) => `<div class="tl${i ? ' d' : ''}">${t}</div>`).join(''))}
        ${sec(Z.task, 'TASKS', `${D.tasks.filter((x) => x[1] === 'done').length} / ${D.tasks.length} · 12 条上限`, `<div class="tgrid" style="grid-template-columns:repeat(${big ? 2 : 1},1fr)">${D.tasks.map(taskRow).join('')}</div>`)}
      </div>
    </div>`
}

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
  .desk{position:relative;overflow:hidden}
  .win{position:absolute}
  .iconWrap{position:absolute;left:calc(50% - 70px);top:35px;width:140px;height:140px}
  .hit{position:absolute;left:calc(50% - 70px);top:35px;width:140px;height:140px;border-radius:50%;outline:1px dashed rgba(168,196,220,.16)}
  .lid{position:absolute;left:0;top:0;pointer-events:none}
  /* ===== ① 底读作"深蓝"：三层渐变 + 网格 + 斜向高光 + 顶部 1px 高光（明度明显高于黑） ===== */
  .plate{position:absolute;left:0;overflow:hidden;border-radius:5px;
    background:linear-gradient(168deg,#18293f 0%,#122134 38%,#0f1c2c 66%,#0b1521 100%);
    border:1px solid #4a7fa8;
    box-shadow:0 20px 46px rgba(3,8,16,.62), inset 0 1px 0 rgba(190,220,245,.13)}
  .sheen{position:absolute;inset:0;pointer-events:none;background:linear-gradient(118deg,rgba(190,220,245,.075) 0%,rgba(190,220,245,.02) 34%,rgba(190,220,245,0) 55%)}
  .scan{position:absolute;left:0;right:0;top:38%;height:34px;pointer-events:none;
    background:linear-gradient(90deg,rgba(190,220,245,0),rgba(190,220,245,.055) 45%,rgba(190,220,245,.02) 62%,rgba(190,220,245,0))}
  .bg{position:absolute;left:0;top:0}
  .in{position:relative}
  .head{height:13px;line-height:13px}
  .kicker{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:8.5px;letter-spacing:1.5px;color:#98b0c6}
  .he{float:right;font-family:Consolas,monospace;font-size:9px;color:#98b0c6;font-variant-numeric:tabular-nums}
  .live{display:inline-block;margin-right:7px;vertical-align:1px}
  .live i{display:inline-block;width:3.4px;height:3.4px;border-radius:50%;background:#56d9c8;margin-right:2.4px;opacity:.4}
  .live i:nth-child(2){opacity:.7}.live i:nth-child(3){opacity:1}
  .sec{border-left:2px solid;padding-left:9px;margin:7px 0 0}
  .sh{height:13px;line-height:13px}
  .sl{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:1.3px}
  .sr{float:right;font-family:Consolas,monospace;font-size:8.5px;color:#92aac0}
  .t1{font-size:12.5px;color:#e8f0fa;font-weight:700}
  .tl{font-size:10px;line-height:15px;color:#dbe6f2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl.d{color:#a8bccf}
  .tstrip{height:12px;line-height:12px}
  .tstrip .sg{vertical-align:-1px}
  .slab{font-family:Consolas,monospace;font-size:8px;color:#92aac0;margin-left:8px}
  .costrow{position:relative;height:clamp(26px,8vw,40px);line-height:34px;height:34px}
  .cur{font-size:14px;vertical-align:6px;margin-right:3px}
  .cnum{font-family:Consolas,monospace;font-size:27px;font-variant-numeric:tabular-nums;letter-spacing:.4px}
  .cdelta{font-family:Consolas,monospace;font-size:9.5px;color:#ffc266;margin-left:9px}
  .sp{position:absolute;right:0;top:6px}
  .tkrow{height:12px;line-height:12px}
  .tr2{vertical-align:-2px}
  .mrow{height:52px;line-height:52px;margin-top:6px}
  .cw{display:inline-block;vertical-align:middle;margin-right:12px}
  .rg2{vertical-align:middle}
  .rgt{font-family:Consolas,monospace;font-size:9.5px;font-variant-numeric:tabular-nums}
  .cwlab{font-family:Consolas,monospace;font-size:8.5px;color:#a8c4dc;font-weight:400;line-height:12px;vertical-align:middle}
  .mgrid{display:inline-grid;vertical-align:middle;gap:2px 12px;width:auto}
  .mt{display:block;white-space:nowrap;line-height:13px}
  .mt.l{display:inline-block;vertical-align:middle;margin-left:12px}
  .ml{font-family:Consolas,monospace;font-size:8px;color:#92aac0;margin-right:4px;font-weight:400}
  .mv{font-family:Consolas,monospace;font-size:10.5px;font-variant-numeric:tabular-nums;font-weight:400}
  .mu{font-style:normal;font-family:Consolas,monospace;font-size:8px;color:#92aac0;margin-left:2px}
  .mt .br{vertical-align:-1px;margin-left:5px}
  .tgrid{display:grid;gap:0 16px}
  .tr{position:relative;height:14px;line-height:14px;font-size:9.5px;white-space:nowrap;overflow:hidden}
  .tr .br{position:absolute;right:0;top:5px}
  .ix{display:inline-block;width:19px;font-family:Consolas,monospace;font-size:8.5px;color:#92aac0}
  .mk{display:inline-block;width:14px;font-size:9px;color:#5f7893}
  .tt{color:#cdd9e6;padding-right:${0}px}
  .tr.done .tt{color:#a3b4c6}.tr.done .mk{color:#b79cff}.tr.doing .tt{color:#eef4fa}.tr.doing .mk{color:#ffc266}
  .leL{font-family:Consolas,monospace;font-size:8.5px;letter-spacing:.9px}
  .leV{font-family:Consolas,monospace;font-size:12px;font-variant-numeric:tabular-nums}
  .leU{font-size:8.5px;opacity:.75}
  .cap{padding:15px 20px 18px;background:#101823;color:#e4ecf4}
  .cap h3{margin:0 0 7px;font-size:15px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.72;color:#a9bccd}
  .cap .k{display:inline-block;width:76px;color:#92aac0}
  .cap b{color:#e4ecf4}
`
const DESK = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`,
  blue: `background:radial-gradient(120% 90% at 30% 10%,rgba(120,190,255,.30),rgba(120,190,255,0) 62%),linear-gradient(160deg,#2a5580,#1d3c5e 45%,#132a44)`,
  navy: `background:radial-gradient(120% 90% at 30% 10%,rgba(90,150,220,.18),rgba(90,150,220,0) 62%),linear-gradient(160deg,#12253c,#0d1b2b 48%,#08131f)`
}
const SIZES = [
  { id: 's360', W: 360, H: 280, WH: 465, big: false, A: 0.96, title: '放大档 · 面板 360 × 280', remark: '元素 21 · 3 列度量 · 底板 α 0.96' },
  { id: 's440', W: 440, H: 340, WH: 525, big: true, A: 0.96, title: '放大档 · 面板 440 × 340', remark: '元素 24 · 4 列度量 · 任务双列 · 底板 α 0.96' },
  /* 透明度对照：同一版 440×340，只改底板 alpha，把"通透 vs 可读"摆给用户看 */
  { id: 's440-a88', W: 440, H: 340, WH: 525, big: true, A: 0.88, title: '放大档 · 面板 440 × 340（底板 α 0.88）', remark: '元素 24 · 半透明档，能隐约透出壁纸' },
  { id: 's440-a78', W: 440, H: 340, WH: 525, big: true, A: 0.78, title: '放大档 · 面板 440 × 340（底板 α 0.78）', remark: '元素 24 · 明显通透档，小字可读性开始吃紧' }
]
for (const s of SIZES) {
  const ICX = s.W / 2
  const leads = `<svg class="lid" width="${s.W}" height="${s.WH}" viewBox="0 0 ${s.W} ${s.WH}">
      ${lead([ICX, 105], 46, s.big ? 330 : 288, 'COST', D.cur + D.cost, 'CNY', Z.money, 'r')}
      ${lead([ICX, 105], s.W - 46, s.big ? 330 : 288, 'CTX', '62', '%', Z.metric, 'l')}
    </svg>`
  for (const [dk, css] of Object.entries(DESK)) {
    fs.writeFileSync(path.join(OUT, `${s.id}-${dk}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${s.title}</title>
<style>${CSS}</style></head><body>
<div class="desk" style="width:${s.W + 120}px;height:${s.WH + 55}px;${css}">
  <div class="win" style="left:60px;top:30px;width:${s.W}px;height:${s.WH}px">
    <div class="iconWrap">${icon(s.id + dk)}</div><div class="hit"></div>${leads}${panel(s.W, s.H, s.big, s.A)}
  </div>
</div>
<div class="cap" style="width:${s.W + 120}px">
  <h3>${s.title} <span class="ref">深蓝底 · 不发光 · 五区着色</span></h3>
  <div><span class="k">尺寸</span>面板 <b>${s.W} × ${s.H}</b>　窗口 <b>${s.W} × ${s.WH}</b>（图标 140 居中，面板顶 = 175 + 10 = 185）　${s.remark}</div>
  <div><span class="k">配色 6</span>深蓝底 #18293f→#0b1521 · 冷白 #e8f0fa · 淡蓝结构线 #4a7fa8/#6fb6ff · <b style="color:#56d9c8">青=动作</b> · <b style="color:#ffc266">金=花费</b> · <b style="color:#b79cff">紫=任务</b>（中性冷灰 #9fb0c4=思考）</div>
  <div><span class="k">不发光</span>全卡 <b>0 处</b> text-shadow / 文字 drop-shadow；区分靠色相与清晰度，不靠光晕</div>
  <div><span class="k">每值配形</span>金额→火花线+30 格刻度尺 · 上下文→环形 · 任务→分段条+行内微条 · tokens→条形 · 步数/子代理→条形</div>
  <div><span class="k">桌面</span>${dk === 'dark' ? '深色壁纸' : dk === 'light' ? '浅色壁纸（仅实测）' : '蓝调壁纸（最易融合，专门测）'}</div>
</div></body></html>`)
  }
  console.log('written ' + s.id)
}
