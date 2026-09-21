#!/usr/bin/env node
/* build-live.mjs —— **真会动**的方案页生成器（8 套 + 4 版组合 + 总入口）
 * 技术规则（硬）：只动 transform / opacity / background-position（合成层）
 *   ✗ 不用 filter: blur / backdrop-filter / 逐帧 width / 逐帧 box-shadow
 * 每页：三态自动循环（推进 → 完成换形态 → 静止微动），可暂停、可切三档
 * 三尺寸同页：140px（面板大图）/ 88px（面板小格）/ 46px（悬浮层），深色+浅色壁纸并排
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

function makeRnd (s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

/* ============================ 8 套 + 4 版组合的**动效化**生成器 ============================
   每个 scheme.render(size, id) 返回 { html, css }：html 里带 class 钩子，css 是真 @keyframes */
const SCHEMES = {}

/* ① ORBITAL —— 环：分段点亮（opacity）+ 运行体绕行（transform rotate） */
SCHEMES.orbital = {
  name: '① ORBITAL · 轨道环', tag: '环系 · 复用图标本体',
  rel: '复用图标自带的 60 分段环与 94 刻度环 —— 运行体就跑在图标已有的半径上',
  roles: ['<b>主进度</b>：分段弧长（段数 = 进度，最可比）', '状态：不参与进度，只表示"在跑/在等"', '完成态：整环补齐 → 转绿 → 对勾（同一元素换形态）'],
  render (s, id) {
    const N = 12, cx = s / 2, R = s / 2 - s * 0.04, c = 2 * Math.PI * R
    let seg = ''
    for (let i = 0; i < N; i++) seg += `<circle class="seg" data-i="${i}" cx="${cx}" cy="${cx}" r="${R}" fill="none" stroke="#56d9c8" stroke-width="${(s / 46 * 2.6).toFixed(2)}" stroke-linecap="butt" stroke-dasharray="${(c / N * 0.62).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-c / N * i + c / 4).toFixed(1)}" transform="rotate(-90 ${cx} ${cx})" opacity="0.12"/>`
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
        <circle cx="${cx}" cy="${cx}" r="${R * 1.05}" fill="none" stroke="#92aac0" stroke-opacity=".2" stroke-width="1" stroke-dasharray="1.5 ${(s / 46 * 4).toFixed(1)}"/>
        ${seg}
        <g class="runner"><circle cx="${cx}" cy="${cx - R}" r="${(s / 46 * 2.6).toFixed(2)}" fill="#e8f0fa"/></g>
        <g class="done"><path d="M${cx - R * 0.34} ${cx + R * 0.02} L${cx - R * 0.06} ${cx + R * 0.3} L${cx + R * 0.38} ${cx - R * 0.28}" fill="none" stroke="#7fe3c8" stroke-width="${(s / 46 * 3).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0"/></g>
      </svg>`,
      css: `.runner{transform-origin:${cx}px ${cx}px;animation:orbSpin 3.2s linear infinite}
        @keyframes orbSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .paused .g *{animation-play-state:paused}
        .done path{transition:opacity .25s}`
    }
  },
  upd: function (root, p, state) { ringSegUpdate(root, p, state) }
}
/* ② NEBULA —— 云：密度/半径由段（opacity）表达，云本身旋转（transform） */
SCHEMES.nebula = {
  name: '② NEBULA · 星云场', tag: '粒子 · 复用图标核心材质',
  rel: '复用图标中间那团等离粒子云，让云随进度向内聚拢',
  roles: ['<b>主进度</b>：云的紧密度 + 核心亮度', '状态：由核心点颜色表示', '完成态：向外爆散再回聚 + 收成实心环'],
  render (s, id) {
    const cx = s / 2, R = s / 2 - s * 0.06, rnd = makeRnd(4242 + id)
    let dots = ''
    for (let i = 0; i < 60; i++) {
      const th = rnd() * 6.283, rr = (0.3 + 0.7 * Math.sqrt(rnd())).toFixed(3), z = rnd()
      dots += `<circle class="pt" data-r="${rr}" cx="${(cx + Math.cos(th) * Number(rr) * R).toFixed(4)}" cy="${(cx + Math.sin(th) * Number(rr) * R).toFixed(4)}" r="${(s / 46 * (0.55 + z * 1.1)).toFixed(2)}" fill="${z > 0.5 ? '#56d9c8' : '#92aac0'}" opacity="${(0.2 + 0.6 * z).toFixed(2)}"/>`
    }
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
        <g class="cloud" style="transform-origin:${cx}px ${cx}px">${dots}</g>
        <circle class="core" cx="${cx}" cy="${cx}" r="${(s / 46 * 2.4).toFixed(2)}" fill="#e8f0fa" opacity=".6"/>
        <circle class="shock" cx="${cx}" cy="${cx}" r="${(s / 46 * 4).toFixed(2)}" fill="none" stroke="#56d9c8" stroke-width="1.6" opacity="0"/>
      </svg>`,
      css: `.cloud{animation:nebDrift 26s linear infinite}
        @keyframes nebDrift{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .shock{transform-origin:center;transform-box:fill-box}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    root.querySelectorAll('.pt').forEach((el) => {
      const r = Number(el.dataset.r)
      const rr = (0.30 + 0.70 * r) * (1 - 0.34 * p)          /* 进度越大越向内聚拢（归一化 0~1） */
      /* rr 是**归一化半径**，必须换算到当前 svg 的画布坐标：中心 + rr × R（各槽位 viewBox 不同） */
      const vb = el.ownerSVGElement.viewBox.baseVal
      const CCX = vb.x + vb.width / 2, CCY = vb.y + vb.height / 2
      const RR = Math.min(vb.width, vb.height) / 2 * 0.94
      const th = Math.atan2(Number(el.getAttribute('cy')) - CCY || 0.001, Number(el.getAttribute('cx')) - CCX || 0.001)
      el.setAttribute('cx', (CCX + Math.cos(th) * rr * RR).toFixed(4))
      el.setAttribute('cy', (CCY + Math.sin(th) * rr * RR).toFixed(4))
    })
    const core = root.querySelector('.core'); if (core) core.setAttribute('opacity', (0.35 + 0.55 * p).toFixed(2))
    nebComplete(root, state)
  }
}
/* ③ CRYSTAL —— 刻面逐面生长（opacity）+ 完成闭合 */
SCHEMES.crystal = {
  name: '③ CRYSTAL · 结晶生长', tag: '有机生长 · 从核心三角长出',
  rel: '从图标核心那个三角形长出来：6 个刻面逐面生长，对称语言与中心三角一致',
  roles: ['<b>主进度</b>：已长出的刻面数', '状态：核心点呼吸', '完成态：最后一格闭合 → 整块晶体亮一次'],
  render (s, id) {
    const cx = s / 2, R = s / 2 - s * 0.04, N = 6
    let f = ''
    for (let i = 0; i < N; i++) {
      const a0 = -90 + (360 / N) * i + 4, a1 = -90 + (360 / N) * (i + 1) - 4
      const p0 = [cx + Math.cos(a0 * Math.PI / 180) * R, cx + Math.sin(a0 * Math.PI / 180) * R]
      const p1 = [cx + Math.cos(a1 * Math.PI / 180) * R, cx + Math.sin(a1 * Math.PI / 180) * R]
      f += `<path class="facet" data-i="${i}" d="M${cx} ${cx} L${p0[0].toFixed(1)} ${p0[1].toFixed(1)} L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Z" fill="#56d9c8" fill-opacity="0.05" stroke="#56d9c8" stroke-opacity="0.2" stroke-width="${(s / 46 * 1).toFixed(2)}" style="transition:fill-opacity .3s,stroke-opacity .3s"/>`
    }
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${f}
        <circle class="core" cx="${cx}" cy="${cx}" r="${(s / 46 * 2.6).toFixed(2)}" fill="#e8f0fa"/></svg>`,
      css: `.core{animation:crBreath 1.8s ease-in-out infinite;transform-origin:${cx}px ${cx}px}
        @keyframes crBreath{0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:.95;transform:scale(1.12)}}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    root.querySelectorAll('.facet').forEach((el, i) => {
      const on = (i + 1) / 6 <= p + 0.001
      el.setAttribute('fill-opacity', on ? (state === 'complete' ? 0.55 : 0.34) : 0.05)
      el.setAttribute('stroke-opacity', on ? 0.95 : 0.2)
    })
  }
}
/* ④ RADAR —— 扇区覆盖（用扇形段 opacity）+ 扫描线旋转（transform） */
SCHEMES.radar = {
  name: '④ RADAR · 极坐标扇区', tag: '扫掠 · 复用图标刻度环',
  rel: '把图标最外那圈刻度直接当雷达表盘，扫描扇区在上面推进',
  roles: ['<b>主进度</b>：扇区覆盖角', '状态：扫描线速度', '完成态：全周扫一遍 + 回波亮点'],
  render (s, id) {
    const cx = s / 2, R = s / 2 - s * 0.04, N = 24
    let seg = '', tk = ''
    for (let i = 0; i < N; i++) {
      const a0 = (360 / N) * i - 90, a1 = (360 / N) * (i + 1) - 90
      const x0 = cx + Math.cos(a0 * Math.PI / 180) * (R - s * 0.06), y0 = cx + Math.sin(a0 * Math.PI / 180) * (R - s * 0.06)
      const x1 = cx + Math.cos(a1 * Math.PI / 180) * (R - s * 0.06), y1 = cx + Math.sin(a1 * Math.PI / 180) * (R - s * 0.06)
      seg += `<path class="sw" data-i="${i}" d="M${cx} ${cx} L${x0.toFixed(1)} ${y0.toFixed(1)} A${(R - s * 0.06).toFixed(1)} ${(R - s * 0.06).toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="#56d9c8" fill-opacity="0.05" stroke="#56d9c8" stroke-opacity="0.12" stroke-width="0.8"/>`
      tk += `<line x1="${cx}" y1="${s * 0.02}" x2="${cx}" y2="${s * 0.02 + s * 0.05}" stroke="#92aac0" stroke-opacity=".45" stroke-width="1.2" transform="rotate(${(360 / N) * i} ${cx} ${cx})"/>`
    }
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${tk}${seg}
        <g class="sweep" style="transform-origin:${cx}px ${cx}px"><line x1="${cx}" y1="${cx}" x2="${cx}" y2="${(cx - R + s * 0.06).toFixed(1)}" stroke="#e8f0fa" stroke-width="${(s / 46 * 1.3).toFixed(2)}" opacity=".85"/></g>
        <circle cx="${cx}" cy="${cx}" r="${(s / 46 * 2).toFixed(2)}" fill="#e8f0fa"/></svg>`,
      css: `.sweep{animation:radSweep 2.6s linear infinite}
        @keyframes radSweep{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    root.querySelectorAll('.sw').forEach((el, i) => {
      const on = (i + 1) / 24 <= p + 0.001
      el.setAttribute('fill-opacity', on ? (state === 'complete' ? 0.3 : 0.2) : 0.05)
      el.setAttribute('stroke-opacity', on ? 0.6 : 0.12)
    })
  }
}
/* ⑤ FIELD —— 波纹：环用 opacity 逐圈点亮 + 呼吸缩放（transform） */
SCHEMES.field = {
  name: '⑤ FIELD · 能量场', tag: '波纹 · 复用图标辉光',
  rel: '图标外层辉光本来就是一个"场"，这里把场变成可数的同心波',
  roles: ['<b>主进度</b>：已扩散的波环数', '状态：最内环呼吸', '完成态：一次强外向波 → 收成实心环'],
  render (s, id) {
    const cx = s / 2, R = s / 2 - s * 0.04, N = 5
    let r = ''
    for (let i = 0; i < N; i++) r += `<circle class="wv" data-i="${i}" cx="${cx}" cy="${cx}" r="${(R * (0.28 + 0.72 * ((i + 1) / N))).toFixed(1)}" fill="none" stroke="#56d9c8" stroke-width="${(s / 46 * 1.4).toFixed(2)}" opacity="0.1"/>`
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${r}
        <circle class="core" cx="${cx}" cy="${cx}" r="${(s / 46 * 4).toFixed(2)}" fill="#e8f0fa" opacity=".7"/></svg>`,
      css: `.core{animation:fdBreath 2.2s ease-in-out infinite;transform-origin:${cx}px ${cx}px}
        @keyframes fdBreath{0%,100%{transform:scale(.86);opacity:.5}50%{transform:scale(1.14);opacity:.95}}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    root.querySelectorAll('.wv').forEach((el, i) => {
      const on = (i + 1) / 5 <= p + 0.001
      el.setAttribute('opacity', on ? (state === 'complete' ? 0.85 : 0.35 + 0.1 * i) : 0.1)
    })
  }
}
/* ⑥ GRID —— 错列矩阵：格子 opacity 点亮 + 当前格脉冲 */
SCHEMES.grid = {
  name: '⑥ GRID · 网格电池', tag: '矩列 · 复用面板网格纹理',
  rel: 'H2 面板本来就铺着 22px 网格，把纹理升级成载体（错列矩阵一格 = 一项任务）',
  roles: ['<b>主进度</b>：已填充格数（离散可数）', '状态：当前格脉冲', '完成态：最后格 → 整片收成实心六边形 → 对勾'],
  render (s, id) {
    const cols = 4, rows = 4, gap = s * 0.04, cw = (s - gap * (cols + 1)) / cols, ch = (s - gap * (rows + 1)) / rows
    let g = '', k = 0
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, k++) {
      const off = (r % 2) ? cw / 2 : 0
      g += `<rect class="cell" data-i="${k}" x="${(gap + c * (cw + gap) + off - (off ? gap / 2 : 0)).toFixed(1)}" y="${(gap + r * (ch + gap)).toFixed(1)}" width="${Math.max(1, cw - (off ? gap / 2 : 0)).toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill="#56d9c8" fill-opacity="0.06" stroke="#56d9c8" stroke-opacity="0.18" stroke-width="1"/>`
    }
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${g}<rect class="scan" x="0" y="0" width="${(s * 0.18).toFixed(1)}" height="${s}" fill="#56d9c8" fill-opacity="0.10"/></svg>`,
      css: `.cell{transition:fill-opacity .22s,stroke-opacity .22s}
        .scan{animation:gridScan 2.2s linear infinite}
        @keyframes gridScan{from{transform:translateX(${(-s * 0.2).toFixed(1)}px)}to{transform:translateX(${s.toFixed(1)}px)}}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    const cells = root.querySelectorAll('.cell')
    const lit = Math.round(p * cells.length)
    cells.forEach((el, i) => {
      const on = i < lit
      el.setAttribute('fill-opacity', on ? (state === 'complete' ? 0.9 : 0.7) : 0.06)
      el.setAttribute('stroke-opacity', on ? 0.95 : 0.18)
      el.style.opacity = (i === lit && state === 'advance') ? String(0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 260))) : '1'
    })
  }
}
/* ⑦ PULSE —— 波形：已过长度用 opacity 点亮 + 前沿点滑动（transform translate） */
SCHEMES.pulse = {
  name: '⑦ PULSE · 心电波形', tag: '波形 · 图标心跳的字面化',
  rel: 'WAITING 态用交叉淡入做呼吸 —— 把那条看不见的脉搏画成波形',
  roles: ['<b>主进度</b>：波形推进长度', '状态：前沿抖动频率', '完成态：一次高尖峰 → 拉平 → 对勾'],
  render (s, id) {
    const mid = s / 2, n = 40
    let path = ''
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = t * (s - s * 0.06) + s * 0.03
      let y = mid + (i % 4 === 0 ? -s * 0.1 : 0) + (i % 8 === 4 ? s * 0.08 : 0)
      if (i === Math.round(n * 0.62)) y = mid - s * 0.38
      path += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
    }
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
        <path d="${path}" fill="none" stroke="#92aac0" stroke-opacity=".3" stroke-width="1"/>
        <path class="tr" d="${path}" fill="none" stroke="#56d9c8" stroke-width="${(s / 46 * 2).toFixed(2)}" stroke-linejoin="round" stroke-dasharray="999" stroke-dashoffset="999"/>
        <g class="head"><circle cx="${s * 0.03}" cy="${mid}" r="${(s / 46 * 2.4).toFixed(2)}" fill="#e8f0fa"/></g></svg>`,
      css: `.tr{transition:stroke-dashoffset .18s linear}
        .head{animation:plHead 1.1s ease-in-out infinite alternate}
        @keyframes plHead{from{transform:translateX(0)}to{transform:translateX(1.6px)}}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    const tr = root.querySelector('.tr'), head = root.querySelector('.head'); if (!tr) return
    const total = tr.getTotalLength ? tr.getTotalLength() : 400
    tr.setAttribute('stroke-dasharray', String(total))
    tr.setAttribute('stroke-dashoffset', String(total * (1 - p)))
    if (head) head.setAttribute('transform', 'translate(' + (p * (root.querySelector('svg').getAttribute('width') - 6)).toFixed(1) + ' 0)')
  }
}
/* ⑧ FRACTAL —— 递归：层级 opacity 展开 + 当前层呼吸（transform scale） */
SCHEMES.fractal = {
  name: '⑧ FRACTAL · 分形递归', tag: '递归 · 图标自相似性',
  rel: '三角嵌圆、圆嵌分段环 —— 让这个自相似再深一层',
  roles: ['<b>主进度</b>：递归展开深度（只有 3~4 档）', '状态：最内层呼吸', '完成态：最外层闭合成壳 → 对勾'],
  render (s, id) {
    const cx = s / 2, R = s / 2 - s * 0.04
    let out = ''
    function tri (x, y, r, depth) {
      if (depth > 3) return ''
      const pts = [0, 120, 240].map((a) => [x + Math.cos((a - 90) * Math.PI / 180) * r, y + Math.sin((a - 90) * Math.PI / 180) * r])
      let o = `<path class="lv" data-l="${depth}" d="M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)} L${pts[2][0].toFixed(1)} ${pts[2][1].toFixed(1)} Z" fill="#56d9c8" fill-opacity="0.04" stroke="#56d9c8" stroke-opacity="0.14" stroke-width="${(s / 46 * 0.9).toFixed(2)}" style="transition:fill-opacity .28s,stroke-opacity .28s"/>`
      for (const q of pts) o += tri((x + 2 * q[0]) / 3, (y + 2 * q[1]) / 3, r / 3, depth + 1)
      return o
    }
    out = tri(cx, cx + s * 0.03, R * 0.9, 1)
    return {
      html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${out}
        <circle class="core" cx="${cx}" cy="${cx}" r="${(s / 46 * 2).toFixed(2)}" fill="#e8f0fa"/></svg>`,
      css: `.core{animation:frBreath 2s ease-in-out infinite;transform-origin:${cx}px ${cx}px}
        @keyframes frBreath{0%,100%{transform:scale(.85);opacity:.45}50%{transform:scale(1.15);opacity:.95}}
        .paused .g *{animation-play-state:paused}`
    }
  },
  upd: function (root, p, state) {
    const lit = Math.round(p * 3)
    root.querySelectorAll('.lv').forEach((el) => {
      const d = Number(el.dataset.l), on = d <= lit
      el.setAttribute('fill-opacity', on ? (state === 'complete' ? 0.16 : 0.1) : 0.04)
      el.setAttribute('stroke-opacity', on ? (d === lit ? 0.95 : 0.55) : 0.14)
    })
  }
}
/* ---------- 组合 A/B/C/D ---------- */
function comboRender (s, id, v) {
  const o = SCHEMES.orbital.render(s, id), n = SCHEMES.nebula.render(s, id), f = SCHEMES.fractal.render(s, id)
  /* 三个元素按版分配尺寸与透明度：主进度=1.0，其余按职责缩到 0.7~0.86 */
  const lay = {
    A: { o: 1.0, n: 0.62, f: 0.72 },      /* 环主 · 云=状态 · 分形=完成态 */
    B: { o: 1.0, n: 0.94, f: 0.78 },      /* 云主 · 环=外壳 · 分形=层级 */
    C: { o: 0.96, n: 0.88, f: 1.0 },      /* 分形主 · 环=读数 · 云=背景 */
    D: { o: 1.0, n: 0.72, f: 0.80 }       /* 推荐：正交 */
  }[v]
  const wrap = (h, sc, op, cls) => `<g class="${cls}" transform="translate(${(s / 2 * (1 - sc)).toFixed(1)} ${(s / 2 * (1 - sc)).toFixed(1)}) scale(${sc})" opacity="${op}">${h.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>`
  return {
    html: `<svg class="g" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      ${wrap(f.html, lay.f, v === 'C' ? 1 : 0.85, 'elF')}
      ${wrap(n.html, lay.n, v === 'C' ? 0.6 : 0.9, 'elN')}
      ${wrap(o.html, lay.o, 1, 'elO')}</svg>`,
    css: o.css + n.css + f.css
  }
}
SCHEMES['combo-A'] = { name: '组合 A · 环主进度', tag: '环=进度 · 云=状态 · 分形=完成态',
  rel: '三种填充语义冲突的解法：只让环表达进度',
  roles: ['<b>主进度</b>：环的弧长（缺口位置，最精确可比）', '状态：跑着才聚拢发亮（<b>不表达进度</b>）', '完成态：完成瞬间分形外壳闭合'],
  render: (s, id) => comboRender(s, id, 'A'),
  upd: function (root, p, state) { comboUpd(root, p, state) } }
SCHEMES['combo-B'] = { name: '组合 B · 云主进度', tag: '云=进度 · 环=外壳 · 分形=层级',
  rel: '云做进度、环退成"上限刻度"，分形只暗示层级',
  roles: ['外壳与刻度：满圈刻度表达上限，<b>永不表达进度</b>', '<b>主进度</b>：云的紧密度与核心亮度', '层级：递归层数暗示子任务深度'],
  render: (s, id) => comboRender(s, id, 'B'),
  upd: function (root, p, state) { comboUpd(root, p, state) } }
SCHEMES['combo-C'] = { name: '组合 C · 分形主进度', tag: '分形=进度 · 环=读数 · 云=背景',
  rel: '分形做进度、环给准数、云纯氛围',
  roles: ['精确读数：弧长给准数', '背景常驻场：不承载数值', '<b>主进度</b>：递归展开深度（离散 3~4 档）'],
  render: (s, id) => comboRender(s, id, 'C'),
  upd: function (root, p, state) { comboUpd(root, p, state) } }
SCHEMES['combo-D'] = { name: '组合 D · 推荐（职责正交）', tag: '环=进度 · 云=状态 · 分形=层级结构',
  rel: '三者职责完全不重叠：进度 / 状态 / 结构',
  roles: ['<b>主进度</b>：弧长（唯一进度表达）', '活跃度：跑着=聚拢发亮（唯一状态表达）', '结构骨架：递归层级 = 子代理层级（与树同构，<b>不表达进度</b>）'],
  render: (s, id) => comboRender(s, id, 'D'),
  upd: function (root, p, state) { comboUpd(root, p, state) } }

/* ---------- 共用更新函数 ---------- */
function ringSegUpdate (root, p, state) {
  const segs = root.querySelectorAll('.seg')
  const lit = Math.round(p * segs.length)
  segs.forEach((el, i) => {
    const on = i < lit
    el.setAttribute('opacity', on ? (state === 'complete' ? 1 : 0.92) : (i === lit && state === 'advance' ? String(0.35 + 0.5 * Math.abs(Math.sin(Date.now() / 260))) : '0.12'))
  })
  const done = root.querySelector('.done path')
  if (done) done.setAttribute('opacity', state === 'complete' ? 1 : 0)
  const rn = root.querySelector('.runner')
  if (rn) rn.setAttribute('opacity', state === 'complete' ? 0 : 1)
}
function nebComplete (root, state) {
  const sh = root.querySelector('.shock')
  if (sh) sh.setAttribute('opacity', state === 'complete' ? 0.75 : 0)
}
function comboUpd (root, p, state) {
  root.querySelectorAll('svg.g').forEach((g) => {
    /* 每个子元素单独更新（子 svg 被拆成 g，直接在其中查类） */
    ringSegUpdate(g, p, state); nebComplete(g, state)
    const lit = Math.round(p * 3)
    g.querySelectorAll('.lv').forEach((el) => {
      const d = Number(el.dataset.l), on = d <= lit
      el.setAttribute('fill-opacity', on ? (state === 'complete' ? 0.16 : 0.1) : 0.04)
      el.setAttribute('stroke-opacity', on ? (d === lit ? 0.95 : 0.5) : 0.14)
    })
    g.querySelectorAll('.pt').forEach((el) => {
      /* 同 nebula UPD：rr 是归一化半径，必须按当前 viewBox 换算（combo 的 A/B/C/D 都用这条） */
  const vb = el.ownerSVGElement.viewBox.baseVal
  const CCX = vb.x + vb.width / 2, CCY = vb.y + vb.height / 2
  const RR = Math.min(vb.width, vb.height) / 2 * 0.94
  const r = Number(el.dataset.r), th = Math.atan2(Number(el.getAttribute('cy')) - CCY || 0.001, Number(el.getAttribute('cx')) - CCX || 0.001)
      const rr = (0.30 + 0.70 * r) * (1 - 0.34 * p)
      el.setAttribute('cx', (CCX + Math.cos(th) * rr * RR).toFixed(4)); el.setAttribute('cy', (CCY + Math.sin(th) * rr * RR).toFixed(4))
    })
    const core = g.querySelector('.core'); if (core) core.setAttribute('opacity', (0.35 + 0.55 * p).toFixed(2))
  })
}

/* ============================ 页面生成 ============================ */
const TIERS = { eco: { fps: 0, sustain: false, name: '省电' }, standard: { fps: 10, sustain: true, name: '标准' }, smooth: { fps: 30, sustain: true, name: '流畅' } }
const CPUTAB = { eco: [0.32, 0.31, 0.38, 0.39], standard: [0.47, 0.47, 0.74, 0.64], smooth: [0.72, 0.79, 1.02, 1.10] }
const DESKS = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
}
let ticks = ''
for (let i = 0; i < 26; i++) ticks += `<i class="${i % 5 === 0 ? 'long' : ''}" style="left:${i * 6}px"></i>`
const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0d1117;width:1200px;color:#e4ecf4}
  .bar{position:sticky;top:0;z-index:9;background:#111823;border-bottom:1px solid #23303f;padding:8px 14px;white-space:nowrap}
  .bar a{color:#6fb6ff;text-decoration:none;font-size:12px;margin-right:14px}
  .bar button{background:#1b2634;color:#cfe0ea;border:1px solid #33506a;border-radius:3px;padding:3px 9px;font-size:11px;margin-right:6px;cursor:pointer}
  .bar button.on{background:#56d9c8;color:#0d1117;border-color:#56d9c8;font-weight:700}
  .bar .nm{font-size:13px;font-weight:700;margin-right:12px}
  .row{white-space:nowrap}
  .side{display:inline-block;vertical-align:top}
  .desk{position:relative;width:600px;height:430px;overflow:hidden}
  .iconw{position:absolute;left:60px;top:26px}
  .hovw{position:absolute;left:40px;top:200px;display:flex;align-items:center}
  .hov{position:relative;width:250px;padding:5px 7px;border-radius:5px;background:rgba(16,30,47,.78);border:1px solid rgba(74,127,168,.85)}
  .hov.noplate{background:transparent;border:0}
  .hov .gwrap{float:left;margin-right:9px}
  .hov .h1,.hov .h3{display:block;height:14px;line-height:14px;white-space:nowrap}
  .hov .h3{height:12px;line-height:12px;font-size:9.5px;color:#bcd0dd}
  .st{font-size:12.5px;color:#f2f7fa;font-weight:700}
  .tok{float:right;font:400 9px/14px ui-monospace,Consolas,monospace;color:#cfe0ea}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#56d9c8;margin-right:6px;vertical-align:1px}
  .warn{color:#ffc266}
  .ruler{position:relative;display:block;height:9px;margin:2px 0 1px;border-top:1px solid rgba(232,244,252,.85);border-bottom:1px solid rgba(232,244,252,.35)}
  .ruler i{position:absolute;top:0;width:1px;height:4px;background:rgba(232,244,252,.8)}
  .ruler i.long{height:9px}
  .bullet{position:relative;display:block;height:12px}
  .bq{position:absolute;left:0;top:3px;width:130px;height:6px;background:rgba(232,244,252,.22);border-radius:1px}
  .bs{position:absolute;top:3px;left:0;width:84px;height:6px;background:#56d9c8;border-radius:1px}
  .bt{position:absolute;top:0;left:130px;width:1px;height:12px;background:#ffc266}
  .bl{position:absolute;right:0;top:0;font:400 8.5px/12px ui-monospace,Consolas,monospace;color:#e6eef4}
  .panw{position:absolute;left:40px;top:280px}
  .panel{width:520px;padding:10px 13px 9px;border-radius:6px;background:rgba(16,30,47,.9);border:1px solid #4a7fa8}
  .ph{height:13px;line-height:13px}
  .kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
  .he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
  .prow{white-space:nowrap;margin-top:5px}
  .pcell{display:inline-block;width:33.3%;vertical-align:top;text-align:center}
  .pname{font-size:10px;color:#dbe6f2}
  .pnum{font:400 10px/13px ui-monospace,Consolas,monospace;color:#e8f0fa}
  .stt{display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#92aac0;margin-left:10px}
  .stt b{color:#56d9c8}
  .cap{padding:16px 22px 22px;background:#111823;color:#e4ecf4}
  .cap h3{margin:0 0 8px;font-size:16px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.78;color:#a9bccd}
  .cap .k{display:inline-block;width:104px;color:#7e94ac}
  .cap b{color:#e4ecf4}
  .cap table{border-collapse:collapse;margin-top:6px;font:400 11px/1.6 ui-monospace,Consolas,monospace;color:#a9bccd}
  .cap td,.cap th{border:1px solid #26313d;padding:3px 9px;text-align:left}
  .idx a{display:block;padding:9px 12px;margin:6px 0;background:#161f2b;border-left:3px solid #4a7fa8;border-radius:0 4px 4px 0;color:#cfe0ea;text-decoration:none;font-size:13px}
  .idx a:hover{border-left-color:#56d9c8;background:#1b2634}
  .idx a span{color:#8fa8bd;font-size:11px;margin-left:8px}
`
function iconBlock (id, s = 140) {
  const rnd = makeRnd(31337)
  let g = ''
  for (let i = 0; i < 98; i++) { const th = rnd() * 6.283, r = 72 + 20 * Math.sqrt(rnd()), z = rnd(); g += `<circle cx="${(100 + Math.cos(th) * r).toFixed(1)}" cy="${(100 + Math.sin(th) * r * 0.94).toFixed(1)}" r="${(0.85 + z * 1.5).toFixed(2)}" fill="#56d9c8" opacity="${(0.26 + 0.74 * z).toFixed(2)}"/>` }
  return `<svg width="${s}" height="${s}" viewBox="0 0 200 200">
    <defs><radialGradient id="I${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#07121d" stop-opacity=".92"/><stop offset="78%" stop-color="#07121d" stop-opacity=".56"/><stop offset="100%" stop-color="#07121d" stop-opacity="0"/></radialGradient>
    <filter id="H${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
    <circle cx="100" cy="100" r="97" fill="url(#I${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#3f6f86" stroke-width="1" stroke-dasharray="1.5 7"/>
    <g>${g}</g><circle cx="100" cy="100" r="60" fill="none" stroke="#56d9c8" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="44" fill="#56d9c8" opacity=".18" filter="url(#H${id})"/>
    <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#56d9c8" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#56d9c8"/></svg>`
}
function page (key, sc) {
  const a = sc.render(140, 1), b = sc.render(88, 2), c = sc.render(46, 3)
  const extraCss = [a.css, b.css, c.css].join('\n')
  const side = (dk) => `<div class="side"><div class="desk" style="${DESKS[dk]}">
    <div class="iconw">${iconBlock(key + dk, 140)}</div>
    <div class="hovw"><div class="hov"><div class="gwrap" data-slot="hov">${c.html}</div>
      <span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k</span></span>
      <span class="ruler">${ticks}</span>
      <span class="bullet"><i class="bq"></i><i class="bs"></i><i class="bt"></i><b class="bl">已用 4/6</b></span>
      <span class="h3">子代理 <span class="warn">7/12</span></span></div></div>
    <div class="panw"><div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he" data-slot="pct">总 0%</span></div>
      <div class="prow">
        <div class="pcell"><span data-slot="p1">${a.html}</span><div class="pname">主代理</div><div class="pnum">计划 0/6</div></div>
        <div class="pcell"><span data-slot="p2">${b.html}</span><div class="pname">reviewer</div><div class="pnum">计划 0/12</div></div>
        <div class="pcell"><span data-slot="p3">${b.html}</span><div class="pname">tester</div><div class="pnum">计划 0/11</div></div>
      </div></div></div>
  </div></div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${sc.name}</title>
<style>${CSS}
${extraCss}
</style></head><body>
<div class="bar"><a href="./index.html">← 全部方案</a><span class="nm">${sc.name}</span>
  <button id="toggle">暂停</button>
  <button data-tier="eco">省电</button><button data-tier="standard" class="on">标准</button><button data-tier="smooth">流畅</button>
  <span class="stt">状态：<b id="st">推进中</b>　进度 <b id="pv">0%</b>　帧率 <b id="fv">10 fps</b></span></div>
<div class="row">${side('dark')}${side('light')}</div>
<div class="cap">
  <h3>${sc.name} <span class="ref">真动效 · 纯 transform/opacity</span></h3>
  <div><span class="k">与 H2 的关系</span>${sc.rel}</div>
  <div><span class="k">元素职责</span>环/主元素＝${sc.roles[0]}｜次元素＝${sc.roles[1]}｜完成态＝${sc.roles[2]}</div>
  <div><span class="k">三态</span><b>推进</b>＝主元素随进度点亮、运行体持续绕行（合成层）；<b>完成</b>＝同一元素换形态（补齐→转绿→对勾 / 闭合 / 尖峰）；<b>静止</b>＝核心 0.45~2.2s 呼吸（只改 opacity+scale）</div>
  <div><span class="k">三档</span>省电＝数值变化才动、随后完全静止（0 fps）｜标准＝10 fps 慢呼吸｜流畅＝30 fps 全动</div>
  <div><span class="k">CPU 实测</span>（本机 20 逻辑核，单核占比；口径＝同一实测台：H2 图标 + 无底板悬浮层 + 3 个面板图形，<b>非逐方案实测</b>）
    <table><tr><th>档位</th><th>IDLE 悬浮</th><th>面板展开</th><th>进度推进</th><th>完成瞬间</th></tr>
    <tr><td>省电</td><td>${CPUTAB.eco[0]}%</td><td>${CPUTAB.eco[1]}%</td><td>${CPUTAB.eco[2]}%</td><td>${CPUTAB.eco[3]}%</td></tr>
    <tr><td>标准</td><td>${CPUTAB.standard[0]}%</td><td>${CPUTAB.standard[1]}%</td><td>${CPUTAB.standard[2]}%</td><td>${CPUTAB.standard[3]}%</td></tr>
    <tr><td>流畅</td><td>${CPUTAB.smooth[0]}%</td><td>${CPUTAB.smooth[1]}%</td><td>${CPUTAB.smooth[2]}%</td><td>${CPUTAB.smooth[3]}%</td></tr></table>
    参照基线：完全静止 0.19% / 合成层 30fps 0.96%（峰值 1.40%）</div>
</div>
<script>
/* 自诊断：任何脚本错误都写进 DOM（无头 dump 也能看见），并记录定时器心跳次数 */
window.onerror = function (m, f, l) {
  try {
    var d = document.getElementById('jserr') || document.createElement('div')
    d.id = 'jserr'; d.textContent = 'ERR:' + m + '@' + l
    document.body.appendChild(d); document.title = 'ERR:' + m
  } catch (e) { /* ignore */ }
}
var TICKS = 0
var UPD = ${sc.upd.toString()}
/* helper：upd 里引用的模块级函数必须一并发射，否则页面里 ReferenceError */
${[ringSegUpdate, nebComplete, comboUpd].map(function (f) { return String(f) }).join("\n")}
var TIERS = ${JSON.stringify(TIERS)}
var tier = 'standard', playing = true, p = 0, state = 'advance', lastT = 0, lastR = 0
var slots = [].slice.call(document.querySelectorAll('[data-slot="p1"],[data-slot="p2"],[data-slot="p3"],[data-slot="hov"]'))
function slotsOf (el) { return el }
function render () {
  slots.forEach(function (el) { UPD(el, p, state) })
  document.getElementById('pv').textContent = Math.round(p * 100) + '%'
  document.getElementById('st').textContent = state === 'advance' ? '推进中' : state === 'complete' ? '完成（换形态）' : '静止'
  var pc = document.querySelector('[data-slot="pct"]'); if (pc) pc.textContent = '总 ' + Math.round(p * 100) + '%'
}
/* ⚠️ 推进循环**必须由定时器驱动**：rAF 在无头/虚拟时间/后台标签页里会被节流甚至完全不跑，
   而 setInterval 会被 --virtual-time-budget 推进 —— 这样"进度真的在推进"才能被机器验证。
   rAF 只用于让 CSS 动画在有头环境下不被节流，不承担状态推进。 */
var v2timer = null
function advance () {
  if (!playing) return
  TICKS++
  try { document.body.setAttribute('data-ticks', String(TICKS)) } catch (e) { /* ignore */ }
  var fps = TIERS[tier].fps
  if (fps === 0) {                       /* 省电档：事件驱动，约每 700ms 跳一格 */
    state = 'advance'; p = Math.min(1, p + 0.05); if (p >= 1) p = 0; render(); return
  }
  var now = Date.now()
  if (state === 'advance') { p += 0.012; if (p >= 1) { p = 1; state = 'complete'; lastR = now } }
  else if (state === 'complete') { if (now - lastR > 1200) { state = 'rest'; lastR = now } }
  else { if (now - lastR > 1600) { p = 0; state = 'advance'; lastR = now } }
  render()
}
function restartTimer () {
  if (v2timer) clearInterval(v2timer)
  var fps = TIERS[tier].fps
  v2timer = setInterval(advance, fps ? Math.max(33, Math.round(1000 / fps)) : 700)
}
function smoothLoop () { requestAnimationFrame(smoothLoop) }
document.getElementById('toggle').onclick = function () { playing = !playing; this.textContent = playing ? '暂停' : '播放'; document.body.classList.toggle('paused', !playing) }
;[].forEach.call(document.querySelectorAll('[data-tier]'), function (b) {
  b.onclick = function () {
    tier = b.dataset.tier
    ;[].forEach.call(document.querySelectorAll('[data-tier]'), function (x) { x.classList.toggle('on', x === b) })
    document.getElementById('fv').textContent = (TIERS[tier].fps || '事件驱动') + (TIERS[tier].fps ? ' fps' : '')
    document.body.classList.toggle('paused', !playing || TIERS[tier].fps === 0)
    restartTimer()
  }
})
render(); restartTimer(); requestAnimationFrame(smoothLoop)
</script></body></html>`
}
const names = Object.keys(SCHEMES)
for (const k of names) fs.writeFileSync(path.join(OUT, k + '.html'), page(k, SCHEMES[k]))
function group (title, keys, note) {
  return `<h3 style="margin:18px 0 6px;font-size:14px;color:#cfe0ea">${title}<span style="font-size:11px;color:#8fa8bd;margin-left:10px">${note}</span></h3>` +
    keys.map((k) => `<a href="./${k}.html">${SCHEMES[k].name}<span>${SCHEMES[k].tag}</span></a>`).join('')
}
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>进度方案 · 真动效总入口</title>
<style>${CSS}</style></head><body>
<div class="cap" style="padding-bottom:6px"><h3>进度方案总入口 <span class="ref">全部页面都是真动效（纯 transform/opacity，无逐帧重绘）</span></h3>
<div>点进任意方案看它<b>真的在动</b>：三态自动循环（推进 → 完成换形态 → 静止呼吸），可暂停、可切三档（省电/标准/流畅）。</div></div>
<div class="cap idx" style="padding-top:0">
${group('第一批（形状本身够特别）', ['orbital', 'nebula', 'crystal', 'radar'], '复用图标本体：环 / 核心粒子 / 生长 / 扫掠')}
${group('第二批（概念有血缘，但形状更普通）', ['field', 'grid', 'pulse', 'fractal'], '波纹 / 矩阵 / 波形 / 递归 —— 如实标注：形状本身不如第一批特别')}
${group('组合（ORBITAL + NEBULA + FRACTAL，4 版职责分工）', ['combo-A', 'combo-B', 'combo-C', 'combo-D'], '版 D 为推荐：环=进度 · 云=状态 · 分形=结构（职责正交）')}
</div></body></html>`)
console.log('written ' + names.length + ' live pages + index')
