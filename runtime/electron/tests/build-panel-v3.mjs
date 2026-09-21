#!/usr/bin/env node
/* build-panel-v3.mjs —— 最终方案「深底板信息板」（收敛稿）
 *   参照：mobiGlas #02 / Spinner 刻度尺 #09 / Razorback 焦点 #11
 *   手法（搬手法，不搬密度）：
 *     ① 底板压得足够深（#02 的核验结论：压住任意背景靠底板深度，不靠强调色）
 *     ② 细网格 + 分区发丝线做结构（#02 + #11），不用卡片边框
 *     ③ 左右各一条 1px 刻度尺框住视口（#09），几乎不占像素却提供整套骨架
 *     ④ 居中单一视觉焦点 = 金额（#11），等宽数字、可逐位跳动
 *     ⑤ 层级靠字体差异（#02）：粗标题 + 更小明细行
 *     ⑥ 强调色极少量：只落状态点与关键数字
 *     ⑦ 跳动感：让**边框呼吸**，不让文字抖（#06 结论）
 *     ⑧ 任务靠列位与行节奏（#03）：行距列位一致 → 看不清也像一张表
 *   两个变体 A 标准密度 / B 极简骨架，各在**深色与浅色两种桌面**上各出一张（验证 #02 那条结论）
 * 输出：docs/panel-mocks-v3/{a-dark,a-light,b-dark,b-light}.html
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })

/* ---------- 图标（与生产 runtime 同几何、同色系：结构是信息板，气质仍是一套装置） ---------- */
function makeRnd (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function particles (n, r0, r1, key) {
  const rnd = makeRnd(90210 + 777 + 87 * 131); const out = []
  for (let i = 0; i < n; i++) {
    const th = rnd() * Math.PI * 2, r = r0 + (r1 - r0) * Math.sqrt(rnd()), z = rnd()
    out.push({ x: +(100 + Math.cos(th) * r).toFixed(2), y: +(100 + Math.sin(th) * r * 0.94).toFixed(2), r: +(0.85 + z * 1.5).toFixed(2), o: +(0.26 + 0.74 * z).toFixed(3), z })
  }
  out.sort((a, b) => a.z - b.z)
  return out.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${key}" opacity="${p.o}"/>`).join('')
}
function icon (id) {
  return `<svg width="140" height="140" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="pl${id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#050708" stop-opacity="0.90"/>
      <stop offset="78%" stop-color="#050708" stop-opacity="0.54"/>
      <stop offset="100%" stop-color="#050708" stop-opacity="0"/>
    </radialGradient>
    <filter id="sf${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <circle cx="100" cy="100" r="97" fill="url(#pl${id})"/>
  <circle cx="100" cy="100" r="94" fill="none" stroke="#4d7a74" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g>${particles(98, 72, 92, '#5fd8c4')}</g>
  <circle cx="100" cy="100" r="60" fill="none" stroke="#5fd8c4" stroke-width="2" stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="48" fill="none" stroke="#4d7a74" stroke-width="1"/>
  <circle cx="100" cy="100" r="44" fill="#5fd8c4" opacity="0.18" filter="url(#sf${id})"/>
  <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="#5fd8c4" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="100" cy="100" r="12" fill="#5fd8c4"/>
</svg>`
}

/* ---------- 刻度尺（#09 的核心手法：1px 线 + 向内刻度，几乎不占像素） ---------- */
function ruler (h, x, side) {
  let s = ''
  const inward = side === 'l' ? 1 : -1
  for (let y = 6; y < h - 6; y += 7) {
    const long = (y - 6) % 35 === 0
    s += `<line x1="${x}" y1="${y}" x2="${x + inward * (long ? 7 : 3)}" y2="${y}" stroke="#2f3a3b" stroke-width="1"/>`
  }
  return s
}
/* ---------- 细网格（#02 + #11）：20px 极淡网格 + 3 条竖向分区线 ---------- */
function grid (w, h) {
  let s = ''
  for (let x = 20; x < w; x += 20) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#ffffff" stroke-width="1" opacity="0.022"/>`
  for (let y = 20; y < h; y += 20) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#ffffff" stroke-width="1" opacity="0.022"/>`
  for (const x of [w / 3, (w * 2) / 3]) s += `<line x1="${x}" y1="10" x2="${x}" y2="${h - 10}" stroke="#ffffff" stroke-width="1" opacity="0.05"/>`
  return s
}
const HAIR = '<div class="hair"></div>'

/* ---------- 数据 ---------- */
const D = {
  action: '跑整轮离屏回归',
  actionDetail: 'node tests/run-all.mjs · 12 项',
  elapsed: '00:42',
  think: ['正在核对 clearError 的发送时机：点击必须早于宿主回发的 state，',
    '否则窗口会先按旧状态渲染一帧再跳。'],
  cost: '0.428',
  cur: '¥',
  unit: 'CNY',
  delta: '▲ 0.021 / 步',
  tokens: '128.4k',
  session: 'dsh-work-icon · 本会话',
  tasks: [
    ['01', 'done', '只读取证：WindowFromPoint 命中测试', '2.4s'],
    ['02', 'done', '旋转缺陷：核心静止 + 轴心归位', '1.1s'],
    ['03', 'done', '面板几何与穿透划分', '3.8s'],
    ['04', 'doing', '信息面板最终方案（深底板）', '—'],
    ['05', 'todo', '交给用户挑变体', ''],
    ['06', 'todo', '并入生产 runtime', '']
  ]
}

/* ---------- 变体 A：标准密度 ---------- */
function variantA (id) {
  const tasks = D.tasks.slice(0, 6).map(([n, k, t, d]) => `
    <div class="row trow ${k}">
      <span class="idx">${n}</span><span class="mk">${k === 'done' ? '✓' : k === 'doing' ? '●' : '·'}</span>
      <span class="tt">${t}</span><span class="ttime">${d}</span>
    </div>`).join('')
  return `
  <div class="plate">
    <svg class="bg" width="300" height="200" viewBox="0 0 300 200" preserveAspectRatio="none">${grid(300, 200)}${ruler(200, 13, 'l')}${ruler(200, 287, 'r')}</svg>
    <div class="inner">
      <div class="head"><span class="kicker">WORK-ICON / SESSION</span><span class="head-el">${D.elapsed}</span></div>
      ${HAIR}
      <div class="actBlock">
        <span class="dot"></span><span class="actTitle">${D.action}</span>
        <span class="actDetail">${D.actionDetail}</span>
      </div>
      ${HAIR}
      <div class="thinkBlock">
        <span class="lab">THINK · TAIL</span>
        ${D.think.map((t, i) => `<div class="tline${i ? ' dim' : ''}">${t}</div>`).join('')}
      </div>
      ${HAIR}
      <div class="costBlock">
        <span class="costCur">${D.cur}</span><span class="costNum">${D.cost}</span><span class="costUnit">${D.unit}</span>
        <div class="costDelta">${D.delta}</div>
      </div>
      ${HAIR}
      <div class="taskBlock">
        <div class="thead"><span class="lab">TASKS</span><span class="tcount">3 / 6</span></div>
        ${tasks}
      </div>
      ${HAIR}
      <div class="foot"><span>${D.session}</span><span class="foot-r">${D.tokens} TOK</span></div>
    </div>
  </div>`
}

/* ---------- 变体 B：极简骨架（只留刻度尺 + 网格 + 金额焦点 + 一行动作） ---------- */
function variantB (id) {
  const dots = D.tasks.map(([, k]) => `<i class="d ${k}"></i>`).join('')
  return `
  <div class="plate">
    <svg class="bg" width="300" height="132" viewBox="0 0 300 132" preserveAspectRatio="none">${grid(300, 132)}${ruler(132, 13, 'l')}${ruler(132, 287, 'r')}</svg>
    <div class="inner">
      <div class="actBlock tight"><span class="dot"></span><span class="actTitle">${D.action}</span><span class="head-el">${D.elapsed}</span></div>
      <div class="focusWrap">
        <span class="costCur">${D.cur}</span><span class="costNum big">${D.cost}</span><span class="costUnit">${D.unit}</span>
      </div>
      <div class="microRow">
        <span class="lab">TASKS</span><span class="dots">${dots}</span><span class="tcount">3/6</span>
        <span class="lab r">THINK</span><span class="pulse"><i></i><i></i><i></i></span>
      </div>
    </div>
  </div>`
}

/* ---------- 桌面背景（深 / 浅各一，验证 #02 的"底板够深"结论） ---------- */
const DESKS = {
  dark: { label: '深色壁纸', css: `background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%),
      linear-gradient(158deg,#3c4147 0%,#33383e 46%,#292d32 100%)` },
  light: { label: '浅色壁纸（最苛刻的对照）', css: `background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%),
      linear-gradient(158deg,#eceae5 0%,#dedbd4 52%,#cfccc5 100%)` }
}

const CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{width:470px;font-family:system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
  .desk{position:relative;width:470px;overflow:hidden}
  .win{position:absolute;left:85px;width:300px}
  .iconWrap{position:absolute;left:80px;top:35px;width:140px;height:140px}
  .hit{position:absolute;left:80px;top:35px;width:140px;height:140px;border-radius:50%;outline:1px dashed rgba(255,255,255,.14)}
  /* ===== 深底板：这是"压住任意背景"的根本（参照 #02：底板 #080808→#101818，仅极轻 teal 偏色） ===== */
  .plate{position:absolute;left:0;top:185px;width:300px;overflow:hidden;border-radius:3px;
    background:
      linear-gradient(180deg,rgba(16,20,21,.955) 0%,rgba(9,11,12,.965) 46%,rgba(7,9,10,.97) 100%);
    box-shadow:0 18px 40px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.45);
    border-top:1px solid rgba(255,255,255,.10);
    border-bottom:1px solid rgba(255,255,255,.05)}
  .plate::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(120deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,0) 38%)}
  .bg{position:absolute;left:0;top:0}
  .inner{position:relative;padding:11px 22px 10px}
  .hair{height:1px;background:rgba(255,255,255,.075);margin:7px 0}
  .head{height:13px;line-height:13px}
  .kicker{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:8.5px;letter-spacing:1.5px;color:#7e8e8f}
  .head-el,.ttime,.tcount{font-family:Consolas,'DejaVu Sans Mono',monospace;font-variant-numeric:tabular-nums;color:#7d8b8c;font-size:9.5px}
  .head-el{float:right}
  /* 粗标题 + 更小明细行（#02 的层级手法） */
  .actBlock{position:relative;height:34px;padding-left:14px}
  .actBlock.tight{height:22px}
  .dot{position:absolute;left:0;top:5px;width:6px;height:6px;border-radius:50%;background:#5fd8c4;
    box-shadow:0 0 0 3px rgba(95,216,196,.14)}
  .actTitle{display:block;font-size:13px;font-weight:700;letter-spacing:.2px;color:#eaf1f1;line-height:16px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .actDetail{display:block;font-size:10px;color:#8b9a9b;line-height:14px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lab{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:8.5px;letter-spacing:1.3px;color:#7e8e8f}
  .thinkBlock{height:44px}
  .tline{font-size:10.5px;line-height:15px;color:#cfd9d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tline.dim{color:#9aa8a9}
  /* 居中单一视觉焦点（#11）：亮度而非颜色来做焦点 */
  .costBlock{position:relative;height:56px;text-align:center;line-height:34px}
  .costCur{font-size:14px;color:#8b9a9b;vertical-align:6px;margin-right:2px}
  .costNum{font-family:Consolas,'DejaVu Sans Mono',monospace;font-variant-numeric:tabular-nums;
    font-size:30px;letter-spacing:.5px;color:#f4f8f8}
  .costNum.big{font-size:32px}
  .costUnit{font-size:9.5px;color:#7d8b8c;margin-left:5px;letter-spacing:.8px;vertical-align:2px}
  .costDelta{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:9.5px;color:#ffb257;line-height:14px}
  .focusWrap{position:relative;height:46px;text-align:center;line-height:40px}
  .taskBlock{height:auto}
  .thead{height:14px;line-height:14px}
  .tcount{float:right}
  /* 任务：列位 + 行节奏一致（#03）—— 看不清也读起来像一张表 */
  .trow{position:relative;height:13.5px;line-height:13.5px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .idx{display:inline-block;width:20px;font-family:Consolas,monospace;font-size:9px;color:#71807f}
  .mk{display:inline-block;width:14px;color:#5d6b6c;font-size:9.5px}
  .tt{color:#cbd5d5}
  .ttime{position:absolute;right:0;top:0;color:#657374}
  .trow.done .tt{color:#93a1a2}
  .trow.done .mk{color:#5fd8c4}
  .trow.doing .tt{color:#f0f5f5}
  .trow.doing .mk{color:#5fd8c4}
  .foot{height:13px;line-height:13px;font-size:9.5px;color:#71807f}
  .foot-r{float:right;font-family:Consolas,monospace;font-variant-numeric:tabular-nums}
  .microRow{position:relative;height:16px;line-height:16px}
  .microRow .dots{margin-left:8px}
  .microRow .d{display:inline-block;width:6px;height:6px;border-radius:1px;margin-right:4px;background:#37474a}
  .microRow .d.done{background:#5fd8c4}
  .microRow .d.doing{background:#ffb257}
  .microRow .tcount{float:none;margin-left:7px}
  .microRow .lab.r{margin-left:16px}
  .microRow .pulse{margin-left:7px}
  .pulse i{display:inline-block;width:3px;height:3px;border-radius:50%;background:#5fd8c4;margin-right:3px;opacity:.35}
  .pulse i:nth-child(2){opacity:.65}
  .pulse i:nth-child(3){opacity:.95}
  /* ===== 标注卡 ===== */
  .cap{width:470px;padding:15px 20px 18px;background:#141618;color:#e8ecee}
  .cap h3{margin:0 0 7px;font-size:15px;letter-spacing:.4px}
  .cap h3 .ref{font-size:9.5px;letter-spacing:.6px;color:#5fd8c4;border:1px solid #333c3d;border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:2px}
  .cap div{font-size:11.5px;line-height:1.72;color:#b6c0c6}
  .cap .k{display:inline-block;width:58px;color:#7d888f}
`

const VARIANTS = {
  a: { name: 'A · 标准密度', fn: variantA, winH: 385, plateH: 200, plateTop: 185,
       meta: { density: '四项齐全：动作行 / 思考尾串 / 金额焦点 / 任务 6 行', tech: '左右 1px 刻度尺（每 7px 一格、每 35px 长格）框住视口 · 20px 极淡网格 + 2 条竖向分区线 · 4 条发丝线分区 · 金额居中为唯一焦点 · 粗标题(13/700) + 明细行(10) 两级 · 任务行 13.5px 等距、序号/勾选/文本/耗时四列定宽' } },
  b: { name: 'B · 极简骨架', fn: variantB, winH: 317, plateH: 132, plateTop: 185,
       meta: { density: '只留刻度尺 + 网格 + 金额焦点 + 一行动作；思考与任务折叠为极简标记', tech: '同一套手法去掉 3 条发丝线与全部文字行：任务压成 6 格方点（完成=青实心 / 进行=琥珀 / 待办=灰空），思考压成 3 点脉冲；信息量减少 62%，骨架完全保住' } }
}

for (const [vk, v] of Object.entries(VARIANTS)) {
  for (const [dk, desk] of Object.entries(DESKS)) {
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${v.name} · ${desk.label}</title>
<style>${CSS}</style></head><body>
<div class="desk" style="height:${v.winH + 60}px;${desk.css}">
  <div class="win" style="top:30px;height:${v.winH}px">
    <div class="iconWrap">${icon(vk + dk)}</div>
    <div class="hit"></div>
    ${v.fn(vk)}
  </div>
</div>
<div class="cap">
  <h3>深底板信息板 · ${v.name} <span class="ref">参照：mobiGlas #02 / Spinner 刻度尺 #09 / Razorback 焦点 #11</span></h3>
  <div><span class="k">尺寸</span>面板 <b>300 × ${v.plateH}</b>　　窗口 <b>300 × ${v.winH}</b>（图标 140 居中，面板顶 = 图标下缘 175 + 10 = ${v.plateTop}）</div>
  <div><span class="k">桌面</span>${desk.label}</div>
  <div><span class="k">配色 5</span>底板 <b>#101415→#07090a</b> · 主文 <b>#eaf1f1 / 金额 #f4f8f8</b> · 明细 <b>#8b9a9b</b> · 细线刻度 <b>#2f3a3b</b> · 强调 <b>#5fd8c4</b>（+琥珀 #ffb257 仅用于"进行中"与增量）</div>
  <div><span class="k">字体</span>等宽（所有数字/标签/刻度，tabular-nums）· 系统无衬线（标题与正文）</div>
  <div><span class="k">信息密度</span>${v.meta.density}</div>
  <div><span class="k">技法</span>${v.meta.tech}</div>
  <div><span class="k">动效</span>整块文字<b>不动</b>；边框/发丝线 0.45Hz 呼吸（alpha .06↔.13）· 金额逐位跳动（数字变化时该位 90ms 上滑淡入）· 思考尾串按 6Hz 增量在行尾生长 · 任务行亮起时该行 120ms 提亮一次（不改行高、不重排）</div>
</div>
</body></html>`
    fs.writeFileSync(path.join(OUT, `${vk}-${dk}.html`), html)
    console.log('written ' + vk + '-' + dk + '.html')
  }
}
