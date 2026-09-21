#!/usr/bin/env node
/* build-progress-mocks3.mjs —— 候选补齐（后 4 套）+ **可组合**组件化 + 3 张推荐组合样图
 *  • 每套拆成命名组件：SPINE 骨架 / RUNNER 运行体 / FILL 填充表达 / DONE 完成态 / REST 静止态
 *  • 悬浮层给两种：**薄板版（默认，文字高度 α0.78）** 与 **纯 HUD 无板版（可选）**
 *  • 面板完整版 440 宽深蓝底板；左深壁纸 / 右浅壁纸并排
 * 输出：docs/progress-mocks3/{field,grid,pulse,fractal,combos}.html
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

function makeRnd (s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function parts (n, r0, r1, col, seed) {
  const rnd = makeRnd(seed), o = []
  for (let i = 0; i < n; i++) { const th = rnd() * 6.283, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd(); o.push({ x: +(100 + Math.cos(th) * r).toFixed(2), y: +(100 + Math.sin(th) * r * 0.94).toFixed(2), r: +(0.85 + z * 1.5).toFixed(2), op: +(0.26 + 0.74 * z).toFixed(3), z }) }
  o.sort((a, b) => a.z - b.z)
  return o.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${col}" opacity="${p.op}"/>`).join('')
}
const icon = (id, s = 140) => `<svg width="${s}" height="${s}" viewBox="0 0 200 200">
  <defs><radialGradient id="I${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#07121d" stop-opacity=".92"/><stop offset="78%" stop-color="#07121d" stop-opacity=".56"/><stop offset="100%" stop-color="#07121d" stop-opacity="0"/></radialGradient>
  <filter id="H${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#I${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#3f6f86" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${parts(98, 72, 92, '#56d9c8', 90210 + 777 + 87 * 131)}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#56d9c8" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="#3f6f86" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="#56d9c8" opacity=".18" filter="url(#H${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#56d9c8" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#56d9c8"/></svg>`

const C = { m: '#56d9c8', money: '#ffc266', metric: '#6fb6ff', violet: '#b79cff', dim: '#92aac0', ink: '#e8f0fa' }

/* ================== 后 4 套（非线性） ================== */
const S = {
  /* ⑤ 能量场：进度 = 场内波纹的密度与半径 */
  field: {
    name: '⑤ FIELD · 能量场',
    rel: '**图标外面那圈辉光本来就是一个"场"**（H2 的 `<circle r=44 filter=blur>` 是它的可见证据）。这里把"场"变成可数的：进度越大，从核心扩散出去的波纹越多、半径越大 —— 等于把图标那层看不见的辉光**数出来**',
    spine: '同心波环骨架（以核心为圆心的同心圆）',
    runner: '最外一道正在扩散的波（带 4px 柔光头）',
    fill: '波环密度 + 半径（进度 = 已扩散的环数 / 环半径）',
    done: '一次强外向波 → 波面收成实心环 → 转绿 → 对勾',
    rest: '最内一环 0.3Hz 极慢呼吸',
    glyph: (size, p, seed, mini) => {
      const cx = size / 2, R = size / 2 - 3, N = mini ? 3 : 5, s = []
      const lit = Math.max(1, Math.round(p * N))
      for (let i = 0; i < N; i++) {
        const rr = R * (0.28 + 0.72 * ((i + 1) / N)), on = i < lit
        s.push(`<circle cx="${cx}" cy="${cx}" r="${rr.toFixed(1)}" fill="none" stroke="${on ? C.m : C.dim}" stroke-opacity="${on ? (0.35 + 0.55 * (i / N)).toFixed(2) : 0.14}" stroke-width="${on ? (mini ? 1.3 : 1.7) : 1}" ${on && i === lit - 1 ? `stroke-width="${mini ? 2.2 : 2.8}"` : ''}/>`)
      }
      s.push(`<circle cx="${cx}" cy="${cx}" r="${(2.4 + 4 * p).toFixed(1)}" fill="${C.ink}" opacity="${(0.5 + 0.45 * p).toFixed(2)}"/>`)
      if (!mini) s.push(`<circle cx="${cx}" cy="${cx}" r="${(R * (0.28 + 0.72 * (lit / N))).toFixed(1)}" fill="none" stroke="${C.metric}" stroke-opacity=".5" stroke-width="1" stroke-dasharray="3 4"/>`)
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s.join('')}</svg>`
    }
  },
  /* ⑥ 网格电池：进度 = 非线性矩阵的格子填充 */
  grid: {
    name: '⑥ GRID · 网格电池',
    rel: '**H2 的面板本来就铺着 22px 网格**（那是它的材质纹理）。这里把纹理升级成载体：格子按**错列矩阵**填充，一格 = 一项任务 —— 离散、可数、零歧义，是"计划 4/6"最诚实的形状',
    spine: '错列矩阵骨架（4 列 × 交错行，非直线）',
    runner: '当前格的高亮游标（逐格跳）',
    fill: '格子填充（每格 = 1 项任务，错列避免"进度条"联想）',
    done: '最后一格点亮 → 整片矩阵收成一个实心六边形 → 对勾',
    rest: '当前格 0.5Hz 呼吸',
    glyph: (size, p, seed, mini) => {
      const cols = 4, rows = mini ? 3 : 5, gap = 2
      const cw = (size - gap * (cols + 1)) / cols, ch = (size - gap * (rows + 1)) / rows
      const total = cols * rows, lit = Math.round(p * total)
      let s = '', k = 0
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const off = (r % 2) ? cw / 2 : 0                    /* 错列 */
        const x = gap + c * (cw + gap) + off - (off ? gap / 2 : 0)
        const y = gap + r * (ch + gap)
        const on = k < lit, cur = k === lit
        s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, cw - (off ? gap / 2 : 0)).toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill="${on ? C.m : C.dim}" fill-opacity="${on ? 0.85 : 0.07}" stroke="${on ? C.m : C.dim}" stroke-opacity="${on ? 0.95 : 0.28}" stroke-width="1"/>`
        if (cur) s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, cw - (off ? gap / 2 : 0)).toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill="none" stroke="${C.ink}" stroke-width="1.6"/>`
        k++
      }
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}</svg>`
    }
  },
  /* ⑦ 心电波形：进度 = 波形推进长度 */
  pulse: {
    name: '⑦ PULSE · 心电波形',
    rel: '**H2 的核心本来就在"跳"**（WAITING 态用 `.glowA/.glowB` 交叉淡入做呼吸）。把那条看不见的脉搏画成波形：进度 = 波形走过的长度，完成 = 一次尖峰 —— 是图标"心跳"的字面化',
    spine: '波形骨架（往复的细线，非直线进度条）',
    runner: '波形前沿的光点',
    fill: '波形推进长度 + 已过部分的提亮',
    done: '一次高尖峰 → 峰后拉平 → 对勾',
    rest: '波形前沿 0.4Hz 极小抖动（1px）',
    glyph: (size, p, seed, mini) => {
      const w = size, h = size, mid = h / 2, n = mini ? 28 : 44
      let d = '', dOn = ''
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = t * (w - 4) + 2
        let y = mid
        if (i % 4 === 0) y = mid - h * 0.10
        if (i % 8 === 4) y = mid + h * 0.08
        if (i === Math.round(n * 0.62)) y = mid - h * 0.40       /* 一个尖峰 */
        const on = t <= p
        const cmd = (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
        d += cmd; if (on) dOn += cmd
      }
      const fx = 2 + p * (w - 4)
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <line x1="2" y1="${mid}" x2="${w - 2}" y2="${mid}" stroke="${C.dim}" stroke-opacity=".18" stroke-width="1" stroke-dasharray="2 3"/>
        <path d="${d}" fill="none" stroke="${C.dim}" stroke-opacity=".35" stroke-width="1"/>
        <path d="${dOn}" fill="none" stroke="${C.m}" stroke-width="${mini ? 1.6 : 2.2}" stroke-linejoin="round"/>
        <circle cx="${fx.toFixed(1)}" cy="${mid}" r="${mini ? 2.2 : 3}" fill="${C.ink}"/></svg>`
    }
  },
  /* ⑧ 分形递归：进度 = 层级展开深度 */
  fractal: {
    name: '⑧ FRACTAL · 分形递归',
    rel: '**H2 本身就是自相似的**：三角嵌在圆里、圆嵌在分段环里、环外面又是刻度环。这里让这个自相似再深一层：进度 = 递归展开的层级（每层 3 个子三角），完成 = 外壳闭合',
    spine: '递归三角骨架（自相似分形，非环形也非直线）',
    runner: '正在展开的那一层的外沿（描边发光头）',
    fill: '层级深度（每层 3 个三角各自点亮）',
    done: '最外层三角闭合成一个三角壳 → 对勾',
    rest: '最内层一枚 0.35Hz 呼吸点',
    glyph: (size, p, seed, mini) => {
      const cx = size / 2, R = size / 2 - 3
      function tri (x, y, r, depth, lit) {
        if (depth > 3) return ''
        const pts = [0, 120, 240].map((a) => [x + Math.cos((a - 90) * Math.PI / 180) * r, y + Math.sin((a - 90) * Math.PI / 180) * r])
        const on = depth <= lit
        let s = `<path d="M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)} L${pts[2][0].toFixed(1)} ${pts[2][1].toFixed(1)} Z" fill="${on ? C.m : 'none'}" fill-opacity="${on ? 0.07 + 0.06 * depth : 0}" stroke="${on ? (depth === lit ? C.ink : C.m) : C.dim}" stroke-opacity="${on ? 0.85 : 0.22}" stroke-width="${depth === lit ? 1.6 : 1}"/>`
        for (const pp of pts) s += tri((x + 2 * pp[0]) / 3, (y + 2 * pp[1]) / 3, r / 3, depth + 1, lit)
        return s
      }
      const lit = Math.max(0, Math.round(p * 3))
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${tri(cx, cx + 2, R * 0.92, 1, lit)}</svg>`
    }
  }
}

const CONVS = [
  { t: '主代理 · 3a91f2', p: 0.67, num: '计划 4/6', note: '' },
  { t: '子代理 · 检索参考图', p: 0.42, num: '计划 5/12', note: '▲ 计划已更新 6→11' },
  { t: '子代理 · 跑离屏回归', p: 0.28, num: '计划 3/11', note: '▲ 计划已更新 12→11' }
]
const HOV_P = 0.55

/* HUD 刻度带（用户明确喜欢真实飞机 HUD 的感觉）+ 子弹图总条 */
function hudStrip () {
  let t = ''
  for (let i = 0; i < 26; i++) t += `<i class="${i % 5 === 0 ? 'long' : ''}" style="left:${i * 6}px"></i>`
  return `<span class="ruler">${t}</span>
    <span class="bullet"><i class="bq"></i><i class="bs"></i><i class="bt"></i><b class="bl">已用 4/6 · 预算 8 · 上限 12</b></span>`
}
/* 悬浮层两种：plate = 文字高度薄板（默认 α0.78）/ hud = 纯 HUD 无板（可选） */
function hover (k, seed, mode) {
  const g = S[k].glyph(46, HOV_P, seed, true)
  return `<div class="hover ${mode === 'hud' ? 'noplate' : 'plate'}">
    <div class="hrow"><span class="g">${g}</span><span class="hcol">
      <span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k tok</span></span>
      ${hudStrip()}
      <span class="h3">主 + 2 子　子代理 2 <span class="warn">▲ 计划已更新 6→11</span></span>
    </span></div>
    <div class="hfin">完成态（同一元素换形态）：${S[k].done}</div>
  </div>`
}
function panel (k, seed) {
  const cells = CONVS.map((c, i) => `<div class="pcell">${S[k].glyph(88, c.p, seed + i * 13, false)}
      <div class="pname">${c.t}</div><div class="pnum">${c.num}</div>
      <div class="pnote">${c.note || '<span class="live">执行中</span>'}</div></div>`).join('')
  return `<div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6 · 主 + 2 子</span></div>
    <div class="prow">${cells}</div>
    <div class="pfoot">骨架 = ${S[k].spine}｜填充 = ${S[k].fill}｜主显示用数字，形状只做辅助</div></div>`
}
function side (k, dk, seed, hoverMode) {
  return `<div class="side"><div class="desk" style="${DESKS[dk]}">
    <div class="iconw">${icon(k + dk + hoverMode, 140)}</div>
    ${hover(k, seed, hoverMode)}${panel(k, seed)}
  </div></div>`
}

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,'Microsoft YaHei',sans-serif;background:#0d1117;width:1220px}
  .side{display:inline-block;vertical-align:top}
  .desk{position:relative;width:600px;height:610px;overflow:hidden}
  .iconw{position:absolute;left:230px;top:18px;width:140px;height:140px}
  .hover{position:absolute;left:165px;top:164px;width:272px;padding:5px 7px;border-radius:5px}
  /* 默认：文字高度的薄板（α0.78，与面板同材质）—— 深/浅/蓝壁纸全部达标 */
  .hover.plate{background:rgba(16,30,47,.78);border:1px solid rgba(74,127,168,.85)}
  /* 可选：纯 HUD 无板（深/蓝壁纸 11–14:1，浅色壁纸读不清——菜单里要写明这条代价） */
  .hover.noplate{background:transparent;border:0}
  .hover.noplate .st,.hover.noplate .num,.hover.noplate .h2,.hover.noplate .h3,.hover.noplate .bl,.hover.noplate .tok{
    -webkit-text-stroke:2.2px rgba(3,8,16,.92);paint-order:stroke fill;
    text-shadow:0 0 3px rgba(2,6,12,.95),0 1px 2px rgba(2,6,12,.98)}
  .hover .g{float:left;margin-right:9px}
  .hover .hcol{display:block;overflow:hidden}
  .hover .h1,.hover .h2,.hover .h3{display:block;height:14px;line-height:14px;white-space:nowrap}
  .hover .h3{height:12px;line-height:12px;font-size:9.5px}
  .st{font-size:12.5px;color:#f2f7fa;font-weight:700}
  .tok{float:right;font:400 9px/14px ui-monospace,Consolas,monospace;color:#cfe0ea}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#56d9c8;margin-right:6px;vertical-align:1px}
  .warn{color:#ffc266}
  .hover .h3{color:#bcd0dd}
  /* C-130J HUD 刻度带 */
  .ruler{position:relative;display:block;height:9px;margin:2px 0 1px;border-top:1px solid rgba(232,244,252,.85);border-bottom:1px solid rgba(232,244,252,.35)}
  .ruler i{position:absolute;top:0;width:1px;height:4px;background:rgba(232,244,252,.8)}
  .ruler i.long{height:9px}
  /* 子弹图：区间底 + 实际值 + 上限竖线 */
  .bullet{position:relative;display:block;height:12px}
  .bq{position:absolute;left:0;top:3px;width:150px;height:6px;background:rgba(232,244,252,.22);border-radius:1px}
  .bs{position:absolute;top:3px;left:0;width:96px;height:6px;background:#56d9c8;border-radius:1px}
  .bt{position:absolute;top:0;left:150px;width:1px;height:12px;background:#ffc266}
  .bl{position:absolute;right:0;top:0;font:400 8.5px/12px ui-monospace,Consolas,monospace;color:#e6eef4}
  .hfin{display:block;margin-top:3px;font-size:8.5px;line-height:11px;color:#ffc266}
  .hover svg{filter:drop-shadow(0 1px 3px rgba(2,6,12,.9))}
  .panel{position:absolute;left:70px;top:300px;width:460px;padding:11px 13px 10px;border-radius:6px;
    background:rgba(16,30,47,.88);border:1px solid #4a7fa8;box-shadow:0 18px 40px rgba(3,8,16,.5)}
  .ph{height:13px;line-height:13px}
  .kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
  .he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
  .prow{margin-top:8px;white-space:nowrap;text-align:center}
  .pcell{display:inline-block;width:33.3%;vertical-align:top}
  .pname{font-size:10px;color:#dbe6f2;margin-top:2px}
  .pnum{font:400 11px/14px ui-monospace,Consolas,monospace;color:#e8f0fa}
  .pnote{height:12px;font-size:8.5px;color:#ffc266}
  .live{color:#56d9c8}
  .pfoot{margin-top:7px;padding-top:6px;border-top:1px solid rgba(157,196,230,.16);font-size:8.5px;color:#7e94ac}
  .cap{width:1220px;padding:16px 22px 20px;background:#111823;color:#e4ecf4}
  .cap h3{margin:0 0 8px;font-size:16px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.78;color:#a9bccd}
  .cap .k{display:inline-block;width:100px;color:#7e94ac}
  .cap b{color:#e4ecf4}
  .tag{display:inline-block;border:1px solid #33506a;border-radius:3px;padding:0 5px;margin-right:5px;font-size:10px;color:#9fc0dc}
  .tag.bind{border-color:#6a4a33;color:#ffc266}
`
const DESKS = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
}
const TIERS = {
  field: ['波纹一次性扩散到位后完全静止', '最内环 0.3Hz 呼吸（只改 1 个 opacity）', '波纹持续向外扩散 + 完成时强波'],
  grid: ['格子一次点亮后完全静止', '当前格 0.5Hz 呼吸', '填充逐格行进（背景位移式）+ 完成时整片收拢'],
  pulse: ['波形一次性推进到位后静止', '波形前沿 0.4Hz 极小抖动（1px）', '波形持续推进 + 完成时高尖峰'],
  fractal: ['层级一次展开后完全静止', '最内层 0.35Hz 呼吸点', '层级逐层展开动画 + 完成时外壳闭合']
}
for (const [k, s] of Object.entries(S)) {
  fs.writeFileSync(path.join(OUT, k + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${s.name}</title>
<style>${CSS}</style></head><body>
<div style="display:block;white-space:nowrap">${side(k, 'dark', 101, 'plate')}${side(k, 'light', 202, 'plate')}</div>
<div style="display:block;white-space:nowrap">${side(k, 'dark', 303, 'hud')}${side(k, 'light', 404, 'hud')}</div>
<div class="cap">
  <h3>${s.name} <span class="ref">候选补齐 · 可组合组件化 · 只出设计稿</span></h3>
  <div><span class="k">为什么属于 H2</span>${s.rel}</div>
  <div><span class="k">组件拆解</span>
    <span class="tag">SPINE ${s.spine}</span><span class="tag">RUNNER ${s.runner}</span><span class="tag bind">FILL ${s.fill}</span><span class="tag">DONE ${s.done}</span><span class="tag">REST ${s.rest}</span></div>
  <div><span class="k">可组合性</span>RUNNER / DONE / REST 可**跨方案任意替换**；<b>FILL 与 SPINE 绑定</b>（密度只能配粒子骨架、覆盖角只能配扇区、格子只能配矩阵、波形长度只能配波形）</div>
  <div><span class="k">两种悬浮层</span>第 1 行 = <b>薄板版（默认，文字高度 α0.78）</b>；第 2 行 = <b>纯 HUD 无板版（可选）</b>——深/蓝壁纸 11–14:1 ✓，<b>浅色壁纸读不清（菜单里要写明这条代价）</b></div>
  <div><span class="k">推进时</span>${k === 'field' ? '波纹向外扩散、环数增加' : k === 'grid' ? '格子按错列顺序逐格填充' : k === 'pulse' ? '波形向前推进、已过部分提亮' : '递归层级逐层展开'}</div>
  <div><span class="k">完成时</span>${s.done}（**同一元素换形态，不叠庆祝动画**）</div>
  <div><span class="k">静止时</span>${s.rest}</div>
  <div><span class="k">三档剖面</span>省电＝${TIERS[k][0]}（**空闲完全静止，用户已拍板**）　标准＝${TIERS[k][1]}　流畅＝${TIERS[k][2]}</div>
  <div><span class="k">配色 6</span>青 #56d9c8 · 冷白 #e8f0fa · 次级 #92aac0 · 淡蓝 #6fb6ff · 紫 #b79cff · 琥珀 #ffc266（+面板深蓝底）｜**文字不发光**（无板模式用深色描边而非发光）</div>
</div></body></html>`)
  console.log('written ' + k + ' — ' + s.name)
}

/* ================== 推荐组合 3 张 ================== */
function comboGlyph (kind, size, p, seed) {
  const cx = size / 2, R = size / 2 - 3, s = []
  if (kind === 'orbit_sector') {          /* ORBITAL 环 + RADAR 扇区覆盖 */
    const c = 2 * Math.PI * R
    s.push(`<circle cx="${cx}" cy="${cx}" r="${R}" fill="none" stroke="${C.m}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})"/>`)
    const a = 360 * p, large = a > 180 ? 1 : 0, rad = (a - 90) * Math.PI / 180, r2 = R - 7
    s.push(`<path d="M${cx} ${cx} L${cx} ${cx - r2} A${r2} ${r2} 0 ${large} 1 ${(cx + Math.cos(rad) * r2).toFixed(1)} ${(cx + Math.sin(rad) * r2).toFixed(1)} Z" fill="${C.m}" fill-opacity=".22" stroke="${C.m}" stroke-opacity=".5" stroke-width="1"/>`)
    s.push(`<circle cx="${(cx + Math.cos(rad) * R).toFixed(1)}" cy="${(cx + Math.sin(rad) * R).toFixed(1)}" r="3" fill="${C.ink}"/>`)
  } else if (kind === 'grid_crystal') {   /* GRID 填充 + CRYSTAL 完成闭合 */
    const cols = 4, rows = 4, gap = 2, cw = (size - gap * (cols + 1)) / cols, ch = (size - gap * (rows + 1)) / rows
    const lit = Math.round(p * cols * rows * 2) / 2
    let k = 0
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, k++) {
      const on = k < Math.floor(lit), half = k === Math.floor(lit) && lit % 1
      const x = gap + c * (cw + gap), y = gap + r * (ch + gap)
      s.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill="${on ? C.m : C.dim}" fill-opacity="${on ? 0.85 : 0.06}" stroke="${on ? C.m : C.dim}" stroke-opacity="${on ? 0.9 : 0.25}" stroke-width="1"/>`)
      if (half) s.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cw * 0.5).toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill="${C.m}" fill-opacity=".55"/>`)
    }
    if (p > 0.9) s.push(`<path d="M${cx} ${cx - R * 0.9} L${cx + R * 0.78} ${cx + R * 0.45} L${cx - R * 0.78} ${cx + R * 0.45} Z" fill="none" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>`)  /* 完成态：闭合 */
  } else {                                /* PULSE 波形 + FIELD 完成波纹 */
    const w = size, mid = size / 2, n = 40
    let d = '', dOn = ''
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = t * (w - 4) + 2
      let y = mid + (i % 4 === 0 ? -size * 0.10 : 0) + (i % 8 === 4 ? size * 0.08 : 0)
      if (i === Math.round(n * 0.62)) y = mid - size * 0.38
      const cmd = (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
      d += cmd; if (t <= p) dOn += cmd
    }
    s.push(`<path d="${d}" fill="none" stroke="${C.dim}" stroke-opacity=".3" stroke-width="1"/>`)
    s.push(`<path d="${dOn}" fill="none" stroke="${C.m}" stroke-width="2.2" stroke-linejoin="round"/>`)
    s.push(`<circle cx="${(2 + p * (w - 4)).toFixed(1)}" cy="${mid}" r="2.6" fill="${C.ink}"/>`)
    if (p > 0.75) for (let i = 1; i <= 3; i++) s.push(`<circle cx="${(2 + p * (w - 4)).toFixed(1)}" cy="${mid}" r="${(i * size * 0.09).toFixed(1)}" fill="none" stroke="${C.money}" stroke-opacity="${(0.5 - i * 0.12).toFixed(2)}" stroke-width="1"/>`)
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s.join('')}</svg>`
}
function comboSide (kind, dk, seed, mode) {
  const g = (sz, p, sd, mini) => comboGlyph(kind, sz, p, sd)
  const cells = CONVS.map((c, i) => `<div class="pcell">${g(88, c.p, seed + i * 13, false)}
    <div class="pname">${c.t}</div><div class="pnum">${c.num}</div><div class="pnote">${c.note || '<span class="live">执行中</span>'}</div></div>`).join('')
  return `<div class="side"><div class="desk" style="${DESKS[dk]}">
    <div class="iconw">${icon(kind + dk + mode, 140)}</div>
    <div class="hover ${mode === 'hud' ? 'noplate' : 'plate'}">
      <div class="hrow"><span class="g">${g(46, HOV_P, seed, true)}</span><span class="hcol">
        <span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k tok</span></span>
        ${hudStrip()}<span class="h3">主 + 2 子　子代理 2 <span class="warn">▲ 计划已更新 6→11</span></span>
      </span></div>
    </div>
    <div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6 · 主 + 2 子</span></div>
      <div class="prow">${cells}</div></div>
  </div></div>`
}
const COMBOS = {
  c1: { n: '组合 ① ORBITAL 环 + RADAR 扇区覆盖', why: '**为什么比单用更好**：环告诉你"是哪个对话"，扇区面积告诉你"到了多少"。两条几何本来就是同心的（环在最外、扇区在内 7px），不打架；而且"面积"比"弧长"更容易在三行之间**横着比大小**——单用环时三个 60% 看起来都很像。',
    css: '' },
  c2: { n: '组合 ② GRID 填充 + CRYSTAL 完成闭合', why: '**为什么比单用更好**：矩阵是最好的"计数"形状（一格 = 一项，零歧义），但它的完成信号弱（"最后一格亮了"）；把 CRYSTAL 的**三角壳闭合**借来做完成态，等于"数得清 + 收得漂亮"。两者都是"由许多小形状组成一个大形状"，语言同源。',
    css: '' },
  c3: { n: '组合 ③ PULSE 波形 + FIELD 完成波纹', why: '**为什么比单用更好**：波形表达"节奏与活跃度"，波纹表达"这一下完成了"。波纹只在完成瞬间出现（一次性 400ms），所以两个动态元素**不同时活跃**——避免了"两个焦点抢戏"。', css: '' }
}
fs.writeFileSync(path.join(OUT, 'combos.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>推荐组合</title>
<style>${CSS}</style></head><body>
${Object.entries(COMBOS).map(([k, c]) => `<div style="display:block;white-space:nowrap">${comboSide(k === 'c1' ? 'orbit_sector' : k === 'c2' ? 'grid_crystal' : 'pulse_field', 'dark', 101, 'plate')}${comboSide(k === 'c1' ? 'orbit_sector' : k === 'c2' ? 'grid_crystal' : 'pulse_field', 'light', 202, 'plate')}</div>`).join('')}
<div class="cap">
  <h3>推荐组合 ① ② ③ <span class="ref">可组合设计</span></h3>
  ${Object.values(COMBOS).map((c) => `<div><span class="k">${c.n.split(' ')[0]}${c.n.split(' ')[1]}</span>${c.why}</div>`).join('')}
  <div><span class="k">不建议的组合</span><b>如实说</b>：① <b>NEBULA 密度填充 + GRID 矩阵</b>——两种"密度/颗粒"语言撞在一起，看起来像噪点；② <b>RADAR 扫掠 + PULSE 波形</b>——两个持续运动的焦点同时在跑，眼睛不知道看哪个；③ <b>FRACTAL 骨架 + CRYSTAL 完成</b>——都是三角递归，完成态与骨架同形，**看不出"完成了"**。</div>
  <div><span class="k">组合规则一句话</span>骨架（SPINE）与填充（FILL）必须同源；<b>运行体、完成态、静止态可以自由跨方案替换</b>。</div>
</div></body></html>`)
console.log('written combos')
