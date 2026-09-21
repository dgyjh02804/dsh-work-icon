#!/usr/bin/env node
/* build-panel-mocks.mjs —— 生成「图标下方信息面板」三套视觉方向的静态成品（只做设计探索，不入生产代码）
 *
 * 共同骨架（真实尺寸，1:1 像素）：
 *   · 图标 140px 直径，窗口 210×210（图标居中，左右各 35px 余量 —— 与生产 runtime 完全一致）
 *   · 面板宽 210（= 窗口宽，与图标同一垂直中轴对齐），高度按内容自适应，本例 126px，上限 160px
 *   · 面板相对窗口的偏移：面板顶边 = 图标下缘 + 10px（图标底 = 35+140 = 175，面板顶 = 185）
 *   · 面板完全穿透鼠标（纯展示），只有图标圆形区（r=70）可交互 —— 见规格文档
 * 输出：docs/panel-mocks/{hud,note,holo}.html
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ---------- 图标：与 runtime/electron/index.html 同一套几何 + 同一套确定性随机 ---------- */
function makeRnd (seed) {
  let s = seed >>> 0
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
function cloud (state, count, r0, r1, c1) {
  const rnd = makeRnd(90210 + 777 + state.charCodeAt(0) * 131)
  const out = []
  for (let i = 0; i < count; i++) {
    const u = rnd(); const v = rnd(); const z = rnd()
    const theta = u * Math.PI * 2
    const r = r0 + (r1 - r0) * Math.sqrt(v)
    const x = 100 + Math.cos(theta) * Math.sqrt(r * r - 0) * (r / 97)
    const yRaw = 100 + Math.sin(theta) * (r / 97) * Math.sqrt(Math.max(0, r * r)) * 0
    /* 球面投影（disk 版，与生产一致）：半径 r、深度 z，y 压 0.94 */
    const px = 100 + Math.cos(theta) * r
    const py = 100 + Math.sin(theta) * r * 0.94
    const rad = (0.85 + z * 1.5).toFixed(2)
    const op = (0.26 + 0.74 * z).toFixed(3)
    out.push({ x: px.toFixed(2), y: py.toFixed(2), r: rad, o: op, z })
  }
  out.sort((a, b) => a.z - b.z)
  return out.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${c1}" opacity="${p.o}"/>`).join('')
}
function iconSvg (size) {
  const c1 = '#5cffd0'; const c2 = '#128f78'; const core = 1
  return `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="plate" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#050809" stop-opacity="0.86"/>
      <stop offset="82%" stop-color="#050809" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#050809" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="11"/></filter>
  </defs>
  <circle cx="100" cy="100" r="97" fill="url(#plate)"/>
  <circle cx="100" cy="100" r="94" fill="none" stroke="${c2}" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${cloud('W', 98, 72, 92, c1)}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="${c1}" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="${c2}" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="${c1}" opacity="${(core * 0.2).toFixed(2)}" filter="url(#soft)"/>
  <g>
    <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="${c1}" stroke-width="2.6" stroke-linejoin="round" opacity="${core}"/>
    <circle cx="100" cy="100" r="12" fill="${c1}" opacity="${core}"/>
  </g>
</svg>`
}

/* ---------- 面板内容（四项：状态 / 思考 / 花费 / 任务）---------- */
const DATA = {
  status: '执行中 · Bash',
  elapsed: '00:42',
  think: '正在确认 config 分支的字段顺序，先看宿主回发的 window.fps 有没有被 cleanWindow 收下…',
  cost: '¥0.42',
  tokens: '128k',
  tasks: [
    { k: 'done', t: '只读取证：WindowFromPoint 命中测试' },
    { k: 'done', t: '旋转缺陷：核心静止 + 轴心归位' },
    { k: 'doing', t: '信息面板的几何与穿透划分' },
    { k: 'todo', t: '把三套方向交给用户挑' }
  ],
  progress: '2 / 4'
}

function rows (skin) {
  const dot = `<span class="dot ${skin}"></span>`
  const tasks = DATA.tasks.map((t) => {
    const mark = t.k === 'done' ? '<span class="mk done">✓</span>' : t.k === 'doing' ? '<span class="mk doing">●</span>' : '<span class="mk todo">○</span>'
    return `<div class="task ${t.k}">${mark}<span class="tt">${t.t}</span></div>`
  }).join('')
  return `
  <div class="row r-status">${dot}<span class="st">${DATA.status}</span><span class="el">${DATA.elapsed}</span></div>
  <div class="row r-think"><span class="think">${DATA.think}</span></div>
  <div class="row r-cost"><span class="lbl">本会话</span><span class="num">${DATA.cost}</span><span class="sep">|</span><span class="num">${DATA.tokens}</span><span class="lbl">tokens</span></div>
  <div class="row r-tasks">${tasks}<div class="prog"><span class="num">${DATA.progress}</span></div></div>`
}

/* ---------- 三套方向 ---------- */
const DESKTOP = `background:
  radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,.05), rgba(255,255,255,0) 60%),
  linear-gradient(160deg,#3b4046 0%,#34383e 46%,#2c3035 100%);`

const SKINS = {
  hud: {
    name: 'A · 深色 HUD 薄板',
    note: '等宽排版 + 直角薄板 + 极细边框；青色只落在状态点与数字上，行间 1px 分割线承担结构',
    meta: { palette: '#0a0c0e 底 / #d7e3e6 正文 / #7fe3d4 强调 / #5cffd0 状态点 / #6b7a80 次级', font: '等宽 Consolas/DejaVu Sans Mono · 数字 Lanxi-品宋→宋体' },
    css: `
    .panel{background:rgba(9,11,13,.87);border:1px solid rgba(127,227,212,.20);border-radius:3px;
      box-shadow:0 10px 26px rgba(0,0,0,.52), inset 0 1px 0 rgba(255,255,255,.05);padding:9px 11px 8px}
    .panel::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,rgba(127,227,212,.5),rgba(127,227,212,0))}
    .row{border-bottom:1px solid rgba(255,255,255,.065)}
    .row:last-child{border-bottom:0}
    .st{color:#e8f4f6;letter-spacing:.3px}
    .el,.lbl,.sep,.mk.todo{color:#7b8b91}
    .num{color:#7fe3d4}
    .think{color:#aebfc4}
    .tt{color:#c3d2d6}
    .task.done .tt{color:#7b8b91;text-decoration:line-through;text-decoration-color:rgba(123,139,145,.55)}
    .task.doing .tt{color:#e8f4f6}
    .mk.done{color:#7fe3d4}.mk.doing{color:#5cffd0}
    .dot{background:#5cffd0;box-shadow:0 0 0 3px rgba(92,255,208,.16)}`
  },
  note: {
    name: 'B · 浅色便签',
    note: '浅磨砂卡 + 无边框 + 大投影分层；深墨字、数字用衬线，安静地贴在桌面上',
    meta: { palette: 'rgba(250,247,241,.94) 纸面 / #26292e 墨 / #8a7f6d 次级 / #b8642f 强调 / #2f7d63 完成', font: '正文系统无衬线 · 标题 Lanxi-文楷→楷体 · 数字 Lanxi-品宋→宋体' },
    css: `
    .panel{background:rgba(250,247,241,.94);border-radius:14px;padding:11px 13px 10px;
      box-shadow:0 14px 30px rgba(0,0,0,.30), 0 2px 6px rgba(0,0,0,.16)}
    .panel::before{content:"";position:absolute;left:13px;right:13px;top:0;height:2px;border-radius:2px;background:linear-gradient(90deg,rgba(184,100,47,.55),rgba(184,100,47,0))}
    .row{border-bottom:1px dashed rgba(38,41,46,.14)}
    .row:last-child{border-bottom:0}
    .st{color:#1f2226;font-family:'Lanxi-WenKai','Lanxi-自由浪漫',system-ui;font-size:13px}
    .el,.lbl,.sep,.mk.todo{color:#8a7f6d}
    .num{color:#b8642f;font-family:'Lanxi-品宋','Songti SC',serif}
    .think{color:#4a4f57}
    .tt{color:#3a3f46}
    .task.done .tt{color:#8a7f6d}
    .task.doing .tt{color:#1f2226}
    .mk.done{color:#2f7d63}.mk.doing{color:#b8642f}
    .dot{background:#b8642f;box-shadow:0 0 0 3px rgba(184,100,47,.18)}`
  },
  holo: {
    name: 'C · 无框全息',
    note: '没有底板：内容直接浮在桌面，靠 1px 极淡下划线与字距建立秩序；一层弱投影保证可读性',
    meta: { palette: '无底 / #ffffff 主文字 / #9fb0b6 次级 / #7fe3d4 强调 / rgba(0,0,0,.55) 投影', font: '正文系统无衬线 · 标题 Lanxi-静黑超细→细黑 · 数字 Lanxi-颜宋→宋体' },
    css: `
    .panel{background:rgba(0,0,0,.20);border-radius:8px;padding:8px 10px 7px;text-shadow:0 1px 2px rgba(0,0,0,.72),0 0 8px rgba(0,0,0,.45)}
    .panel::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,rgba(255,255,255,.34),rgba(255,255,255,.04) 62%,rgba(255,255,255,0))}
    .row{border-bottom:1px solid rgba(255,255,255,.10)}
    .row:last-child{border-bottom:0}
    .st{color:#ffffff;letter-spacing:.6px;font-family:'Lanxi-静黑超细',system-ui}
    .el,.lbl,.sep,.mk.todo{color:#9fb0b6}
    .num{color:#a9f0e4;font-family:'Lanxi-颜宋','Songti SC',serif}
    .think{color:#e2eaec}
    .tt{color:#e2eaec}
    .task.done .tt{color:#93a4aa}
    .task.doing .tt{color:#ffffff}
    .mk.done{color:#a9f0e4}.mk.doing{color:#7fe3d4}
    .dot{background:#7fe3d4;box-shadow:0 0 0 4px rgba(127,227,212,.18)}`
  }
}

const SHARED_CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{width:460px;font-family:system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
  .desk{position:relative;width:460px;height:660px;${DESKTOP}overflow:hidden}
  .desk::after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.045) 1px,transparent 1px);background-size:26px 26px;opacity:.5}
  .stack{position:absolute;left:125px;top:70px;width:210px}     /* 窗口左边界 = 图标圆心所在竖轴 */
  .iconbox{position:relative;width:210px;height:210px}         /* = 原窗口 210×210：图标 140 居中，四周各留 35 */
  .iconbox svg{position:absolute;left:35px;top:35px;width:140px;height:140px}
  .hitring{position:absolute;left:35px;top:35px;width:140px;height:140px;border-radius:50%;
    outline:1px dashed rgba(255,255,255,.20);outline-offset:0}
  .panel{position:absolute;left:0;top:185px;width:210px}         /* 面板顶 = 图标下缘(175) + 10 */
  .row{position:relative;height:20px;line-height:20px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .r-think{height:34px;line-height:17px;white-space:normal;overflow:hidden}
  .r-tasks{height:68px;line-height:17px;white-space:normal}
  .r-cost{height:18px;line-height:18px}
  .st,.think,.tt,.lbl,.el{font-size:11px}
  .num{font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:.2px}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;vertical-align:1px;margin-right:6px}
  .el{position:absolute;right:0;top:0}
  .think{display:block;overflow:hidden;max-height:34px;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}
  .task{position:relative;height:17px;line-height:17px;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mk{display:inline-block;width:12px}
  .prog{position:absolute;right:0;top:51px;font-size:10.5px}
  .sep{margin:0 6px}
  .cap{width:460px;padding:16px 20px 20px;background:#15171a;color:#e7ebee}
  .cap h3{margin:0 0 8px;font-size:15px;font-family:'Lanxi-静黑超细',system-ui;letter-spacing:.4px}
  .cap dl{margin:0;display:block;font-size:11.5px;line-height:1.75;color:#b9c3c9}
  .cap b{color:#e7ebee;font-weight:600}
  .cap .k{display:inline-block;width:64px;color:#7f8b93}
  .cap .tag{display:inline-block;padding:1px 6px;border:1px solid #333a40;border-radius:3px;color:#9fb0b6;margin-right:6px}
`

for (const [slug, s] of Object.entries(SKINS)) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${s.name}</title>
<style>${SHARED_CSS}${s.css}</style></head>
<body>
<div class="desk">
  <div class="stack">
    <div class="iconbox">
      ${iconSvg(140)}
      <div class="hitring" title="可交互区：r=70"></div>
    </div>
    <div class="panel">${rows(slug)}</div>
  </div>
</div>
<div class="cap">
  <h3>${s.name}</h3>
  <dl>
    <div><span class="k">面板尺寸</span><b>210 × 156 px</b>（窗口 210 × 341；图标 140 居中，面板顶 = 图标下缘 + 10）</div>
    <div><span class="k">配色（5）</span>${s.meta.palette}</div>
    <div><span class="k">字体</span>${s.meta.font}</div>
    <div><span class="k">关键技法</span>${s.note}</div>
    <div style="margin-top:6px"><span class="tag">固定行高 22px</span><span class="tag">省略号截断</span><span class="tag">面板整体穿透</span></div>
  </dl>
</div>
</body></html>`
  fs.writeFileSync(path.join(OUT, `${slug}.html`), html)
  console.log('written ' + path.join(OUT, `${slug}.html`))
}
