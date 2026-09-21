#!/usr/bin/env node
/* build-progress-mocks2.mjs —— 第二批：**非线性形态**的进度方案 4 套 + 悬浮层去底板可读性对照页
 * 硬要求：① 悬浮层**没有底板**（浮在桌面上，靠暗色 halo 托字）② 明确放弃直线/带状形态
 *        ③ 每套同页给出「悬浮层紧凑版」与「面板完整版」两种尺寸 ④ 左深壁纸 / 右浅壁纸并排
 * 输出：docs/progress-mocks2/{orbital,nebula,crystal,radar,hover-legibility}.html
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
const icon = (id, s = 140) => `<svg width="${s}" height="${s}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="I${id}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#07121d" stop-opacity=".92"/><stop offset="78%" stop-color="#07121d" stop-opacity=".56"/><stop offset="100%" stop-color="#07121d" stop-opacity="0"/></radialGradient>
  <filter id="H${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <circle cx="100" cy="100" r="97" fill="url(#I${id})"/><circle cx="100" cy="100" r="94" fill="none" stroke="#3f6f86" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${parts(98, 72, 92, '#56d9c8', 90210 + 777 + 87 * 131)}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#56d9c8" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="#3f6f86" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="#56d9c8" opacity=".18" filter="url(#H${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#56d9c8" stroke-width="2.6" stroke-linejoin="round"/><circle cx="100" cy="100" r="12" fill="#56d9c8"/></svg>`

const C = { m: '#56d9c8', money: '#ffc266', metric: '#6fb6ff', violet: '#b79cff', dim: '#92aac0', ink: '#e8f0fa' }

/* ===================== 四套**非线性**进度形态 =====================
   每套给 glyph(size, p, seed)：紧凑版（悬浮层，无底板）与完整版（面板）共用同一个生成器，
   只是尺寸、元素数、标注不同 —— 这正是"同一套方案两种尺寸都成立"的验证。 */
const S = {
  /* ① 轨道环：进度 = 沿轨道运行的运行体 + 已填充弧 */
  orbital: {
    name: '① ORBITAL · 轨道环',
    from: '手法来源：H2 图标自带的环系 +《Ghost in the Shell》的环状数据列 +《Oblivion》球形 HUD',
    rel: '**最"本来就长在图标上"的一套**：图标里有 94 的虚线刻度环与 60 的分段环，本方案把这两条环直接当成进度轨道 —— 运行体就跑在图标已有的轨道半径上，视觉上像是图标自己在转',
    glyph: (size, p, seed, mini) => {
      const r = size / 2 - 4, c = 2 * Math.PI * r, a = -90 + 360 * p
      const rad = (a * Math.PI) / 180
      const rx = size / 2 + Math.cos(rad) * r, ry = size / 2 + Math.sin(rad) * r
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${C.dim}" stroke-opacity=".22" stroke-width="${mini ? 1 : 1.4}" stroke-dasharray="1.5 ${mini ? 4 : 5}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${C.m}" stroke-width="${mini ? 2.4 : 3}" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
        <circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="${mini ? 2.6 : 3.4}" fill="${C.ink}"/>
        <circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="${mini ? 5 : 7}" fill="none" stroke="${C.ink}" stroke-opacity=".35" stroke-width="1"/>
        ${mini ? '' : `<circle cx="${size / 2}" cy="${size / 2}" r="${r * 0.62}" fill="none" stroke="${C.metric}" stroke-opacity=".35" stroke-width="1" stroke-dasharray="${(c * 0.62 * 0.12).toFixed(1)} ${(c * 0.62).toFixed(1)}" transform="rotate(40 ${size / 2} ${size / 2})"/>`}
      </svg>`
    }
  },
  /* ② 星云场：进度 = 粒子云的半径收缩 + 核心密度 */
  nebula: {
    name: '② NEBULA · 星云场',
    from: '手法来源：H2 的等离粒子云（98 颗、亮度随景深）本身，把"云"直接当成进度载体',
    rel: '**它本来就是 H2 的核心材质**：图标中间那团云是"存在感"的来源，这里让云随进度**向内聚拢**（进度越大越紧、越亮），完成时一次外向爆散再回聚 —— 等于把图标的呼吸变成了进度',
    glyph: (size, p, seed, mini) => {
      const rnd = makeRnd(seed), n = mini ? 46 : 120, r0 = size / 2 * (0.94 - 0.52 * p), r1 = size / 2 * (1.0 - 0.34 * p)
      let s = ''
      for (let i = 0; i < n; i++) {
        const th = rnd() * 6.283, rr = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd()
        const x = size / 2 + Math.cos(th) * rr, y = size / 2 + Math.sin(th) * rr * 0.96
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + z * (mini ? 0.9 : 1.3)).toFixed(2)}" fill="${z > 0.55 ? C.m : C.dim}" opacity="${(0.18 + 0.62 * z).toFixed(2)}"/>`
      }
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}
        <circle cx="${size / 2}" cy="${size / 2}" r="${(2 + 5 * p).toFixed(1)}" fill="${C.ink}" opacity="${(0.35 + 0.5 * p).toFixed(2)}"/></svg>`
    }
  },
  /* ③ 结晶生长：进度 = 晶体从核心向外长出的刻面数 */
  crystal: {
    name: '③ CRYSTAL · 结晶生长',
    from: '手法来源：H2 核心的三角构成（path 三角 + 中心圆）+ 结晶/有机生长（《Annihilation》的晶体质感）',
    rel: '**从图标的核心"长"出来**：H2 中心那个三角形就是种子，进度 = 从种子向外长出的 6 个刻面（每面一格），完成 = 最后一格闭合、整块晶体亮一次 —— 几何上完全延续了"中心三角"的对称语言',
    glyph: (size, p, seed, mini) => {
      const cx = size / 2, R = size / 2 - 3, N = 6, lit = Math.round(p * N)
      let s = ''
      for (let i = 0; i < N; i++) {
        const a0 = -90 + (360 / N) * i + 4, a1 = -90 + (360 / N) * (i + 1) - 4
        const p0 = [cx + Math.cos(a0 * Math.PI / 180) * R, cx + Math.sin(a0 * Math.PI / 180) * R]
        const p1 = [cx + Math.cos(a1 * Math.PI / 180) * R, cx + Math.sin(a1 * Math.PI / 180) * R]
        const on = i < lit
        s += `<path d="M${cx} ${cx} L${p0[0].toFixed(1)} ${p0[1].toFixed(1)} L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Z" fill="${on ? C.m : C.dim}" fill-opacity="${on ? (mini ? 0.5 : 0.42) : 0.06}" stroke="${on ? C.m : C.dim}" stroke-opacity="${on ? 0.95 : 0.3}" stroke-width="${mini ? 0.9 : 1.2}"/>`
      }
      s += `<circle cx="${cx}" cy="${cx}" r="${(mini ? 2.4 : 3.4) + 1.6 * p}" fill="${C.ink}"/>`
      if (!mini) s += `<path d="M${cx} ${cx - R} L${cx + R * 0.86} ${cx + R * 0.5} L${cx - R * 0.86} ${cx + R * 0.5} Z" fill="none" stroke="${C.violet}" stroke-opacity=".5" stroke-width="1"/>`
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}</svg>`
    }
  },
  /* ④ 极坐标雷达：进度 = 扫描扇区的覆盖角 */
  radar: {
    name: '④ RADAR · 极坐标扇区',
    from: '手法来源：H2 的刻度环（94 的虚线刻度）+ 军用雷达 PPI 显示',
    rel: '**把图标的刻度环当成雷达表盘**：图标最外那圈刻度本来就是"表盘"的形状，本方案让扫描扇区在它上面推进（进度 = 覆盖角），完成 = 一次全周扫 + 一个回波亮点 —— 是"刻度环"最自然的升华',
    glyph: (size, p, seed, mini) => {
      const cx = size / 2, R = size / 2 - 3, N = mini ? 24 : 48
      let s = ''
      for (let i = 0; i < N; i++) s += `<line x1="${cx}" y1="0" x2="${cx}" y2="3" stroke="${C.dim}" stroke-opacity=".35" stroke-width="1.4" transform="rotate(${(360 / N) * i} ${cx} ${cx})"/>`
      const a = 360 * p
      const large = a > 180 ? 1 : 0, rad = ((a - 90) * Math.PI) / 180
      const x2 = cx + Math.cos(rad) * (R - 5), y2 = cx + Math.sin(rad) * (R - 5)
      s += `<path d="M${cx} ${cx} L${cx} ${cx - (R - 5)} A${R - 5} ${R - 5} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${C.m}" fill-opacity="${mini ? 0.3 : 0.26}" stroke="${C.m}" stroke-opacity=".55" stroke-width="1"/>`
      s += `<line x1="${cx}" y1="${cx}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${C.ink}" stroke-width="${mini ? 1.2 : 1.6}" opacity=".9"/>`
      s += `<circle cx="${cx}" cy="${cx}" r="${mini ? 1.8 : 2.4}" fill="${C.ink}"/>`
      if (!mini) {
        s += `<circle cx="${cx}" cy="${cx}" r="${(R - 5) * 0.55}" fill="none" stroke="${C.metric}" stroke-opacity=".45" stroke-width="1"/>`
        const bl = ((a * 1.6 + 40) % 360 - 90) * Math.PI / 180
        s += `<circle cx="${(cx + Math.cos(bl) * (R - 14)).toFixed(1)}" cy="${(cx + Math.sin(bl) * (R - 14)).toFixed(1)}" r="2.2" fill="${C.money}"/>`
      }
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}</svg>`
    }
  }
}

const CONVS = [
  { t: '主代理 · 3a91f2', p: 0.67, num: '计划 4/6', note: '' },
  { t: '子代理 · 检索参考图', p: 0.42, num: '计划 5/12', note: '▲ 计划已更新 6→11' },
  { t: '子代理 · 跑离屏回归', p: 0.28, num: '计划 3/11', note: '▲ 计划已更新 12→11' }
]
const HOV_P = 0.55

/* ---------- 悬浮层（**无底板**，靠暗色 halo 托字） ---------- */
function hoverLayer (k, seed) {
  const big = S[k].glyph(46, HOV_P, seed, true)
  let ticks = ''
  for (let i = 0; i < 26; i++) ticks += `<i class="${i % 5 === 0 ? 'long' : ''}" style="left:${i * 6}px"></i>`
  return `<div class="hover hov-${k}">
    <div class="hrow"><span class="g">${big}</span>
      <span class="hcol">
        <span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k tok</span></span>
        <span class="ruler">${ticks}</span>
        <span class="bullet"><i class="bq"></i><i class="bs"></i><i class="bt"></i><b class="bl">已用 4/6 · 预算 8 · 上限 12</b></span>
        <span class="h3">主 + 2 子　子代理 2 <span class="warn">▲ 计划已更新 6→11</span></span>
      </span>
    </div>
    <div class="hfin">完成态（同一元素换形态）：${k === 'orbital' ? '轨道补齐 → 转绿 → 变成对勾' : k === 'nebula' ? '云收成一枚实心环 → 转绿' : k === 'crystal' ? '最后一格闭合 → 实心晶体' : '全周扫满 → 静止环 + 对勾'}</div>
  </div>`
}
/* ---------- 面板完整版（440 宽、深蓝底板） ---------- */
function panelLayer (k, seed) {
  const S1 = S[k]
  const glyphs = CONVS.map((c, i) => `<div class="pcell">${S1.glyph(88, c.p, seed + i * 13, false)}
      <div class="pname">${c.t}</div><div class="pnum">${c.num}</div>
      <div class="pnote">${c.note || '<span class="live">执行中</span>'}</div></div>`).join('')
  return `<div class="panel pnl-${k}">
    <div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总 4/6 · 主 + 2 子</span></div>
    <div class="prow">${glyphs}</div>
    <div class="pfoot">每个对话一个 ${S1.name.split(' · ')[1]}；主显示用数字，形状只做辅助</div>
  </div>`
}

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,'Microsoft YaHei',sans-serif;background:#0d1117;width:1180px}
  .side{display:inline-block;vertical-align:top}
  .desk{position:relative;width:570px;height:600px;overflow:hidden}
  .iconw{position:absolute;left:215px;top:22px;width:140px;height:140px}
  /* ===== 悬浮层：**没有底板**；靠暗色 halo 把字从任意壁纸里"托"起来（不是发光）===== */
  .hover{position:absolute;left:150px;top:170px;width:270px;padding:4px 6px}
  .hover .g{float:left;margin-right:9px}
  .hover .hcol{display:block;overflow:hidden}
  .hover .h1,.hover .h2,.hover .h3{display:block;height:14px;line-height:14px;white-space:nowrap}
  .hover .h3{height:12px;line-height:12px;font-size:9.5px}
  .st{font-size:12.5px;color:#f2f7fa;font-weight:700;
    text-shadow:0 0 3px rgba(2,6,12,.95),0 1px 2px rgba(2,6,12,.98),0 0 8px rgba(2,6,12,.75)}
  .num{font:400 11px/1 ui-monospace,Consolas,monospace;color:#eaf6f4;
    text-shadow:0 0 3px rgba(2,6,12,.95),0 1px 2px rgba(2,6,12,.98),0 0 8px rgba(2,6,12,.75)}
  .h2{font-size:9.5px;color:#cfe0ea;text-shadow:0 0 3px rgba(2,6,12,.95),0 1px 2px rgba(2,6,12,.98),0 0 8px rgba(2,6,12,.75)}
  .h3{color:#bcd0dd;text-shadow:0 0 3px rgba(2,6,12,.95),0 1px 2px rgba(2,6,12,.98)}
  .tok{font:400 9px/1 ui-monospace,Consolas,monospace;color:#a9c0d0}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#56d9c8;margin-right:6px;vertical-align:1px;
    box-shadow:0 0 0 2px rgba(2,6,12,.7)}
  .warn{color:#ffc266}
  .hover svg{filter:drop-shadow(0 1px 3px rgba(2,6,12,.95))}
  /* C-130J HUD 手法：1px 描边刻度带（自证可读，不靠暗雾） */
  .ruler{position:relative;display:block;height:9px;margin:2px 0 1px;border-top:1px solid rgba(232,244,252,.85);
    border-bottom:1px solid rgba(232,244,252,.35)}
  .ruler i{position:absolute;top:0;width:1px;height:4px;background:rgba(232,244,252,.8)}
  .ruler i.long{height:9px}
  /* 子弹图语义：定性区间底 + 实际值 + 目标竖线 = 已用 / 预算 / 上限 */
  .bullet{position:relative;display:block;height:12px}
  .bq{position:absolute;left:0;top:3px;width:150px;height:6px;background:rgba(232,244,252,.22);border-radius:1px}
  .bs{position:absolute;top:3px;left:0;width:96px;height:6px;background:#56d9c8;border-radius:1px}
  .bt{position:absolute;top:0;left:150px;width:1px;height:12px;background:#ffc266}
  .bl{position:absolute;right:0;top:0;font:400 8.5px/12px ui-monospace,Consolas,monospace;color:#e6eef4;
    text-shadow:0 0 2px rgba(2,6,12,.9)}
  .hfin{display:block;margin-top:3px;font-size:8.5px;line-height:11px;color:#ffc266;
    text-shadow:0 0 2px rgba(2,6,12,.9)}
  /* ===== 面板（仍保留深蓝底板）===== */
  .panel{position:absolute;left:55px;top:288px;width:460px;padding:11px 13px 10px;border-radius:6px;
    background:rgba(16,30,47,.88);border:1px solid #4a7fa8;box-shadow:0 18px 40px rgba(3,8,16,.5)}
  .ph{height:13px;line-height:13px}
  .kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
  .he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
  .prow{margin-top:8px;white-space:nowrap}
  .pcell{display:inline-block;width:33.3%;text-align:center;vertical-align:top}
  .pname{font-size:10px;color:#dbe6f2;margin-top:3px}
  .pnum{font:400 11px/14px ui-monospace,Consolas,monospace;color:#e8f0fa}
  .pnote{height:12px;font-size:8.5px;color:#92aac0}
  .live{color:#56d9c8}
  .pfoot{margin-top:7px;padding-top:6px;border-top:1px solid rgba(157,196,230,.16);font-size:8.5px;color:#7e94ac}
  .cap{width:1180px;padding:16px 22px 20px;background:#111823;color:#e4ecf4}
  .cap h3{margin:0 0 8px;font-size:16px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.78;color:#a9bccd}
  .cap .k{display:inline-block;width:96px;color:#7e94ac}
  .cap b{color:#e4ecf4}
`
const DESKS = {
  dark: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`,
  light: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`,
  blue: `background:radial-gradient(120% 90% at 30% 10%,rgba(120,190,255,.30),rgba(120,190,255,0) 62%),linear-gradient(160deg,#2a5580,#1d3c5e 45%,#132a44)`
}
function side (k, dk, seed) {
  return `<div class="side"><div class="desk" style="${DESKS[dk]}">
    <div class="iconw">${icon(k + dk, 140)}</div>
    ${hoverLayer(k, seed)}${panelLayer(k, seed)}
  </div></div>`
}
const TIERS = {
  orbital: ['段弧一次填充后停（运行体不动）', '运行体 0.25Hz 极慢绕行（transform-only）', '运行体持续绕行 1.2Hz + 完成时轨道闪与扩散'],
  nebula: ['云一次性收缩到位后**完全静止**', '云 0.2Hz 极慢内聚呼吸（只改半径缩放）', '云持续流动 + 完成时向外爆散再回聚'],
  crystal: ['刻面一次点亮后静止', '中心一枚 0.5Hz 呼吸点', '刻面逐个生长动画 + 完成时结晶闭合闪光'],
  radar: ['扇区一次覆盖后停（无扫掠）', '扫描线 0.35Hz 慢速往复', '扫描线 0.9Hz 常转 + 完成时全周扫 + 回波亮点']
}
for (const [k, s] of Object.entries(S)) {
  fs.writeFileSync(path.join(OUT, k + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${s.name}</title>
<style>${CSS}</style></head><body>
<div class="side" style="display:block;white-space:nowrap">${side(k, 'dark', 101)}${side(k, 'light', 202)}</div>
<div class="cap">
  <h3>${s.name} <span class="ref">非线性形态 · 悬浮层无底板 · 只出设计稿</span></h3>
  <div><span class="k">手法来源</span>${s.from}</div>
  <div><span class="k">与 H2 的关系</span>${s.rel}</div>
  <div><span class="k">悬浮层版</span>紧凑 46px 图形 + 3 行文字（状态/总进度+进程数/倒退说明），**无底板**，元素 ≈ 46 粒子或 6~48 刻线 + 8 段文字</div>
  <div><span class="k">面板版</span>440 宽深蓝底板，**每个对话一个 88px 图形**（3 个并排）+ 数字标签，元素 ≈ 3×（48~120 个图形元素）</div>
  <div><span class="k">推进时</span>${k === 'orbital' ? '运行体沿轨道前进 + 已走过弧长增长' : k === 'nebula' ? '云向内聚拢（半径收缩、核心变亮）' : k === 'crystal' ? '刻面从核心向外逐面长出' : '扫描扇区覆盖角增大'}</div>
  <div><span class="k">完成时</span>${k === 'orbital' ? '轨道闪一次 + 运行体外扩 6px 回弹（一次性 320ms）' : k === 'nebula' ? '向外爆散再回聚（420ms）' : k === 'crystal' ? '最后一格闭合、整块晶体亮一次（380ms）' : '全周扫一遍 + 一个回波亮点（360ms）'}</div>
  <div><span class="k">静止时</span>${k === 'orbital' ? '运行体停在原处，仅一枚 0.35Hz 呼吸点' : k === 'nebula' ? '粒子极慢漂移（0.2Hz、1.5px）' : k === 'crystal' ? '中心一枚 0.5Hz 呼吸点' : '扫描线 0.35Hz 慢速往复'}</div>
  <div><span class="k">三档剖面</span>省电＝${TIERS[k][0]}　标准＝${TIERS[k][1]}　流畅＝${TIERS[k][2]}</div>
  <div><span class="k">参考表对齐</span>完成态一律用<b>同一元素换形态</b>（补齐→转绿→对勾），不做额外庆祝动画；悬浮层主手法=<b>C-130J HUD 的单色+描边+刻度带</b>（不是靠暗雾托字）；总进度条=**子弹图语义**（区间底/实际值/上限竖线）；持续动效只走<b>合成层</b>（transform/opacity/background-position）</div>\n  <div><span class="k">配色 6</span>青 #56d9c8 · 冷白 #e8f0fa · 次级 #92aac0 · 淡蓝 #6fb6ff · 紫 #b79cff · 琥珀 #ffc266（+ 面板深蓝底）｜**文字一律不发光**，悬浮层只加**暗色 halo**</div>
  <div><span class="k">左 / 右</span>左＝深色壁纸　右＝浅色壁纸（同一套方案两种尺寸，用于核对"任意壁纸可读"）</div>
</div></body></html>`)
  console.log('written ' + k + ' — ' + s.name)
}

/* ---------- 悬浮层去底板：可读性对照页（3 壁纸 × 2 补偿） ---------- */
const COMP = {
  halo: { n: 'A · 仅暗色 halo（无任何暗雾）', css: '' },
  halo_scrim: { n: 'B · 暗色 halo + 极淡暗雾（rgba(6,12,20,.34)）', css: 'background:rgba(6,12,20,.34);border-radius:4px' },
  stroke: { n: 'C · HUD 描边字（深描边 + 亮芯，零底板零暗雾）', css: '', cls: 'clsStroke' }
}
let cells = ''
for (const [dk, dcss] of Object.entries(DESKS)) {
  for (const [ck, c] of Object.entries(COMP)) {
    cells += `<div class="cell" style="${dcss}"><div class="cl">${dk} 壁纸 · ${c.n}</div>
      <div class="hoverBox ${c.cls || ''}" style="${c.css}">${hoverLayer('orbital', 101)}</div></div>`
  }
}
fs.writeFileSync(path.join(OUT, 'hover-legibility.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>悬浮层去底板 · 可读性对照</title>
<style>${CSS}
  body{width:1180px}
  .grid{width:1180px}
  .cell{position:relative;width:590px;height:150px;display:inline-block;vertical-align:top}
  .cl{position:absolute;left:10px;top:8px;font:400 10px/1 ui-monospace,Consolas,monospace;color:#cfd8e2;opacity:.9}
  .hoverBox{position:absolute;left:24px;top:36px;width:290px;padding:4px 6px}
  .hoverBox .hover{position:static;left:auto;top:auto;width:100%}
  /* C 组：HUD 描边字 —— 用深色描边把亮芯"框"出来（地图标注 / 军用 HUD 的老办法），不依赖任何底板 */
  .clsStroke .st,.clsStroke .num,.clsStroke .h2,.clsStroke .h3,.clsStroke .bl,.clsStroke .tok{
    -webkit-text-stroke:2.6px rgba(3,8,16,.94);paint-order:stroke fill;text-shadow:none}
</style></head><body>
<div class="grid">${cells}</div>
<div class="cap">
  <h3>悬浮层去底板 —— 可读性对照 <span class="ref">3 壁纸 × 2 种补偿</span></h3>
  <div><span class="k">方案 A</span>只加**暗色 halo**（三层暗投影把字从背景里托起来）—— 不引入任何底板</div>
  <div><span class="k">方案 B</span>暗色 halo + 极淡暗雾 rgba(6,12,20,.34) —— 仍能看见壁纸，但字更稳</div>
  <div><span class="k">注意</span><b>发光仍是红线</b>：这里用的是**暗色**投影（把背景压暗），不是彩色/白色发光</div>
  <div><span class="k">实测</span>对比度数字见本轮报告（每种组合的主文/次级/说明三档）</div>
</div></body></html>`)
console.log('written hover-legibility')
