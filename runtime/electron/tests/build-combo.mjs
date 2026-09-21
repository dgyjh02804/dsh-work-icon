#!/usr/bin/env node
/* build-combo.mjs —— ORBITAL + NEBULA + FRACTAL 组合：3 版分工 + 最小尺寸叠加实测条
 * 页面结构（同一页，便于一次测量）：
 *   A 段：最小尺寸叠加测试条（140px 图标尺寸 / 46px 悬浮层尺寸；每档 4 格：环/云/分形/三者叠加）
 *   B 段：版 A / 版 B / 版 C / 版 D（推荐）× 深色+浅色壁纸，每侧含 悬浮层（薄板）+ 面板 440
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

function makeRnd (s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function parts (n, r0, r1, col, seed) {
  const rnd = makeRnd(seed), o = []
  for (let i = 0; i < n; i++) { const th = rnd() * 6.283, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd(); o.push([100 + Math.cos(th) * r, 100 + Math.sin(th) * r * 0.94, 0.85 + z * 1.5, 0.26 + 0.74 * z]) }
  return o.map((p) => `<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="${p[2].toFixed(2)}" fill="${col}" opacity="${p[3].toFixed(3)}"/>`).join('')
}
const icon = (id, s = 140) => `<svg width="${s}" height="${s}" viewBox="0 0 200 200">
  <defs><radialGradient id="I${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#07121d" stop-opacity=".92"/><stop offset="78%" stop-color="#07121d" stop-opacity=".56"/><stop offset="100%" stop-color="#07121d" stop-opacity="0"/></radialGradient>
  <filter id="H${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#I${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#3f6f86" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${parts(98, 72, 92, '#56d9c8', 31337)}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#56d9c8" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="44" fill="#56d9c8" opacity=".18" filter="url(#H${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#56d9c8" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#56d9c8"/></svg>`

const C = { m: '#56d9c8', money: '#ffc266', metric: '#6fb6ff', violet: '#b79cff', dim: '#92aac0', ink: '#e8f0fa' }

/* ============ 三个元素的独立生成器（便于叠加测试与职责分配） ============ */
function elRing (size, p, mini, dim) {            /* ORBITAL 元素：弧长 + 运行体 */
  const cx = size / 2, R = size / 2 - size * 0.03, c = 2 * Math.PI * R, a = -90 + 360 * p
  const o = dim ? 0.34 : 1
  return `<circle cx="${cx}" cy="${cx}" r="${R.toFixed(1)}" fill="none" stroke="${C.dim}" stroke-opacity="${0.22 * o}" stroke-width="${mini ? 1 : 1.4}" stroke-dasharray="1.5 ${mini ? 4 : 5}"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${R.toFixed(1)}" fill="none" stroke="${dim ? C.dim : C.m}" stroke-width="${mini ? 2.6 : 3.4}" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})" opacity="${o}"/>` +
    `<circle cx="${(cx + Math.cos(a * Math.PI / 180) * R).toFixed(1)}" cy="${(cx + Math.sin(a * Math.PI / 180) * R).toFixed(1)}" r="${mini ? 2.2 : 3}" fill="${C.ink}" opacity="${o}"/>`
}
function elNebula (size, p, mini, dim) {          /* NEBULA 元素：密度 + 半径（越紧=进度越大） */
  const rnd = makeRnd(4242), n = mini ? 26 : 88, cx = size / 2
  const R = size / 2 - size * 0.06
  const rOuter = R * (0.98 - 0.34 * p), rInner = R * (0.52 - 0.30 * p)
  let s = ''
  for (let i = 0; i < n; i++) {
    const th = rnd() * 6.283, rr = rInner + (rOuter - rInner) * Math.sqrt(rnd()), z = rnd()
    s += `<circle cx="${(cx + Math.cos(th) * rr).toFixed(1)}" cy="${(cx + Math.sin(th) * rr * 0.96).toFixed(1)}" r="${(0.55 + z * (mini ? 0.8 : 1.1)).toFixed(2)}" fill="${z > 0.5 ? (dim ? C.dim : C.m) : C.dim}" opacity="${((0.18 + 0.6 * z) * (dim ? 0.5 : 1)).toFixed(2)}"/>`
  }
  return s + `<circle cx="${cx}" cy="${cx}" r="${(1.6 + 3.4 * p).toFixed(1)}" fill="${C.ink}" opacity="${dim ? 0.4 : 0.85}"/>`
}
function elFractal (size, p, mini, dim) {         /* FRACTAL 元素：递归层级 */
  const cx = size / 2, R = size / 2 - size * 0.04, lit = Math.max(0, Math.round(p * 3))
  function tri (x, y, r, depth) {
    if (depth > 3) return ''
    const pts = [0, 120, 240].map((a) => [x + Math.cos((a - 90) * Math.PI / 180) * r, y + Math.sin((a - 90) * Math.PI / 180) * r])
    const on = depth <= lit
    let s = `<path d="M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)} L${pts[2][0].toFixed(1)} ${pts[2][1].toFixed(1)} Z" fill="${on ? C.m : 'none'}" fill-opacity="${on ? 0.05 + 0.05 * depth : 0}" stroke="${dim ? C.dim : (on ? (depth === lit ? C.metric : C.m) : C.dim)}" stroke-opacity="${on ? (dim ? 0.4 : 0.8) : 0.16}" stroke-width="${mini ? 0.9 : 1.2}"/>`
    for (const q of pts) s += tri((x + 2 * q[0]) / 3, (y + 2 * q[1]) / 3, r / 3, depth + 1)
    return s
  }
  return tri(cx, cx + size * 0.02, R * 0.9, 1)
}
/* 组合渲染：variant 决定三个元素的职责与主次（尺寸/亮度/线宽/动效） */
const VARIANTS = {
  A: { ring: 'main', neb: 'state', fra: 'done' },
  B: { ring: 'frame', neb: 'main', fra: 'depth' },
  C: { ring: 'readout', neb: 'bg', fra: 'main' },
  D: { ring: 'main', neb: 'state', fra: 'struct' }     /* 我的推荐 */
}
function combo (size, p, mini, v) {
  const cfg = VARIANTS[v]
  const sc = mini ? 0.52 : 1     /* 悬浮层里次要元素缩小 */
  let s = ''
  /* 分形：depth/struct/done/main/bg */
  if (cfg.fra === 'bg') s += `<g opacity=".5">${elFractal(size * 0.86, p, mini, true)}</g>`
  else if (cfg.fra === 'done') s += `<g opacity="${p >= 0.999 ? 1 : 0.5}">${elFractal(size * 0.74, p >= 0.999 ? 1 : 0.34, mini, p < 0.999)}</g>`
  else s += `<g opacity="${cfg.fra === 'main' ? 1 : 0.7}">${elFractal(size * (cfg.fra === 'main' ? 1 : 0.8), p, mini, cfg.fra !== 'main')}</g>`
  /* 星云：main/state/bg */
  if (cfg.neb === 'bg') s += `<g opacity=".55">${elNebula(size * 0.9, p, mini, true)}</g>`
  else s += `<g opacity="${cfg.neb === 'main' ? 1 : 0.8}">${elNebula(size * (cfg.neb === 'state' ? 0.66 : 0.94), cfg.neb === 'state' ? 0.75 : p, mini, cfg.neb === 'state')}</g>`
  /* 环：main/frame/readout */
  if (cfg.ring === 'frame') s += `<g opacity=".55">${elRing(size, 1, mini, true)}</g>`
  else s += `<g opacity="${cfg.ring === 'main' ? 1 : 0.85}">${elRing(size, p, mini, false)}</g>`
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}</svg>`
}

/* ================= 叠加测试条（可量化：4 格 × 2 档尺寸） ================= */
function sizeTest () {
  /* 绝对定位，坐标固定 → 便于像素实测（每格 160 宽；140px 行在左、46px 行在右） */
  const R1X = [10, 170, 330, 490], R2X = [650, 720, 790, 860]
  let cells = ''
  const whichs = ['ring', 'neb', 'fra', 'all']
  whichs.forEach((which, i) => {
    let inner = ''
    if (which === 'ring' || which === 'all') inner += elRing(140, 0.6, false, which !== 'all')
    if (which === 'neb' || which === 'all') inner += elNebula(140, 0.6, false, which !== 'all')
    if (which === 'fra' || which === 'all') inner += elFractal(140, 0.6, false, which !== 'all')
    cells += `<div class="sl" style="left:${R1X[i]}px;top:8px;width:140px">${which === 'all' ? '三者叠加' : which} · 140px</div>
      <svg style="position:absolute;left:${R1X[i]}px;top:24px" width="140" height="140" viewBox="0 0 140 140">${inner}</svg>`
    let inner2 = ''
    if (which === 'ring' || which === 'all') inner2 += elRing(46, 0.6, true, which !== 'all')
    if (which === 'neb' || which === 'all') inner2 += elNebula(46, 0.6, true, which !== 'all')
    if (which === 'fra' || which === 'all') inner2 += elFractal(46, 0.6, true, which !== 'all')
    cells += `<div class="sl" style="left:${R2X[i]}px;top:8px;width:46px">${which === 'all' ? '三者' : which} · 46px</div>
      <svg style="position:absolute;left:${R2X[i]}px;top:24px" width="46" height="46" viewBox="0 0 46 46">${inner2}</svg>`
  })
  return `<div class="testwrap">${cells}</div>`
}const SIZETEST = sizeTest()

const DESKS = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
}
let ticks = ''
for (let i = 0; i < 26; i++) ticks += `<i class="${i % 5 === 0 ? 'long' : ''}" style="left:${i * 6}px"></i>`

function side (v, dk, mode) {
  const g = combo(46, 0.55, true, v), gp = combo(88, 0.62, false, v)
  return `<div class="side"><div class="desk" style="${DESKS[dk]}">
    <div class="iconw">${icon(v + dk + mode, 140)}</div>
    <div class="hover ${mode === 'hud' ? 'noplate' : 'plate'}">
      <div class="hrow"><span class="g">${g}</span><span class="hcol">
        <span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k</span></span>
        <span class="ruler">${ticks}</span>
        <span class="bullet"><i class="bq"></i><i class="bs"></i><i class="bt"></i><b class="bl">已用 4/6 · 预算 8 · 上限 12</b></span>
        <span class="h3">主 + 2 子　子代理 <span class="warn">7/12</span></span>
      </span></div>
    </div>
    <div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6</span></div>
      <div class="prow">${[[0.75, '主代理 4/6'], [0.5, 'reviewer 5/12'], [0.3, 'tester 3/11']].map(([p, n]) =>
        `<div class="pcell">${combo(78, p, false, v)}<div class="pname">${n.split(' ')[0]}</div><div class="pnum">${n.split(' ')[1]}</div></div>`).join('')}</div>
    </div></div></div>`
}

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0d1117;width:1260px}
  .testwrap{position:relative;width:1260px;height:176px;background:#22262b}
  .sl{position:absolute;text-align:left}
  .sl{font:400 8px/12px ui-monospace,Consolas,monospace;color:#8fa8bd}
  .side{display:inline-block;vertical-align:top}
  .desk{position:relative;width:620px;height:520px;overflow:hidden}
  .iconw{position:absolute;left:240px;top:14px;width:140px;height:140px}
  .hover{position:absolute;left:175px;top:156px;width:272px;padding:5px 7px;border-radius:5px}
  .hover.plate{background:rgba(16,30,47,.78);border:1px solid rgba(74,127,168,.85)}
  .hover.noplate{background:transparent;border:0}
  .hover.noplate .st,.hover.noplate .h3,.hover.noplate .bl,.hover.noplate .tok{-webkit-text-stroke:2.2px rgba(3,8,16,.92);paint-order:stroke fill}
  .hover .g{float:left;margin-right:9px}
  .hover .hcol{display:block;overflow:hidden}
  .hover .h1,.hover .h3{display:block;height:14px;line-height:14px;white-space:nowrap}
  .hover .h3{height:12px;line-height:12px;font-size:9.5px;color:#bcd0dd}
  .st{font-size:12.5px;color:#f2f7fa;font-weight:700}
  .tok{float:right;font:400 9px/14px ui-monospace,Consolas,monospace;color:#cfe0ea}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#56d9c8;margin-right:6px;vertical-align:1px}
  .warn{color:#ffc266}
  .ruler{position:relative;display:block;height:9px;margin:2px 0 1px;border-top:1px solid rgba(232,244,252,.85);border-bottom:1px solid rgba(232,244,252,.35)}
  .ruler i{position:absolute;top:0;width:1px;height:4px;background:rgba(232,244,252,.8)}
  .ruler i.long{height:9px}
  .bullet{position:relative;display:block;height:12px}
  .bq{position:absolute;left:0;top:3px;width:150px;height:6px;background:rgba(232,244,252,.22);border-radius:1px}
  .bs{position:absolute;top:3px;left:0;width:96px;height:6px;background:#56d9c8;border-radius:1px}
  .bt{position:absolute;top:0;left:150px;width:1px;height:12px;background:#ffc266}
  .bl{position:absolute;right:0;top:0;font:400 8.5px/12px ui-monospace,Consolas,monospace;color:#e6eef4}
  .panel{position:absolute;left:70px;top:250px;width:460px;padding:10px 13px 9px;border-radius:6px;
    background:rgba(16,30,47,.9);border:1px solid #4a7fa8;box-shadow:0 14px 32px rgba(3,8,16,.45)}
  .ph{height:13px;line-height:13px}
  .kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
  .he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
  .prow{white-space:nowrap;text-align:center;margin-top:6px}
  .pcell{display:inline-block;width:33.3%;vertical-align:top}
  .pname{font-size:10px;color:#dbe6f2}
  .pnum{font:400 10px/13px ui-monospace,Consolas,monospace;color:#e8f0fa}
  .cap{width:1260px;padding:16px 22px 20px;background:#111823;color:#e4ecf4}
  .cap h3{margin:0 0 10px;font-size:16px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
  .cap .vd{margin:0 0 12px;padding:9px 12px;background:#161f2b;border-left:3px solid #4a7fa8;border-radius:0 4px 4px 0}
  .cap .vd h4{margin:0 0 5px;font-size:13px;color:#e4ecf4}
  .cap .vd div{font-size:11.5px;line-height:1.75;color:#a9bccd}
  .cap .k{display:inline-block;width:96px;color:#7e94ac}
  .cap b{color:#e4ecf4}
  .cap .warn2{color:#ffc266}
`
const VD = {
  A: { t: '版 A · 环主进度（弧长给准数）', role: ['<b>主进度</b>：弧长 + 运行体（唯一进度表达，最精确、最好横比）', '状态：正在干活才聚拢发亮，等待时散开暗淡（<b>不表达进度</b>）', '完成态：完成瞬间外壳闭合，之后常驻"已闭合"形态'], risk: '崩点：环与分形都是"闭合轮廓"，完成瞬间两个闭合动作会互相抢。' },
  B: { t: '版 B · 云主进度（密度/半径）', role: ['外壳与刻度：满圈刻度表达"上限/预算"，<b>永不表达进度</b>', '<b>主进度</b>：云的紧凑度与核心亮度随进度增长', '层级/深度：递归层数暗示子任务展开深度'], risk: '崩点：**密度的可辨性最差**——46px 下"紧"与"松"只差几像素，一眼读不出数值。' },
  C: { t: '版 C · 分形主进度（层级深度）', role: ['精确读数：弧长给准数（把"多少"交给环）', '背景常驻场：纯氛围，不承载任何数值', '<b>主进度</b>：递归层级展开深度'], risk: '崩点：分形只有 3~4 档，**精度低**；必须靠环补数，于是"主进度"实际是两件东西。' },
  D: { t: '版 D · 推荐：三者职责正交（无冲突）', role: ['<b>主进度</b>：弧长（唯一进度表达）', '活跃度/状态：跑着=聚拢发亮，等待=散开（唯一状态表达）', '**结构骨架**：递归层级 = **子代理层级**（与你要的树同构，<b>不表达进度</b>）'], risk: '唯一代价：分形退到"结构"后，视觉上更安静——但它换来了"三个元素互不争抢"。' }
}
let capHtml = ''
for (const [v, d] of Object.entries(VD)) {
  capHtml += `<div class="vd"><h4>${d.t}</h4>
    <div><span class="k">唯一职责</span>环＝${d.role[0]}</div>
    <div><span class="k"> </span>云＝${d.role[1]}</div>
    <div><span class="k"> </span>分形＝${d.role[2]}</div>
    <div><span class="k">进度看哪里</span>${v === 'A' ? '<b>最外圈那道弧的缺口位置</b>——缺口越小进度越大，一眼可辨' : v === 'B' ? '<b>中间那团云的松紧</b>（但 46px 下最难辨，见实测）' : v === 'C' ? '<b>递归三角展开了几层</b>（离散 3~4 档）+ 环给准数' : '<b>最外圈弧长</b>（唯一进度），另两个分别读"是否在干活"与"层级结构"'}</div>
    <div><span class="k">风险/崩点</span><span class="warn2">${d.risk}</span></div>
    <div><span class="k">三档剖面</span>省电＝数值变化才动、随后<b>完全静止</b>（云不漂、环不动、分形不转）｜标准＝云 0.2Hz 慢漂 + 当前层呼吸｜流畅＝环运行体绕行 + 云流动 + 层级展开动画（完成时换形态）</div></div>`
}
fs.writeFileSync(path.join(OUT, 'combo.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>组合 ORBITAL+NEBULA+FRACTAL</title>
<style>${CSS}</style></head><body>
${SIZETEST}
${['A', 'B', 'C', 'D'].map((v) => `<div style="display:block;white-space:nowrap">${side(v, 'dark', 'plate')}${side(v, 'light', 'plate')}</div>`).join('')}
${['A', 'D'].map((v) => `<div style="display:block;white-space:nowrap">${side(v, 'dark', 'hud')}${side(v, 'light', 'hud')}</div>`).join('')}
<div class="cap">
  <h3>组合：ORBITAL + NEBULA + FRACTAL —— 4 版职责分工 <span class="ref">设计稿 · 附最小尺寸叠加实测</span></h3>
  ${capHtml}
</div></body></html>`)
console.log('written combo')
