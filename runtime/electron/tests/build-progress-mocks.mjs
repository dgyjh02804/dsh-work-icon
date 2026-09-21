#!/usr/bin/env node
/* build-progress-mocks.mjs —— 进度条美术方向 4 套（设计稿，不进生产代码）
 * H2 语言取材：分段环 seg / 等离粒子云 / Spinner 刻度尺 / 环+辉光
 * 每页含：深色壁纸 + 浅色壁纸并排；各自展示
 *   ① 悬浮层（轻量）：状态 + token + **一条总进度条** + 进程数（主 + 子）
 *   ② 完整面板：**多条进度条（每个对话一条）**，含"计划已更新 6→11"这类倒退说明
 */
import fs from 'node:fs'
import path from 'node:path'
const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ---------- 图标（H2 等离云核，与生产同几何） ---------- */
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

const C = { m: '#56d9c8', money: '#ffc266', metric: '#6fb6ff', task: '#b79cff', dim: '#92aac0', ink: '#e8f0fa' }

/* ================= 四套进度条 ================= */
const SCHEMES = {
  /* A · 分段刻度环：直接借 H2 的 seg 分段环 */
  A: {
    name: 'A · 分段刻度环',
    from: '手法来源：H2 本体的 `.seg` 分段环（r=60 的 40-16-8-16 虚线弧）+ Razorback 的分段刻度',
    anim: { move: '已过段逐个点亮（青）；当前段一道 1.1Hz 扫掠高光缓慢跑过（只改一个 rect 的 x）', done: '整环闪一次 + 向外 6px 扩散环（一次性 320ms），该段转为实心亮青', rest: '仅"当前段"一枚呼吸点（0.35Hz，只改一个 circle 的 opacity）' },
    fps: { act: 30, rest: 4 },
    tiers: { eco: '段落一次性点亮后**完全静止**（无呼吸点、无扫掠）', std: '当前段一枚 0.35Hz 呼吸点（只改 1 个 circle 的 opacity）', smooth: '当前段扫掠高光 1.1Hz 常跑 + 完成时整环闪光与扩散环' },
    bar: (w, h, p, id) => {
      const N = 12, seg = (w - (N - 1) * 3) / N, lit = Math.round(p * N), s = []
      for (let i = 0; i < N; i++) {
        const on = i < lit
        s.push(`<rect x="${(i * (seg + 3)).toFixed(1)}" y="0" width="${seg.toFixed(1)}" height="${h}" rx="1.5" fill="${on ? C.m : '#9dc4e6'}" opacity="${on ? 1 : 0.16}"/>`)
      }
      const cx = lit * (seg + 3) - 1.5
      if (lit < N) s.push(`<rect x="${cx.toFixed(1)}" y="-1" width="4" height="${h + 2}" rx="2" fill="#fff" opacity=".85"/>`)
      return `<svg width="${w}" height="${h + 2}" viewBox="0 -1 ${w} ${h + 2}">${s.join('')}</svg>`
    },
    ring: (p, size) => {
      const r = size / 2 - 4, c = 2 * Math.PI * r, N = 12, seg = c / N
      let s = ''
      for (let i = 0; i < N; i++) {
        const on = i / N < p
        s += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${on ? C.m : '#9dc4e6'}" stroke-opacity="${on ? 1 : 0.18}" stroke-width="3" stroke-linecap="butt" stroke-dasharray="${(seg * 0.68).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-seg * i + c / 4).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`
      }
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}</svg>`
    }
  },
  /* B · 粒子流：借 H2 的等离粒子云 */
  B: {
    name: 'B · 粒子流进度带',
    from: '手法来源：H2 的等离粒子云（98 颗、球面投影、亮度随景深）+ 《Arrival》的流动感',
    anim: { move: '粒子沿轨道右流，前 20% 聚成更密的"头部"；进度越大头部越靠右（每帧只改整组的 transform）', done: '头部粒子一次性爆开（12 颗向外 10px 再消散，420ms）+ 尾迹提亮一次', rest: '粒子云极慢漂移（0.2Hz、位移 1.5px，只改一个 transform）' },
    fps: { act: 30, rest: 10 },
    tiers: { eco: '粒子**静成一串静态点**（保留形状，不漂移）', std: '粒子 0.2Hz 极慢漂移（位移 1.5px，只改 1 个 transform）', smooth: '粒子持续右流 + 头部聚集 + 完成时爆开' },
    bar: (w, h, p, id) => {
      const rnd = makeRnd(4242 + (id || 0).toString().length), dots = []
      const head = 0.12 + 0.78 * p
      for (let i = 0; i < 42; i++) {
        const t = i / 41
        const spread = t < head ? 0.9 : 0.25
        const x = (t * (w - 6) + 3 + (rnd() - 0.5) * 3).toFixed(1)
        const y = (h / 2 + (rnd() - 0.5) * h * spread).toFixed(1)
        const near = Math.max(0, 1 - Math.abs(t - head) * 9)
        const r = (0.7 + rnd() * 0.8 + near * 1.3).toFixed(2)
        const op = (0.16 + 0.5 * t * (t < head ? 1 : 0.35) + near * 0.5).toFixed(2)
        dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${t < head ? C.m : C.dim}" opacity="${op}"/>`)
      }
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${dots.join('')}</svg>`
    },
    ring: (p, size) => {
      const r = size / 2 - 5, rnd = makeRnd(777), d = []
      for (let i = 0; i < 26; i++) {
        const t = i / 25, a = -Math.PI / 2 + t * 6.283 * 0.999
        const on = t < p, near = Math.max(0, 1 - Math.abs(t - p) * 8)
        const rr = (0.8 + rnd() * 1.1 + near * 1.2).toFixed(2)
        d.push(`<circle cx="${(size / 2 + Math.cos(a) * r).toFixed(1)}" cy="${(size / 2 + Math.sin(a) * r).toFixed(1)}" r="${rr}" fill="${on ? C.m : C.dim}" opacity="${(0.2 + (on ? 0.7 : 0.1) + near * 0.4).toFixed(2)}"/>`)
      }
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${d.join('')}</svg>`
    }
  },
  /* C · 双刻度尺 + 游标：借 Blade Runner 2049 Spinner 的刻度尺手法 */
  C: {
    name: 'C · 刻度尺 + 游标',
    from: '手法来源：Blade Runner 2049 Spinner HUD 的 1px 刻度尺（用户在参考里挑中的手法）+ Interstellar 的实体仪表',
    anim: { move: '游标**逐格跳**右移（离散、有咔哒感，只改一个 rect 的 x），已过刻度点亮', done: '游标处一次横向脉冲 + 整尺闪白一次（一次性 240ms）', rest: '游标处一枚 0.5Hz 的细呼吸刻度（只改 opacity）' },
    fps: { act: 15, rest: 4 },
    tiers: { eco: '游标**跳格后静止**，无呼吸', std: '游标处 0.5Hz 细呼吸刻度（只改 opacity）', smooth: '游标连续右移 + 刻度波动 + 完成时横向脉冲与整尺闪白' },
    bar: (w, h, p, id) => {
      const N = 30, s = []
      for (let i = 0; i < N; i++) {
        const on = i / N < p, big = i % 5 === 0
        const x = (i * (w / N)).toFixed(1)
        s.push(`<rect x="${x}" y="${big ? 0 : (h - 4) / 2}" width="1.6" height="${big ? h : 4}" fill="${on ? C.m : '#9dc4e6'}" opacity="${on ? 0.95 : 0.28}"/>`)
      }
      const cx = (Math.round(p * N) * (w / N) - 3).toFixed(1)
      s.push(`<rect x="${cx}" y="-2" width="3" height="${h + 4}" rx="1.5" fill="#ffc266"/>`)
      return `<svg width="${w}" height="${h + 4}" viewBox="0 -2 ${w} ${h + 4}">${s.join('')}</svg>`
    },
    ring: (p, size) => {
      const r = size / 2 - 4, rr = []
      for (let i = 0; i < 36; i++) {
        const a = -Math.PI / 2 + (i / 36) * 6.283, on = i / 36 < p, big = i % 3 === 0
        const len = big ? 5 : 3.2
        rr.push(`<line x1="${(size / 2 + Math.cos(a) * r).toFixed(1)}" y1="${(size / 2 + Math.sin(a) * r).toFixed(1)}" x2="${(size / 2 + Math.cos(a) * (r - len)).toFixed(1)}" y2="${(size / 2 + Math.sin(a) * (r - len)).toFixed(1)}" stroke="${on ? C.m : '#9dc4e6'}" stroke-opacity="${on ? 0.95 : 0.3}" stroke-width="1.6"/>`)
      }
      const a = -Math.PI / 2 + p * 6.283
      rr.push(`<circle cx="${(size / 2 + Math.cos(a) * (r - 2)).toFixed(1)}" cy="${(size / 2 + Math.sin(a) * (r - 2)).toFixed(1)}" r="2.6" fill="#ffc266"/>`)
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rr.join('')}</svg>`
    }
  },
  /* D · 双弧环：借 H2 的 ring + 克制的辉光 */
  D: {
    name: 'D · 双弧环',
    from: '手法来源：H2 的环系（分段环 + 内环）+ 《Oblivion》的极简球形 HUD',
    anim: { move: '外弧连续增长（青，带 4px 柔光头），内弧以 0.8Hz 反向缓慢扫描（两根弧）', done: '外弧闭合瞬间一次环形闪光 + 半径外扩 4px 回弹（一次性 380ms）', rest: '内弧保持缓慢旋转（15fps，transform-only 走合成层）——"一直在动"的主要来源' },
    fps: { act: 30, rest: 15 },
    tiers: { eco: '外弧增长后静止，**内弧不转**', std: '内弧缓慢旋转（15fps，transform-only 走合成层）', smooth: '内外双弧常转 + 完成时环形闪光 + 半径外扩回弹' },
    bar: (w, h, p, id) => {
      const inner = Math.max(0, p * w - 6)
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect x="0" y="${(h - 3) / 2}" width="${w}" height="3" rx="1.5" fill="#9dc4e6" opacity=".16"/>
        <rect x="0" y="${(h - 3) / 2}" width="${(p * w).toFixed(1)}" height="3" rx="1.5" fill="${C.m}"/>
        <rect x="${Math.max(0, p * w - inner).toFixed(1)}" y="${(h - 5) / 2}" width="${inner.toFixed(1)}" height="5" rx="2.5" fill="${C.ink}" opacity=".55"/>
        <circle cx="${(p * w).toFixed(1)}" cy="${h / 2}" r="2.6" fill="${C.ink}"/></svg>`
    },
    ring: (p, size) => {
      const r = size / 2 - 5, c = 2 * Math.PI * r
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#9dc4e6" stroke-opacity=".18" stroke-width="3"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${C.m}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r - 5}" fill="none" stroke="${C.metric}" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="${(c * 0.16).toFixed(1)} ${c.toFixed(1)}" transform="rotate(120 ${size / 2} ${size / 2})"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="2" fill="${C.ink}"/></svg>`
    }
  }
}

/* ================= 内容 ================= */
const CONVS = [
  { t: '主代理 · 会话 3a91f2', p: 0.67, num: '计划 4/6', note: '', live: true },
  { t: '子代理 · 检索参考图', p: 0.42, num: '计划 5/12', note: '计划已更新 6→11', live: true },
  { t: '子代理 · 跑离屏回归', p: 0.28, num: '计划 3/11', note: '计划已更新 12→11', live: false }
]

function side (scheme, dark, id) {
  const S = SCHEMES[scheme]
  const desk = dark
    ? `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)`
    : `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)`
  /* 悬浮层：状态 + token + 总进度条 + 进程数 */
  const hover = `
  <div class="hover">
    <div class="hrow1"><span class="dot"></span><span class="st">执行中 · Bash</span><span class="tok">128.4k tok</span></div>
    <div class="hrow2">${S.bar(196, 8, 0.67, 1)}<span class="pc">主 + 2 子</span></div>
    <div class="hrow3">总进度 <b>4/6 计划 · 12 项子任务</b>　<span class="warn">子代理 2 已更新计划 6→11</span></div>
  </div>`
  /* 完整面板：多条进度条 */
  const panel = `
  <div class="panel">
    <div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he">总进度 4/6 · 主 + 2 子</span></div>
    <div class="ptot">${S.bar(396, 7, 0.46, 2)}</div>
    ${CONVS.map((c, i) => `
      <div class="conv">
        <div class="crow"><span class="ct">${c.t}</span><span class="cn">${c.num}</span></div>
        ${S.bar(300, 6, c.p, i + 3)}
        <div class="cnote">${c.note ? '<span class="warn">▲ ' + c.note + '</span>' : (c.live ? '<span class="live">执行中</span>' : '<span class="idle">等待</span>')}</div>
      </div>`).join('')}
  </div>`
  return `<div class="side"><div class="desk" style="${desk}">
    <div class="iconw">${icon(id, 140)}</div>
    ${hover}${panel}
  </div></div>`
}

const CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:system-ui,'Microsoft YaHei',sans-serif;background:#0d1117;width:1120px}
  .row{display:block}
  .side{display:inline-block;vertical-align:top}
  .desk{position:relative;width:540px;height:560px;overflow:hidden}
  .iconw{position:absolute;left:200px;top:26px;width:140px;height:140px}
  /* 悬浮层（轻量）：状态 + token + 总进度条 + 进程数 */
  .hover{position:absolute;left:130px;top:174px;width:280px;padding:9px 12px 8px;border-radius:6px;
    background:rgba(16,30,47,.90);border:1px solid #4a7fa8;box-shadow:0 12px 28px rgba(3,8,16,.5)}
  .hrow1{height:14px;line-height:14px;white-space:nowrap;overflow:hidden}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#56d9c8;margin-right:6px;vertical-align:1px}
  .st{font-size:12px;color:#e8f0fa;font-weight:600}
  .tok{float:right;font:400 9.5px/14px ui-monospace,Consolas,monospace;color:#92aac0}
  .hrow2{height:14px;line-height:14px;margin-top:3px}
  .hrow2 svg{vertical-align:-1px}
  .pc{font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0;margin-left:8px}
  .hrow3{height:12px;line-height:12px;font-size:9px;color:#a8c4dc;white-space:nowrap;overflow:hidden}
  .hrow3 b{color:#e8f0fa}
  .warn{color:#ffc266}
  /* 完整面板 */
  .panel{position:absolute;left:60px;top:250px;width:420px;padding:11px 13px 10px;border-radius:6px;
    background:rgba(16,30,47,.86);border:1px solid #4a7fa8;box-shadow:0 18px 40px rgba(3,8,16,.5)}
  .ph{height:13px;line-height:13px}
  .kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
  .he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
  .ptot{margin:5px 0 7px}
  .conv{margin-top:6px;padding-left:8px;border-left:2px solid #2f4a63}
  .crow{height:14px;line-height:14px}
  .ct{font-size:10.5px;color:#dbe6f2}
  .cn{float:right;font:400 10px/14px ui-monospace,Consolas,monospace;color:#e8f0fa}
  .conv>svg{display:block;margin:2px 0 1px}
  .cnote{height:12px;line-height:12px;font-size:8.5px}
  .live{color:#56d9c8}.idle{color:#7e94ac}
  .cap{width:1120px;padding:16px 22px 20px;background:#111823;color:#e4ecf4}
  .cap h3{margin:0 0 8px;font-size:16px}
  .cap h3 .ref{font-size:9.5px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.75;color:#a9bccd}
  .cap .k{display:inline-block;width:88px;color:#7e94ac}
  .cap b{color:#e4ecf4}
`

for (const [k, S] of Object.entries(SCHEMES)) {
  fs.writeFileSync(path.join(OUT, `${k}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${S.name}</title>
<style>${CSS}</style></head><body>
<div class="row">${side(k, true, k + 'd')}${side(k, false, k + 'l')}</div>
<div class="cap">
  <h3>${S.name} <span class="ref">H2 同语言 · 只出设计稿</span></h3>
  <div><span class="k">手法来源</span>${S.from}</div>
  <div><span class="k">推进时</span>${S.anim.move}</div>
  <div><span class="k">完成时</span>${S.anim.done}</div>
  <div><span class="k">静止时</span>${S.anim.rest}</div>
  <div><span class="k">帧率预算</span>活跃 <b>${S.fps.act} fps</b> · 静止 <b>${S.fps.rest} fps</b>（只改单属性/单元素；CPU 实测见报告）</div>
  <div><span class="k">省电档</span>${S.tiers.eco}</div>
  <div><span class="k">标准档</span>${S.tiers.std}</div>
  <div><span class="k">流畅档</span>${S.tiers.smooth}</div>
  <div><span class="k">倒退说明</span>条右侧固定位置写明原因（如 <b class="warn" style="color:#ffc266">▲ 计划已更新 6→11</b>）；主显示用具体数字（<b>计划 4/6</b>），条只做辅助</div>
  <div><span class="k">两侧壁纸</span>左=深色壁纸　右=浅色壁纸（同一个方案，用于核对"任意壁纸可读"）</div>
</div></body></html>`)
  console.log('written ' + k + ' — ' + S.name)
}
