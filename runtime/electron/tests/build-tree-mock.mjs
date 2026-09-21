#!/usr/bin/env node
/* build-tree-mock.mjs —— 子代理进度「树形展开」设计稿（只出设计稿，不进生产代码）
 * 一页含：左深壁纸 / 右浅壁纸；每侧四块：① 悬浮层（薄板 HUD）② 面板·简单 ③ 面板·分列 ④ 面板·树（悬停展开态）
 * 树：缩进 + 连接线 + 展开箭头 + 每行状态图标 + 时长/工具数；**节点不给百分比条**（实测 6/6 子代理不写 todo）
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

function makeRnd (s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function parts (n, r0, r1, col, seed) {
  const rnd = makeRnd(seed), o = []
  for (let i = 0; i < n; i++) { const th = rnd() * 6.283, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd(); o.push({ x: +(100 + Math.cos(th) * r).toFixed(2), y: +(100 + Math.sin(th) * r * 0.94).toFixed(2), r: +(0.85 + z * 1.5).toFixed(2), op: +(0.26 + 0.74 * z).toFixed(3) }) }
  o.sort((a, b) => a.op - b.op)
  return o.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${col}" opacity="${p.op}"/>`).join('')
}
const icon = (id, s = 140) => `<svg width="${s}" height="${s}" viewBox="0 0 200 200">
  <defs><radialGradient id="I${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#07121d" stop-opacity=".92"/><stop offset="78%" stop-color="#07121d" stop-opacity=".56"/><stop offset="100%" stop-color="#07121d" stop-opacity="0"/></radialGradient>
  <filter id="H${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#I${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#3f6f86" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${parts(98, 72, 92, '#56d9c8', 31337)}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#56d9c8" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="44" fill="#56d9c8" opacity=".18" filter="url(#H${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#56d9c8" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#56d9c8"/></svg>`

/* ============== 悬浮层（薄板 + C-130J HUD 刻度带 + 子弹图） ============== */
let ticks = ''
for (let i = 0; i < 26; i++) ticks += `<i class="${i % 5 === 0 ? 'long' : ''}" style="left:${i * 6}px"></i>`
const hover = `<div class="hover plate">
  <div class="hrow"><span class="g"><svg width="46" height="46" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="38" fill="none" stroke="#92aac0" stroke-opacity=".22" stroke-width="2" stroke-dasharray="2 5"/>
      <circle cx="50" cy="50" r="38" fill="none" stroke="#56d9c8" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 38 * 0.55).toFixed(1)} 999" transform="rotate(-90 50 50)"/>
      <circle cx="50" cy="50" r="3.4" fill="#e8f0fa"/></svg></span>
    <span class="hcol">
      <span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k tok</span></span>
      <span class="ruler">${ticks}</span>
      <span class="bullet"><i class="bq"></i><i class="bs"></i><i class="bt"></i><b class="bl">已用 4/6 · 预算 8 · 上限 12</b></span>
      <span class="h3">主 + 2 子　子代理 <span class="warn">7/12</span></span>
    </span></div>
</div>`

/* ============== 树数据（DAG 实测形态：depth1 与 depth2 都有） ============== */
const NODES = [
  { d: 0, label: '主代理 · 3a91f2', ic: 'run', tail: '计划 4/6 · 38s' },
  { d: 1, label: 'reviewer', ic: 'run', tail: '跑着 38s · 21 工具' },
  { d: 1, label: 'tester', ic: 'done', tail: '完成 · 1m12s · 40 工具' },
  { d: 1, label: 'researcher', ic: 'run', tail: '跑着 12s · 6 工具', open: true },
  { d: 2, label: '检索参考图', ic: 'run', tail: '跑着 12s · 6 工具' },
  { d: 2, label: '跑离线回归', ic: 'wait', tail: '等待' },
  { d: 1, label: '（还有 3 个子代理）', ic: 'fold', tail: '+3' }
]
const ICON = { run: '<i class="ic run"></i>', done: '<i class="ic done">✓</i>', wait: '<i class="ic wait"></i>', fold: '<i class="ic fold">+3</i>' }
/* 缩进 + 连接线（树干用 │ ├ └，末端 └） */
const PREF = { 0: '', 1: '├ ', 2: '│  └ ', 3: '│     └ ' }
function tree (maxRows) {
  let html = '<div class="tree">'
  NODES.slice(0, maxRows).forEach((n, i) => {
    const last = i === NODES.length - 1 || (NODES[i + 1] && NODES[i + 1].d < n.d)
    const pref = n.d === 0 ? '' : (PREF[n.d] || '└ ').replace('├', last ? '└' : '├')
    html += `<div class="trow ${n.d === 0 ? 'root' : ''} ${n.open ? 'open' : ''} ${n.ic === 'fold' ? 'fold' : ''}">
      <span class="tw">${pref}</span><span class="ar">${n.d > 0 && n.ic !== 'fold' ? (n.open ? '▾' : '▸') : ''}</span>
      <span class="ln">${n.label}</span><span class="tail">${n.tail}</span>${ICON[n.ic]}</div>`
  })
  return html + '</div>'
}

const PANELS = `
<div class="pw" style="top:228px"><div class="plabel">② 面板 · 简单（现状：只给计数）</div>
  <div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6 · 主 + 2 子</span></div>
  <div class="simple"><span class="bn">子代理 <b>7/12</b></span><span class="bd">reviewer 跑着 38s · tester 完成 · 还有 3 个</span></div>
  <div class="pfoot">最省空间：一行说清"几个子代理、几个完成"</div></div></div>

<div class="pw" style="top:528px"><div class="plabel">③ 面板 · 分列（上一批的多条进度）</div>
  <div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6</span></div>
  <div class="prow">${['主代理', 'reviewer', 'tester'].map((n, i) => `<div class="pcell">
      <svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" fill="none" stroke="#92aac0" stroke-opacity=".2" stroke-width="3" stroke-dasharray="2 4"/>
      <circle cx="30" cy="30" r="24" fill="none" stroke="#56d9c8" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(150 * [0.67, 0.42, 0.28][i]).toFixed(0)} 999" transform="rotate(-90 30 30)"/></svg>
      <div class="pname">${n}</div><div class="pnum">计划 ${[4, 5, 3][i]}/${[6, 12, 11][i]}</div></div>`).join('')}</div>
  <div class="pfoot">并列比较强，但看不出父子关系</div></div></div>

<div class="pw" style="top:828px"><div class="plabel">④ 面板 · 树（新 · 悬停自动展开态）</div>
  <div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6 · 子代理 7/12</span></div>
  ${tree(7)}
  <div class="pfoot">缩进 + 连接线 = 父子深度；<b>节点不给百分比</b>（子代理不写 todo，拿不到单节点百分比）→ 只给"跑着/完成 + 时长/工具数"</div></div></div>
`

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0d1117;width:1260px}
  .side{display:inline-block;vertical-align:top}
  .desk{position:relative;width:620px;height:1080px;overflow:hidden}
  .iconw{position:absolute;left:240px;top:16px;width:140px;height:140px}
  .hover{position:absolute;left:175px;top:160px;width:272px;padding:5px 7px;border-radius:5px}
  .hover.plate{background:rgba(16,30,47,.78);border:1px solid rgba(74,127,168,.85)}
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
  .pw{position:absolute;left:80px;width:460px}
  .plabel{font:400 9px/1 ui-monospace,Consolas,monospace;color:#8fa8bd;margin:0 0 4px 2px}
  .panel{width:460px;padding:10px 13px 9px;border-radius:6px;background:rgba(16,30,47,.9);border:1px solid #4a7fa8;box-shadow:0 14px 32px rgba(3,8,16,.45)}
  .ph{height:13px;line-height:13px}
  .kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
  .he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
  .simple{height:22px;line-height:22px;font-size:11px;color:#dbe6f2;white-space:nowrap}
  .simple .bn b{color:#e8f0fa;font:400 11px/22px ui-monospace,Consolas,monospace}
  .simple .bd{float:right;font-size:9px;color:#92aac0}
  .prow{white-space:nowrap;text-align:center;margin:4px 0 2px}
  .pcell{display:inline-block;width:33.3%;vertical-align:top}
  .pname{font-size:10px;color:#dbe6f2}
  .pnum{font:400 10px/13px ui-monospace,Consolas,monospace;color:#e8f0fa}
  /* ===== 树 ===== */
  .tree{margin:6px 0 2px}
  .trow{position:relative;height:19px;line-height:19px;font-size:10.5px;color:#cfdcea;white-space:nowrap;overflow:hidden}
  .trow.root{color:#e8f0fa;font-weight:600}
  .trow.open .tw,.trow .tw{color:#4d6b86;font-family:ui-monospace,Consolas,monospace}
  .trow .ar{display:inline-block;width:10px;color:#8fa8bd;font-size:9px}
  .trow .ln{color:inherit}
  .trow .tail{float:right;font:400 8.5px/19px ui-monospace,Consolas,monospace;color:#92aac0;margin-left:8px}
  .trow .ic{display:inline-block;width:9px;height:9px;border-radius:50%;margin-left:8px;vertical-align:0}
  .ic.run{background:#56d9c8;box-shadow:0 0 0 2px rgba(86,217,200,.22)}
  .ic.done{background:none;box-shadow:none;width:11px;height:19px;border-radius:0;color:#7fe3c8;font:700 11px/19px ui-monospace,Consolas,monospace;text-align:center}
  .ic.wait{background:none;border:1.4px solid #7e94ac}
  .ic.fold{background:none;box-shadow:none;width:auto;height:19px;border-radius:0;color:#8fa8bd;font:400 8.5px/19px ui-monospace,Consolas,monospace}
  .trow.fold{height:15px;line-height:15px;color:#8fa8bd}
  .trow.fold .tail{line-height:15px}
  .trow.open{background:rgba(86,217,200,.10);border-radius:3px}
  .trow.open::before{content:'';position:absolute;left:-6px;top:2px;bottom:2px;width:2px;background:#56d9c8;border-radius:1px}
  .pfoot{margin-top:6px;padding-top:5px;border-top:1px solid rgba(157,196,230,.16);font-size:8.5px;line-height:1.5;color:#7e94ac;white-space:normal}
  .pfoot b{color:#cfdcea}
  .cap{width:1260px;padding:16px 22px 20px;background:#111823;color:#e4ecf4}
  .cap h3{margin:0 0 8px;font-size:16px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.78;color:#a9bccd}
  .cap .k{display:inline-block;width:104px;color:#7e94ac}
  .cap b{color:#e4ecf4}
`
const DESKS = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
}
const side = (dk, id) => `<div class="side"><div class="desk" style="${DESKS[dk]}">
  <div class="iconw">${icon('t' + id, 140)}</div>
  ${hover}
  ${PANELS}
</div></div>`
fs.writeFileSync(path.join(OUT, 'tree.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>子代理进度 · 树形展开</title>
<style>${CSS}</style></head><body>
<div style="display:block;white-space:nowrap">${side('dark', 'd')}${side('light', 'l')}</div>
<div class="cap">
  <h3>子代理进度「树形展开」 <span class="ref">设计稿 · 不进生产代码</span></h3>
  <div><span class="k">形态</span>缩进 + 连接线（<code>├ └ │</code>）表达父子深度；每行 = 展开箭头 + label（来自 <code>subagent/descriptor</code>）+ 状态图标 + 时长/工具数</div>
  <div><span class="k">⚠️ 硬约束</span><b>节点上不画百分比条</b>——实测 6/6 子代理不写 todo，单节点百分比拿不到。节点只给"跑着 ● / 完成 ✓ / 等待 ○ + 时长 · 工具数"</div>
  <div><span class="k">交互（实测结论）</span>悬停命中行走<b>主进程 40ms 轮询 <code>screen.getCursorScreenPoint()</code></b>（实测 14s 命中 242 个样本、7 次行变化）——<b>这就是生产代码现在判定悬浮层悬停的同一机制</b>；<b>点击照样穿透</b>（<code>setIgnoreMouseEvents(true)</code> 未被破坏）。附带发现：<code>forward:true</code> 在本机<b>并没有把 DOM mousemove 转发进渲染进程</b>（实测 0 次），所以方案不依赖它</div>
  <div><span class="k">展开策略</span>悬停某行 → 展开其子分支，移开 <b>350ms 宽限</b>后收回（避免抖动）；默认固定展开 <b>depth 0–1</b>，depth 2 靠悬停或"活跃分支优先"自动展开</div>
  <div><span class="k">行数上限</span>面板 <b>最多 8 行</b>（约 152px）；超出折成 <code>+N</code> 一行（例：<code>（还有 3 个子代理）+3</code>）。裁剪优先级：<b>跑着 &gt; 等待 &gt; 已完成</b>，同级按开始时间倒序；已完成超过 2 个即折</div>
  <div><span class="k">与思考尾串竞争</span>树最多占面板高度的 <b>45%</b>（约 152px / 340px）；思考尾串最多 <b>3 行</b>（48px）；两者都用完时<b>树先折</b>（尾串是"现在在干什么"，树的低优先级节点信息量更低）</div>
  <div><span class="k">面板详细度</span>建议配置 <code>window.panelDetail</code>：<b>simple</b>（一行计数）/ <b>columns</b>（多列图形）/ <b>tree</b>（树）——三档都成立，默认 <b>columns</b>（树信息最多但最高）</div>
</div></body></html>`)
console.log('written tree')
