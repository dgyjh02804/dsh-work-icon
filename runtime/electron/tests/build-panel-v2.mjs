#!/usr/bin/env node
/* build-panel-v2.mjs —— 第二批「与 H2 同构」的信息面板四套方向（设计探索，不入生产代码）
 *
 * 设计纲领（针对用户否掉第一批的根因）：
 *   · 面板不是卡片，而是 H2 装置本身的**展开**：环 / 弧 / 分段 / 刻度 / 粒子 / 中轴全部沿用
 *   · 信息编码进图形：任务→分段弧长、花费→刻度环、动作→状态弧带、思考→沿弧流动的文本
 *   · 一律**预生成静态 SVG**（不依赖运行时 JS），保证截图确定性与真实渲染一致
 * 输出：docs/panel-mocks-v2/{orbit,schematic,holo,plasma}.html
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ============================ 数据（真实形态） ============================ */
const D = {
  action: 'Bash · node tests/run-all.mjs --with-shown',
  actionShort: 'BASH',
  think: '正在确认 config 分支的字段顺序，宿主回发的 window.fps 有没有被 cleanWindow 收下，再核对面板高度上限与截断规则',
  cost: '¥0.428',
  costUnit: 'CNY',
  costFrac: 41,            /* 刻度环点亮比例（/60） */
  tokens: '128.4k',
  tasks: [                 /* ≤12 条 → 分段弧一段一条 */
    { t: '只读取证：WindowFromPoint 命中测试', k: 'done' },
    { t: '旋转缺陷：核心静止 + 轴心归位', k: 'done' },
    { t: '面板几何与穿透划分', k: 'done' },
    { t: '信息面板第二批视觉', k: 'doing' },
    { t: '交给用户挑方向', k: 'todo' },
    { t: '并入生产 runtime', k: 'todo' }
  ]
}

/* ============================ H2 图标（与生产同几何） ============================ */
function makeRnd (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function particles (count, r0, r1, color) {
  const rnd = makeRnd(90210 + 777 + 87 * 131)
  const out = []
  for (let i = 0; i < count; i++) {
    const th = rnd() * Math.PI * 2, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd()
    out.push({ x: (100 + Math.cos(th) * r).toFixed(2), y: (100 + Math.sin(th) * r * 0.94).toFixed(2), r: (0.85 + z * 1.5).toFixed(2), o: (0.26 + 0.74 * z).toFixed(3), z })
  }
  out.sort((a, b) => a.z - b.z)
  return out.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${color}" opacity="${p.o}"/>`).join('')
}
/* 图标：140px，viewBox 200×200（与 runtime 完全一致） */
function icon (size, pal, id) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="pl${id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${pal.plate0}" stop-opacity="0.88"/>
      <stop offset="78%" stop-color="${pal.plate0}" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="${pal.plate0}" stop-opacity="0"/>
    </radialGradient>
    <filter id="sf${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <circle cx="100" cy="100" r="97" fill="url(#pl${id})"/>
  <circle cx="100" cy="100" r="94" fill="none" stroke="${pal.dim}" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${particles(98, 72, 92, pal.key)}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="${pal.key}" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="${pal.dim}" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="${pal.key}" opacity="0.2" filter="url(#sf${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="${pal.key}" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="100" cy="100" r="12" fill="${pal.key}"/>
</svg>`
}

/* ============================ 弧 / 刻度工具 ============================ */
const P = (cx, cy, r, deg) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] }
function arc (cx, cy, r, a0, a1, { stroke, w = 2, dash = null, cap = 'round', opacity = 1 }) {
  const [x0, y0] = P(cx, cy, r, a0), [x1, y1] = P(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  const d = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="${cap}"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${opacity}"/>`
}
function ticks (cx, cy, r, n, a0, a1, lit, color, dim, len = 7) {
  let s = ''
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1)
    const [x0, y0] = P(cx, cy, r - len / 2, a), [x1, y1] = P(cx, cy, r + len / 2, a)
    const on = i < lit
    s += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="${on ? color : dim}" stroke-width="${on ? 1.7 : 1}" stroke-linecap="round" opacity="${on ? 1 : 0.55}"/>`
  }
  return s
}

/* ============================ 各方向 ============================ */
const DIRS = {}

/* ---- 1 ORBIT：面板 = 图标环系的向外延伸（弧心与图标同心） ----
   窗口 320×300；图标中心 (160,105)；弧层 r = 110（状态带）/132（思考流）/156（花费刻度）/178（任务分段）
   所有弧只扫下扇区 34°–146°，横向占用 = 178·cos34° = 147.6 → x∈[12,308] ✓、最低点 y=105+178=283<300 ✓ */
DIRS.orbit = (pal) => {
  const cx = 160, cy = 105, OX = 100  /* 窗口内坐标：图标中心 x=160（窗口 320 宽，居中） */
  const A0 = 34, A1 = 146
  const segN = 12, segLit = 7   /* 12 段代表 ≤12 条任务；点亮 = 已完成+进行中 */
  let seg = ''
  for (let i = 0; i < segN; i++) {
    const a = A0 + ((A1 - A0) * i) / segN, b = A0 + ((A1 - A0) * (i + 0.62)) / segN
    const on = i < segLit
    seg += arc(cx, cy, 178, a, b, { stroke: on ? pal.warm : pal.dim, w: on ? 4 : 2.4, opacity: on ? 1 : 0.45 })
  }
  const thinkArc = `M${P(cx, cy, 132, A0 + 4).map((v) => v.toFixed(1)).join(' ')} A132 132 0 0 1 ${P(cx, cy, 132, A1 - 4).map((v) => v.toFixed(1)).join(' ')}`
  return `
  <div class="win" style="width:320px;height:300px;left:${OX}px;top:40px">
    <svg class="layer" width="320" height="300" viewBox="0 0 320 300">
      <defs>
        <path id="tp" d="${thinkArc}"/>
        <linearGradient id="orbitFade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${pal.text}" stop-opacity="0.05"/>
          <stop offset="26%" stop-color="${pal.text}" stop-opacity="0.92"/>
          <stop offset="100%" stop-color="${pal.text}" stop-opacity="1"/>
        </linearGradient>
        <radialGradient id="orbitGlow" cx="50%" cy="35%" r="62%">
          <stop offset="0%" stop-color="${pal.key}" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="${pal.key}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="170" fill="url(#orbitGlow)"/>
      ${arc(cx, cy, 196, A0 - 6, A1 + 6, { stroke: pal.dim, w: 1, opacity: 0.35 })}
      ${arc(cx, cy, 178, A0, A1, { stroke: pal.dim, w: 1, opacity: 0.5 })}
      ${seg}
      ${ticks(cx, cy, 156, 60, A0 + 3, A1 - 3, D.costFrac, pal.warm, pal.dim, 8)}
      ${arc(cx, cy, 132, A0 + 2, A1 - 2, { stroke: pal.dim, w: 1, opacity: 0.5 })}
      <text class="thinkflow" fill="url(#orbitFade)"><textPath href="#tp" startOffset="0">${D.think}</textPath></text>
      ${arc(cx, cy, 110, A0 + 6, A1 - 6, { stroke: pal.key, w: 5, opacity: 0.30 })}
      ${arc(cx, cy, 110, 88, 92, { stroke: pal.key, w: 5, opacity: 1 })}
      <text x="${cx}" y="${cy + 148}" text-anchor="middle" class="costNum" fill="${pal.warm}">${D.cost}</text>
      <text x="${cx - 34}" y="${cy + 148}" text-anchor="middle" class="unit" fill="${pal.dim}">${D.costUnit}</text>
      <text x="${cx + 40}" y="${cy + 148}" text-anchor="middle" class="unit" fill="${pal.dim}">${D.tokens}</text>
      <text x="${cx}" y="${cy + 165}" text-anchor="middle" class="cap2" fill="${pal.dim}">TASKS ${segLit}/${segN} · 12 段 = 12 条上限</text>
    </svg>
    <div class="iconWrap" style="left:90px;top:35px">${icon(140, pal, 'o')}</div>
    <div class="hit" style="left:90px;top:35px"></div>
    <div class="actionTag" style="left:90px;top:152px;width:140px;text-align:center">${D.actionShort} · ${D.action}</div>
  </div>`
}

/* ---- 2 SCHEMATIC：工程图线框 + 引线标注（最专业） ----
   窗口 300×300；图标中心 (150,88)；引线从图标外环 r=97 拉出指向各数据锚点；中心虚线轴贯穿 */
DIRS.schematic = (pal) => {
  const cx = 150, cy = 78, OX = 110
  const lead = (ax, ay, label, value, side) => {
    /* 引线：从图标外环边缘一点斜拉到锚点，再拐出一小段水平尾巴 */
    const dx = ax - cx, dy = ay - cy, L = Math.hypot(dx, dy)
    const sx = cx + (dx / L) * 100, sy = cy + (dy / L) * 100
    const ex = ax + (side === 'r' ? 16 : -16)
    return `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} L${ax} ${ay} L${ex} ${ay}" fill="none" stroke="${pal.line}" stroke-width="1"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2" fill="${pal.line}"/>
      <circle cx="${ax}" cy="${ay}" r="2.4" fill="none" stroke="${pal.warm}" stroke-width="1.4"/>
      <text x="${side === 'r' ? ex + 5 : ex - 5}" y="${ay - 4}" text-anchor="${side === 'r' ? 'start' : 'end'}" class="lab" fill="${pal.text}">${label}</text>
      <text x="${side === 'r' ? ex + 5 : ex - 5}" y="${ay + 8}" text-anchor="${side === 'r' ? 'start' : 'end'}" class="val" fill="${pal.warm}">${value}</text>`
  }
  const ruler = () => {
    let s = ''
    for (let i = 0; i <= 24; i++) {
      const x = 30 + i * 10, big = i % 5 === 0
      s += `<line x1="${x}" y1="${288 - (big ? 8 : 4)}" x2="${x}" y2="288" stroke="${pal.line}" stroke-width="1" opacity="${big ? 0.9 : 0.5}"/>`
    }
    return s
  }
  return `
  <div class="win" style="width:300px;height:300px;left:${OX}px;top:40px">
    <svg class="layer" width="300" height="300" viewBox="0 0 300 300">
      <defs>
        <linearGradient id="scAxis" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${pal.line}" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="${pal.line}" stop-opacity="0.05"/>
        </linearGradient>
      </defs>
      <!-- 中轴（贯穿整窗，图标压在轴上，形成"同一个装置"） -->
      <line x1="${cx}" y1="6" x2="${cx}" y2="294" stroke="url(#scAxis)" stroke-width="1" stroke-dasharray="4 5"/>
      <!-- 四角括号 -->
      <path d="M8 20 L8 4 L24 4" fill="none" stroke="${pal.line}" stroke-width="1.2"/>
      <path d="M292 20 L292 4 L276 4" fill="none" stroke="${pal.line}" stroke-width="1.2"/>
      <path d="M8 280 L8 296 L24 296" fill="none" stroke="${pal.line}" stroke-width="1.2"/>
      <path d="M292 280 L292 296 L276 296" fill="none" stroke="${pal.line}" stroke-width="1.2"/>
      <!-- 任务：12 格方块槽位 -->
      ${Array.from({ length: 12 }, (_, i) => {
        const x = 30 + i * 21
        const k = i < 3 ? 'done' : i === 3 ? 'doing' : 'todo'
        return `<rect x="${x}" y="252" width="13" height="13" fill="${k === 'todo' ? 'none' : k === 'doing' ? pal.warm : pal.key}" fill-opacity="${k === 'doing' ? 0.35 : k === 'done' ? 0.75 : 0}" stroke="${k === 'todo' ? pal.line : k === 'doing' ? pal.warm : pal.key}" stroke-width="1.2"/>`
      }).join('')}
      ${ruler()}
      <text x="30" y="247" class="lab" fill="${pal.dim}">TASK BUS · 6/12 SLOTS</text>
      ${lead(46, 198, 'COST·SESSION', `${D.cost} ${D.costUnit}`, 'r')}
      ${lead(242, 224, 'TOKENS·IN/OUT', D.tokens, 'l')}
      <text x="${cx}" y="172" text-anchor="middle" class="act" fill="${pal.text}">${D.actionShort}</text>
      <text x="${cx}" y="186" text-anchor="middle" class="act2" fill="${pal.dim}">run-all --with-shown</text>
      <text x="30" y="208" class="lab" fill="${pal.dim}">THINK·TAIL · 2 LINE CLAMP</text>
      <text x="30" y="222" class="thinkline" fill="${pal.text}">${D.think.slice(0, 30)}…</text>
      <text x="30" y="236" class="thinkline" fill="${pal.text}" opacity="0.72">${D.think.slice(30, 60)}…</text>
    </svg>
    <div class="iconWrap" style="left:80px;top:8px">${icon(140, pal, 's')}</div>
    <div class="hit" style="left:80px;top:8px"></div>
  </div>`
}

/* ---- 3 HOLO-STACK：三层玻璃片悬浮错位 + 轻透视（最"高级好看"） ----
   窗口 320×340；片 1 状态（近）/ 片 2 思考（中）/ 片 3 花费+任务（远） */
DIRS.holo = (pal) => {
  const OX = 70
  const plate = (i, extra) => `<div class="plate p${i}">${extra}</div>`
  return `
  <div class="win" style="width:320px;height:340px;left:${OX}px;top:26px">
    <div class="stack">
      <div class="iconWrap" style="left:90px;top:0">${icon(140, pal, 'h')}</div>
      <div class="hit" style="left:90px;top:0"></div>
      <div class="beam"></div>
      ${plate(3, `
        <div class="ph"><span class="dot"></span><span class="act">${D.actionShort}</span><span class="el">00:42</span></div>
        <div class="pv">${D.action}</div>`)}
      ${plate(2, `
        <div class="ph2">THINK·TAIL<span class="el2">2 行 · 尾部</span></div>
        <div class="pt">${D.think.slice(0, 34)}</div>
        <div class="pt dim">${D.think.slice(34, 68)}</div>`)}
      ${plate(1, `
        <div class="grid">
          <div class="cell"><div class="k">COST·SESSION</div><div class="v">${D.cost}</div><div class="u">${D.costUnit} · ${D.tokens} tok</div></div>
          <div class="cell r"><div class="k">TASKS</div><div class="v">3<span class="slash">/</span>6</div>
            <div class="bars">${[1, 1, 1, 0.5, 0, 0].map((f) => `<i style="opacity:${f === 0 ? 0.22 : f === 0.5 ? 0.55 : 1}"></i>`).join('')}</div>
          </div>
        </div>`)}
    </div>
  </div>`
}

/* ---- 4 PLASMA-TEXT：粒子聚合出的文本流（最花哨）+ 退化方案说明 ----
   窗口 300×320；文本从右侧粒子云中"凝聚"出来，左侧尾迹渐隐；粒子沿弧流动 */
DIRS.plasma = (pal) => {
  const OX = 80
  const rnd = makeRnd(4242)
  let motes = ''
  for (let i = 0; i < 150; i++) {
    const t = rnd()
    const x = 26 + t * 250 + (rnd() - 0.5) * 46
    const y = 196 + Math.sin(t * 5.4) * 16 + (rnd() - 0.5) * 30
    const r = (0.6 + rnd() * 1.5).toFixed(2)
    const o = (0.10 + rnd() * 0.55 * (0.35 + t)).toFixed(2)
    motes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${t > 0.72 ? pal.key : pal.mote}" opacity="${o}"/>`
  }
  return `
  <div class="win" style="width:300px;height:320px;left:${OX}px;top:30px">
    <svg class="layer" width="300" height="320" viewBox="0 0 300 320">
      <defs>
        <linearGradient id="pfTail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${pal.text}" stop-opacity="0.02"/>
          <stop offset="18%" stop-color="${pal.text}" stop-opacity="0.42"/>
          <stop offset="58%" stop-color="${pal.text}" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="${pal.text}" stop-opacity="1"/>
        </linearGradient>
        <linearGradient id="pfLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${pal.key}" stop-opacity="0"/>
          <stop offset="40%" stop-color="${pal.key}" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="${pal.key}" stop-opacity="0.95"/>
        </linearGradient>
        <filter id="pfGlow" x="-40%" y="-140%" width="180%" height="380%"><feGaussianBlur stdDeviation="5"/></filter>
      </defs>
      ${motes}
      <path d="M20 196 C90 178 150 214 232 190" fill="none" stroke="url(#pfLine)" stroke-width="1" opacity="0.75"/>
      <path d="M20 196 C90 178 150 214 232 190" fill="none" stroke="${pal.key}" stroke-width="4" opacity="0.10" filter="url(#pfGlow)"/>
      <path d="M20 236 C96 220 168 252 240 228" fill="none" stroke="${pal.key}" stroke-width="1" opacity="0.28"/>
      <text x="20" y="196" class="flowline" fill="url(#pfTail)">${D.think.slice(0, 30)}</text>
      <text x="20" y="236" class="flowline" fill="url(#pfTail)" opacity="0.72">${D.think.slice(30, 60)}</text>
      <text x="20" y="286" class="flowline" fill="url(#pfTail)" opacity="0.42">${D.think.slice(60, 90)}</text>
      <line x1="20" y1="268" x2="280" y2="268" stroke="${pal.dim}" stroke-width="1" opacity="0.35"/>
      <text x="20" y="284" class="cap2" fill="${pal.dim}">TAIL BUFFER · 200 字 · 上游 6Hz 尾串增量</text>
      <text x="280" y="284" text-anchor="end" class="costNum2" fill="${pal.warm}">${D.cost}</text>
    </svg>
    <div class="iconWrap" style="left:80px;top:14px">${icon(140, pal, 'p')}</div>
    <div class="hit" style="left:80px;top:14px"></div>
    <div class="actionTag" style="left:110px;top:150px">${D.actionShort} · 流动中</div>
  </div>`
}

/* ============================ 皮肤（每套一材一调，≤5 色） ============================ */
const SKINS = {
  orbit: { name: 'ORBIT · 环流式', ref: '全息环状仪表语言 —— 《Elysium》(2013, Territory Studio) 的极简全息环 · 《Oblivion》(2013, GMUNK) 的干净球形 HUD · 《Ghost in the Shell》(1995, Production I.G) 的环状数据列。借的是"信息绕着中心器体转"这条语汇。', risk: '✅ 可做，风险低。弧=SVG path，文本=textPath；三套里最"一体"。中文沿弧排版需 size 10–11px 且弧半径 ≥120（更小会挤压字距）。', meta: { size: '面板 320 × 220（窗口 320 × 300）', pal: '#0c0e0f 石墨 / #e8eef0 主文 / #8a9698 次 / #ffb257 花费·任务 / #5fd8c4 状态带', font: '等宽（数字与单位）+ 系统无衬线（正文）', tech: '面板不是卡片，而是图标环系的**向外延伸**：弧心与图标同心，r=110 状态弧带 / 132 思考流 / 156 花费刻度 / 178 任务分段弧', anim: '状态弧带 0.9Hz 呼吸 · 思考文本沿弧 24px/s 流动 · 花费刻度随金额逐格点亮 · 任务分段弧随完成度生长' } },
  schematic: { name: 'SCHEMATIC · 线框标注', ref: '军用/航天线框 HUD 与工程标注 —— 《Alien》(1979) Nostromo 的单色 CRT（Syd Mead / Ron Cobb 语汇）· 《Interstellar》(2014, DNEG) 刻意"反全息"的实体仪表 · 《Star Citizen》座舱 HUD · 《Halo》ONI 线框界面。借的是"引线+角标+刻度"的工程图纸语法。', risk: '✅ 可做，风险低但**最怕花壁纸**：1px 细线在杂乱背景上会消失，必须压一层 ≥45% 的暗底。文字最少，抗小尺寸能力最强。', meta: { size: '面板 300 × 200（窗口 300 × 300）', pal: '#0b0d0e 石墨 / #d9e2e2 主文 / #6f7d7f 细线 / #ffb257 数据 / #ffffff 强调', font: '等宽（全部，Consolas/DejaVu Sans Mono）', tech: '工程图语法：中心虚线轴 + 四角括号 + 引线从图标外环拉到数据锚点 + 底部刻度尺 + 12 格任务槽位', anim: '引线端点 0.5Hz 微脉动 · 任务方块逐个点亮 · 刻度尺游标随花费右移' } },
  holo: { name: 'HOLO-STACK · 全息堆叠', ref: '多层玻璃片 / 景深全息 FUI —— 《Iron Man 2/3》(Jayse Hansen) 的多层玻璃面板 · 《Minority Report》(2002, John Underkoffler / Oblong) 的层叠可操作界面 · 《Prometheus》(2012, Territory Studio) 的玻璃层全息。借的是"数据分层悬浮 + 层间深度关系"。', risk: '⚠️ 可做但有前提：CSS 的 `backdrop-filter` 在**透明窗口上无效**（背后没有可采样的内容），所以玻璃感只能靠渐变+描边+投影"画"出来，不能真模糊。层间错位在 300px 宽下最多 ±16px，再多就散。', meta: { size: '面板 320 × 220（窗口 320 × 340）', pal: '#0e1012 石墨 / #eef3f5 主文 / #93a3a8 次 / #7fd8ff 冷光 / #c9a6ff 紫罗兰', font: '系统无衬线 + 等宽数字', tech: '三层玻璃片悬浮错位 + 轻透视（rotateX 9° / 左右错位 ±16px / 层间缩放 1→0.955），一道竖向光束串起图标与三层', anim: '三层 0.3Hz 相位呼吸（错峰 120ms）· 数据更新只让该层内容流动，玻璃片本身不动' } },
  plasma: { name: 'PLASMA-TEXT · 粒子文本流', ref: '有机/粒子化数据形态 —— 《Arrival》(2016) 的墨圈语言（Martine Bertrand 设计，Wolfram 团队顾问）· 《Annihilation》(2018) 的流体质感 · 《Death Stranding》(Kojima Productions) 的粒子化 UI 动效。借的是"信息不是写出来的，是凝聚出来的"。', risk: '❌ **真·粒子聚合字形做不到/不划算**（见下方说明），已退化为"流动文本 + 尾迹 + 粒子流场"——这是同流派里在 320px 透明窗口上真正成立的那一半。', meta: { size: '面板 300 × 200（窗口 300 × 320）', pal: '#0d0e10 石墨 / #eef2f3 主文 / #8b9a9c 次 / #6fe3b0 等离子 / #b79cff 火花', font: '系统无衬线（正文）+ 等宽（数字）', tech: '思考文本带尾迹（左淡右实线性渐变）沿曲率流动，右侧 150 颗粒子按流场分布并向文本"凝聚"', anim: '粒子 1.2Hz 沿流线漂移 + 尾迹端点闪烁 · 文本尾串增长时只重绘渐变尾部，不重排' } }
}

const SHARED = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{width:520px;font-family:system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
  .desk{position:relative;width:520px;height:430px;overflow:hidden;
    background:radial-gradient(130% 90% at 18% 0%,rgba(255,255,255,.055),rgba(255,255,255,0) 62%),
      linear-gradient(158deg,#41464c 0%,#373c42 44%,#2d3136 100%)}
  .desk::after{content:"";position:absolute;inset:0;pointer-events:none;
    background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px);background-size:24px 24px;opacity:.55}
  .win{position:absolute}
  .layer{position:absolute;left:0;top:0}
  .iconWrap{position:absolute;width:140px;height:140px}
  .hit{position:absolute;width:140px;height:140px;border-radius:50%;outline:1px dashed rgba(255,255,255,.16)}
  .actionTag{position:absolute;font-size:9.5px;letter-spacing:.4px;color:#cfd8da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .thinkflow{font-size:9.5px;letter-spacing:.35px}
  .costNum{font-size:19px;font-family:Consolas,'DejaVu Sans Mono',monospace;font-variant-numeric:tabular-nums;letter-spacing:.5px}
  .costNum2{font-size:13px;font-family:Consolas,'DejaVu Sans Mono',monospace;font-variant-numeric:tabular-nums}
  .unit{font-size:8.5px;letter-spacing:.6px}
  .cap2{font-size:8.5px;letter-spacing:.7px}
  .lab{font-size:8px;letter-spacing:.9px;font-family:Consolas,'DejaVu Sans Mono',monospace}
  .val{font-size:12px;font-family:Consolas,'DejaVu Sans Mono',monospace;font-variant-numeric:tabular-nums}
  .act{font-size:13px;letter-spacing:2px;font-family:Consolas,'DejaVu Sans Mono',monospace}
  .act2{font-size:9px;letter-spacing:.4px}
  .thinkline{font-size:10px;letter-spacing:.2px}
  .flowline{font-size:11px;letter-spacing:.3px}
  .cap{width:520px;padding:15px 20px 18px;background:#141618;color:#e8ecee}
  .cap h3{margin:0 0 7px;font-size:15px;letter-spacing:.5px}
  .cap h3 .ref{font-size:9.5px;letter-spacing:1px;color:#ffb257;border:1px solid #3d4448;border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.72;color:#b6c0c6}
  .cap b{color:#eef2f4}
  .cap .k{display:inline-block;width:62px;color:#7d888f}
`

/* 各方向专属 CSS（材质只在这里差异化） */
const CSS = {
  orbit: `
  .win{background:radial-gradient(72% 60% at 50% 34%,rgba(12,14,15,.72),rgba(12,14,15,.30) 70%,rgba(12,14,15,0));
    border-radius:50% 50% 118px 118px/38% 38% 96px 96px}
  .actionTag{text-shadow:0 1px 3px rgba(0,0,0,.8)}
  .costNum{text-shadow:0 1px 4px rgba(0,0,0,.75)}`,
  schematic: `
  .win{background:linear-gradient(180deg,rgba(11,13,14,.30),rgba(11,13,14,.62));
    border:1px solid rgba(111,125,127,.55);border-radius:2px}
  .cap .tag{border-color:#3a4144}`,
  holo: `
  .stack{position:absolute;left:0;top:0;width:320px;height:340px;perspective:900px}
  .plate{position:absolute;left:26px;width:268px;border-radius:10px;padding:9px 12px;
    background:linear-gradient(158deg,rgba(240,246,248,.13),rgba(240,246,248,.05) 46%,rgba(240,246,248,.09));
    border:1px solid rgba(226,240,246,.30);
    box-shadow:0 12px 26px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.22)}
  .p3{top:184px;transform:rotateX(9deg) translateZ(26px);opacity:1;z-index:3}
  .p2{top:238px;left:40px;width:240px;transform:rotateX(9deg) scale(.975) translateZ(-6px);opacity:.86;z-index:2}
  .p1{top:296px;left:22px;width:276px;transform:rotateX(9deg) scale(.955) translateZ(-40px);opacity:.74;z-index:1}
  .beam{position:absolute;left:158px;top:150px;width:2px;height:186px;
    background:linear-gradient(180deg,rgba(127,216,255,.55),rgba(127,216,255,.05))}
  .ph,.ph2{display:block;font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:9px;letter-spacing:1px;color:#9fb6bd}
  .ph .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#7fd8ff;margin-right:7px;vertical-align:1px}
  .ph .act{font-size:10.5px;letter-spacing:1.4px;color:#eef3f5;margin-left:2px}
  .ph .el,.ph2 .el2{float:right;color:#93a3a8}
  .pv{margin-top:3px;font-size:10px;color:#dfe9ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pt{font-size:10.5px;line-height:15px;color:#eef3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pt.dim{color:#bfd0d5}
  .grid{position:relative;height:44px}
  .cell{position:absolute;left:0;top:0;width:50%}
  .cell.r{left:auto;right:0;text-align:right}
  .cell .k{font-size:8.5px;letter-spacing:1.1px;color:#9fb6bd;font-family:Consolas,monospace}
  .cell .v{font-size:17px;color:#eef3f5;font-family:Consolas,monospace;font-variant-numeric:tabular-nums;line-height:20px}
  .cell .u{font-size:8.5px;color:#93a3a8}
  .cell .slash{color:#c9a6ff;font-size:13px;margin:0 1px}
  .bars{position:absolute;right:0;bottom:2px;display:block}
  .bars i{display:inline-block;width:9px;height:3px;margin-left:3px;border-radius:1px;background:#c9a6ff}`,
  plasma: `
  .win{background:radial-gradient(70% 58% at 46% 40%,rgba(13,14,16,.66),rgba(13,14,16,.22) 72%,rgba(13,14,16,0))}
  .flowline{text-shadow:0 1px 3px rgba(0,0,0,.8)}
  .actionTag{text-shadow:0 1px 3px rgba(0,0,0,.85)}`
}

for (const [slug, s] of Object.entries(SKINS)) {
  const pal = { plate0: '#050809', key: '#5fd8c4', warm: '#ffb257', dim: '#8a9698', text: '#e8eef0', line: '#6f7d7f', mote: '#8b9a9c' }
  if (slug === 'holo') { pal.key = '#7fd8ff'; pal.warm = '#c9a6ff'; pal.text = '#eef3f5'; pal.dim = '#93a3a8'; pal.line = '#6f7d7f' }
  if (slug === 'plasma') { pal.key = '#6fe3b0'; pal.warm = '#b79cff'; pal.text = '#eef2f3'; pal.dim = '#8b9a9c'; pal.mote = '#8b9a9c' }
  if (slug === 'schematic') { pal.key = '#d9e2e2'; pal.warm = '#ffb257'; pal.text = '#d9e2e2'; pal.dim = '#6f7d7f' }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${s.name}</title>
<style>${SHARED}${CSS[slug]}</style></head><body>
<div class="desk">${DIRS[slug](pal)}</div>
<div class="cap">
  <h3>${s.name} <span class="ref">流派参照</span></h3>
  <div><span class="k">流派参照</span>${s.ref}</div>
  <div><span class="k">尺寸</span>${s.meta.size}</div>
  <div><span class="k">配色 5</span>${s.meta.pal}</div>
  <div><span class="k">字体</span>${s.meta.font}</div>
  <div><span class="k">同构技法</span>${s.meta.tech}</div>
  <div><span class="k">动效</span>${s.meta.anim}</div>
  <div><span class="k">可行性</span>${s.risk}</div>
</div>
</body></html>`
  fs.writeFileSync(path.join(OUT, `${slug}.html`), html)
  console.log('written ' + slug + '.html')
}
