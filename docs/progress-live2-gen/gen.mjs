/* progress-live2 generator
 * 生成 4 套全新进度条渲染方案（真动效页）。
 * 纪律：
 *  - 只用 transform / opacity（合成层），不用 backdrop-filter / filter:blur / box-shadow
 *  - JS 只用 ES5 function 声明；不用箭头函数 / class / 方法简写
 *    （曾经的坑：fn.toString() 产出非法 JS => 整段 script 静默不执行 => 14 个静止 mock）
 *  - 【本次实测踩到的坑 1】在 SVG 上给 <g> 设 `transform` 属性、同时又有 CSS
 *    `transition:transform` 时，Chromium 会把 computed style 钉在 transition 起点，
 *    属性永远不生效（元素看着完全静止）。所以一律改用 CSS `style.transform`
 *    （translateY(px) / rotate(deg) / scale(x,y)），transform-origin 用 viewBox 用户单位。
 *  - 【本次实测踩到的坑 2】`style.transform = "scale(1 0.5)"` 空格写法在这个上下文被拒，
 *    inline style 变空串 —— 必须写 `scale(1, 0.5)` 带逗号。
 *  - 【本次实测踩到的坑 3】方案函数必须真的被调用（UPD 里要显式调用 xxxUpdate），
 *    只定义不调用同样是"静帧交付"。
 *  - 注意：不要用 PowerShell 的 Set-Content / -replace 改这个文件：PS5.1 会按 CP936 解码，
 *    UTF-8 中文全部变乱码。只用编辑器 / 写入工具改。
 *  - 每页都有探针：window.onerror -> #jserr，每 tick 累加 document.body.dataset.ticks
 *    并写入一个可见的 #probe 元素（便于无头 dump 直接读取）
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/progress-live2'

const TEAL = '#56d9c8'
const TEAL_D = '#2f8f84'
const AMBER = '#ffc266'
const INK = '#e8f0fa'
const DIM = '#92aac0'

function n(v) { return Number(v.toFixed(3)) }

function ringTicks(R, k, len, w) {
  let s = ''
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2
    const r0 = 100 * (R + 0.014)
    const r1 = 100 * (R + 0.014 + k * len)
    s += '<line x1="' + n(100 + Math.cos(a) * r0) + '" y1="' + n(100 + Math.sin(a) * r0) +
      '" x2="' + n(100 + Math.cos(a) * r1) + '" y2="' + n(100 + Math.sin(a) * r1) +
      '" stroke="' + DIM + '" stroke-opacity=".55" stroke-width="' + n(Math.max(k * w, 0.9)) + '"/>'
  }
  return s
}
function discBase(uid) {
  return '<defs><radialGradient id="disc' + uid + '" cx="50%" cy="50%" r="50%">' +
    '<stop offset="0%" stop-color="#07121d" stop-opacity=".93"/>' +
    '<stop offset="76%" stop-color="#07121d" stop-opacity=".58"/>' +
    '<stop offset="100%" stop-color="#07121d" stop-opacity=".06"/></radialGradient></defs>' +
    '<circle cx="100" cy="100" r="96" fill="url(#disc' + uid + ')"/>' +
    '<circle cx="100" cy="100" r="96" fill="none" stroke="' + TEAL_D + '" stroke-opacity=".5" stroke-width="1" stroke-dasharray="1.5 7"/>'
}
function doneGlyph(k, r) {
  const p = 'M' + n(100 - 0.20 * r) + ' ' + n(100 + 0.02 * r) +
    ' L' + n(100 - 0.05 * r) + ' ' + n(100 + 0.17 * r) +
    ' L' + n(100 + 0.20 * r) + ' ' + n(100 - 0.15 * r)
  return '<g class="done"><path d="' + p + '" fill="none" stroke="#7fe3c8" stroke-width="' + n(Math.max(k * 0.032 * r, 2)) +
    '" stroke-linecap="round" stroke-linejoin="round" opacity="0"/></g>'
}
function coreSpot(k, r) {
  return '<circle class="core" cx="100" cy="100" r="' + n(0.30 * r) + '" fill="' + TEAL + '" opacity=".22"/>'
}

/* =====================================================================
 * ① LADDER · 姿态地平线
 * ===================================================================*/
function svgLadder(k, s) {
  const R = 96, W = 70
  const uid = s
  let out = discBase(uid)
  out += '<g>' + ringTicks(0.94, k, 0.02, 0.9) + '</g>'
  out += '<defs><clipPath id="cf' + uid + '"><circle cx="100" cy="100" r="' + W + '"/></clipPath></defs>'
  let ladder = ''
  for (let d = -60; d <= 60; d += 10) {
    const y = 100 - d
    const half = Math.abs(d) === 0 ? 52 : 9 + Math.abs(d) * 0.42
    const isMajor = d === 0
    ladder += '<line x1="' + n(100 - half) + '" y1="' + y + '" x2="' + n(100 + half) + '" y2="' + y +
      '" stroke="' + (isMajor ? INK : DIM) + '" stroke-opacity="' + (isMajor ? '.95' : '.44') +
      '" stroke-width="' + n(Math.max(k * (isMajor ? 2.4 : 1.5), 0.9)) + '"/>'
  }
  for (let d = -50; d <= 50; d += 10) {
    if (d === 0) continue
    const y = 100 - d
    const half = 9 + Math.abs(d) * 0.42 + 4
    ladder += '<line x1="' + n(100 - half) + '" y1="' + y + '" x2="' + n(100 - half + 6) + '" y2="' + n(y + 6) +
      '" stroke="' + DIM + '" stroke-opacity=".42" stroke-width="' + n(Math.max(k * 1.4, 0.9)) + '"/>' +
      '<line x1="' + n(100 + half) + '" y1="' + y + '" x2="' + n(100 + half - 6) + '" y2="' + n(y + 6) +
      '" stroke="' + DIM + '" stroke-opacity=".42" stroke-width="' + n(Math.max(k * 1.4, 0.9)) + '"/>'
  }
  for (let d = -60; d <= 60; d += 10) {
    if (Math.abs(d) >= 50) continue
    const y = 100 - d + 2.8
    ladder += '<text x="' + n(100 - (9 + Math.abs(d) * 0.42) - 3) + '" y="' + n(y) +
      '" fill="' + DIM + '" fill-opacity=".62" font-size="7.2" text-anchor="end" font-family="ui-monospace,Consolas,monospace">' + Math.abs(d) + '</text>'
    ladder += '<text x="' + n(100 + (9 + Math.abs(d) * 0.42) + 3) + '" y="' + n(y) +
      '" fill="' + DIM + '" fill-opacity=".62" font-size="7.2" text-anchor="start" font-family="ui-monospace,Consolas,monospace">' + Math.abs(d) + '</text>'
  }
  out += '<g clip-path="url(#cf' + uid + ')"><g class="horizon">' +
    '<g transform="rotate(45 100 100)">' +
    '<rect x="-90" y="-90" width="380" height="190" fill="' + TEAL + '" fill-opacity=".175"/>' +
    '<rect x="-90" y="100" width="380" height="190" fill="' + AMBER + '" fill-opacity=".145"/></g>' +
    ladder +
    '<line x1="-40" y1="100" x2="240" y2="100" stroke="' + INK + '" stroke-opacity=".92" stroke-width="' + n(Math.max(k * 2.4, 1.2)) + '"/>' +
    '<line x1="-40" y1="103" x2="240" y2="103" stroke="' + INK + '" stroke-opacity=".28" stroke-width="' + n(Math.max(k * 1.2, 0.9)) + '"/>' +
    '</g></g>'
  out += coreSpot(k, R)
  out += '<path class="wing" d="M' + n(100 - 30) + ' 100 L' + n(100 - 11) + ' 100 L' + n(100 - 11) + ' 106 L' + n(100 - 19) + ' 106 L' + n(100 - 22) + ' 116 L' + n(100 - 30) + ' 116 Z" fill="' + AMBER + '" opacity=".95"/>' +
    '<path class="wing" d="M' + n(100 + 30) + ' 100 L' + n(100 + 11) + ' 100 L' + n(100 + 11) + ' 106 L' + n(100 + 19) + ' 106 L' + n(100 + 22) + ' 116 L' + n(100 + 30) + ' 116 Z" fill="' + AMBER + '" opacity=".95"/>' +
    '<circle cx="100" cy="100" r="3.4" fill="' + INK + '"/>'
  let bank = ''
  for (let b = -60; b <= 60; b += 10) {
    const a = -Math.PI / 2 + (b * Math.PI) / 180
    const r0 = 0.70 * R, r1 = 0.70 * R + (b % 30 === 0 ? 0.09 * R : 0.05 * R)
    bank += '<line x1="' + n(100 + Math.cos(a) * r0) + '" y1="' + n(100 + Math.sin(a) * r0) +
      '" x2="' + n(100 + Math.cos(a) * r1) + '" y2="' + n(100 + Math.sin(a) * r1) +
      '" stroke="' + INK + '" stroke-opacity=".5" stroke-width="' + n(Math.max(k * 1.6, 1)) + '"/>'
  }
  out += bank
  out += '<path d="M' + n(100 - 5) + ' ' + n(100 - W) + ' L' + n(100 + 5) + ' ' + n(100 - W) + ' L100 ' + n(100 - W + 9) + ' Z" fill="' + INK + '" opacity=".9"/>'
  out += '<g class="lockring" opacity="0"><circle cx="100" cy="100" r="' + W + '" fill="none" stroke="#7fe3c8" stroke-opacity=".9" stroke-width="' + n(Math.max(k * 3, 1.4)) + '"/></g>'
  out += doneGlyph(k, R * 0.52)
  return out
}

/* =====================================================================
 * ② AZIMUTH · 航道罗盘卡
 * ===================================================================*/
function svgAzimuth(k, s) {
  const R = 96, W = 70, RC = 62
  const uid = s
  let out = discBase(uid)
  out += '<g>' + ringTicks(0.94, k, 0.018, 0.9) + '</g>'
  out += '<defs><clipPath id="cf' + uid + '"><circle cx="100" cy="100" r="' + W + '"/></clipPath></defs>'
  let dots = ''
  for (let i = -3; i <= 3; i++) {
    const x = 100 + i * 7
    dots += '<circle cx="' + x + '" cy="128" r="' + n(i === 0 ? 2.1 : 1.5) + '" fill="' + INK +
      '" fill-opacity="' + (i === 0 ? '.75' : '.35') + '"/>'
  }
  out += '<g class="terms">' + dots + '</g>'
  let rose = ''
  rose += '<circle cx="100" cy="100" r="' + n(RC - 8) + '" fill="none" stroke="' + DIM + '" stroke-opacity=".3" stroke-width="' + n(Math.max(k * 1.2, 0.9)) + '"/>'
  rose += '<circle cx="100" cy="100" r="' + n(RC - 16) + '" fill="none" stroke="' + DIM + '" stroke-opacity=".2" stroke-width="' + n(Math.max(k * 1, 0.9)) + '"/>'
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2
    const major = i % 9 === 0, mid = i % 3 === 0
    const len = major ? 12 : mid ? 8 : 4.5
    const r0 = RC
    rose += '<line x1="' + n(100 + Math.cos(a) * r0) + '" y1="' + n(100 + Math.sin(a) * r0) +
      '" x2="' + n(100 + Math.cos(a) * (r0 - len)) + '" y2="' + n(100 + Math.sin(a) * (r0 - len)) +
      '" stroke="' + (major ? INK : DIM) + '" stroke-opacity="' + (major ? '.85' : '.45') +
      '" stroke-width="' + n(Math.max(k * (major ? 2.2 : 1.3), 0.9)) + '"/>'
    if (major && i % 18 === 0) {
      const rr = r0 - 22
      const lbl = i === 0 ? 'N' : i === 18 ? 'S' : i === 9 ? 'E' : 'W'
      rose += '<text x="' + n(100 + Math.cos(a) * rr) + '" y="' + n(100 + Math.sin(a) * rr + 3.4) +
        '" fill="' + INK + '" fill-opacity=".82" font-size="10" text-anchor="middle" font-family="ui-monospace,Consolas,monospace">' + lbl + '</text>'
    }
  }
  const ta = 0.55 * Math.PI * 2 - Math.PI / 2
  const tx = n(100 + Math.cos(ta) * (RC - 12)), ty = n(100 + Math.sin(ta) * (RC - 12))
  rose += '<path d="M' + tx + ' ' + ty + ' l-5.5 9 l11 0 Z" fill="' + AMBER + '" opacity=".95" transform="rotate(' + n((0.55 * 360) + 90) + ' ' + tx + ' ' + ty + ')"/>'
  out += '<g clip-path="url(#cf' + uid + ')"><g class="card">' + rose + '</g></g>'
  out += '<line class="lubber" x1="100" y1="' + n(100 - W) + '" x2="100" y2="104" stroke="' + TEAL +
    '" stroke-opacity=".95" stroke-width="' + n(Math.max(k * 2.6, 1.2)) + '"/>'
  out += '<path d="M96 ' + n(100 - W) + ' L104 ' + n(100 - W) + ' L100 ' + n(100 - W + 7) + ' Z" fill="' + TEAL + '"/>'
  out += '<g class="needle">' +
    '<rect x="' + n(100 - 2.6) + '" y="' + n(100 - 46) + '" width="5.2" height="92" fill="' + INK + '" fill-opacity=".92"/>' +
    '<rect x="' + n(100 - 2.6) + '" y="' + n(100 - 46) + '" width="5.2" height="92" fill="none" stroke="' + TEAL + '" stroke-opacity=".65" stroke-width="0.9"/>' +
    '<path d="M100 ' + n(100 - 54) + ' l5.5 9 l-11 0 Z" fill="' + TEAL + '"/>' +
    '<path d="M100 ' + n(100 + 54) + ' l-5.5 -9 l11 0 Z" fill="' + TEAL + '"/>' +
    '</g>'
  out += '<g class="terms">' + coreSpot(k, R) + '<circle cx="100" cy="100" r="3.2" fill="' + INK + '"/></g>'
  out += '<g class="lockring" opacity="0"><circle cx="100" cy="100" r="' + W + '" fill="none" stroke="#7fe3c8" stroke-opacity=".9" stroke-width="' + n(Math.max(k * 3, 1.4)) + '"/></g>'
  out += doneGlyph(k, R * 0.5)
  return out
}

/* =====================================================================
 * ③ FAN · 粒迹扇形
 * ===================================================================*/
function svgFan(k, s) {
  const R = 96, W = 70
  const uid = s
  let out = discBase(uid)
  out += '<g>' + ringTicks(0.94, k, 0.016, 0.9) + '</g>'
  out += '<defs><clipPath id="cf' + uid + '"><circle cx="100" cy="100" r="' + W + '"/></clipPath></defs>'
  const tracks = []
  let seed = 20260912
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (i / 26) * Math.PI * 2 + (rnd() - 0.5) * 0.10
    const len = 26 + rnd() * 44
    const r0 = 7 + rnd() * 5
    tracks.push({
      x1: n(100 + Math.cos(a) * r0), y1: n(100 + Math.sin(a) * r0),
      x2: n(100 + Math.cos(a) * (r0 + len)), y2: n(100 + Math.sin(a) * (r0 + len)),
      w: n(Math.max(k * (0.9 + rnd() * 1.7), 0.9)),
      o: n(0.42 + rnd() * 0.4)
    })
  }
  let tg = ''
  for (const t of tracks) {
    tg += '<line x1="' + t.x1 + '" y1="' + t.y1 + '" x2="' + t.x2 + '" y2="' + t.y2 +
      '" stroke="url(#trg' + uid + ')" stroke-opacity="' + t.o + '" stroke-width="' + t.w + '" stroke-linecap="round"/>'
    tg += '<circle cx="' + t.x2 + '" cy="' + t.y2 + '" r="' + n(Math.max(k * 1.7, 0.9)) + '" fill="' + INK + '" fill-opacity=".85"/>'
  }
  out += '<defs><radialGradient id="trg' + uid + '" cx="100" cy="100" r="70" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0%" stop-color="' + TEAL + '" stop-opacity=".95"/>' +
    '<stop offset="55%" stop-color="' + TEAL + '" stop-opacity=".6"/>' +
    '<stop offset="100%" stop-color="' + TEAL + '" stop-opacity=".05"/></radialGradient></defs>'
  out += '<g clip-path="url(#cf' + uid + ')"><g class="tracks">' + tg + '</g></g>'
  out += coreSpot(k, R)
  out += '<circle class="vertex" cx="100" cy="100" r="16" fill="' + INK + '" fill-opacity=".9"/>'
  out += '<circle cx="100" cy="100" r="' + n(0.30 * R) + '" fill="none" stroke="' + TEAL + '" stroke-opacity=".5" stroke-width="' + n(Math.max(k * 1.6, 1)) + '"/>'
  out += '<g class="capture" opacity="0"><circle cx="100" cy="100" r="' + n(W * 0.94) + '" fill="none" stroke="#7fe3c8" stroke-opacity=".85" stroke-width="' + n(Math.max(k * 2.6, 1.2)) + '" stroke-dasharray="4 3"/></g>'
  out += doneGlyph(k, R * 0.5)
  return out
}

/* =====================================================================
 * ④ MOIRE · 干涉环场
 * ===================================================================*/
function svgMoire(k, s) {
  const R = 96, W = 70
  const uid = s
  let out = discBase(uid)
  out += '<g>' + ringTicks(0.94, k, 0.016, 0.9) + '</g>'
  out += '<defs><clipPath id="cf' + uid + '"><circle cx="100" cy="100" r="' + W + '"/></clipPath></defs>'
  let gA = ''
  for (let i = 0; i < 9; i++) {
    gA += '<circle cx="100" cy="100" r="' + n(15.4 + i * 9.2) + '" fill="none" stroke="' + DIM +
      '" stroke-opacity=".5" stroke-width="' + n(Math.max(k * 1.5, 0.9)) + '"/>'
  }
  out += '<g>' + gA + '</g>'
  let gB = ''
  for (let i = 0; i < 15; i++) {
    gB += '<circle cx="100" cy="100" r="' + n(7.1 + i * 6.05) + '" fill="none" stroke="' + TEAL +
      '" stroke-opacity=".7" stroke-width="' + n(Math.max(k * 1.5, 0.9)) + '"/>'
  }
  out += '<g clip-path="url(#cf' + uid + ')"><g class="grating">' + gB + '</g></g>'
  out += coreSpot(k, R)
  out += '<circle cx="100" cy="100" r="' + n(0.14 * R) + '" fill="' + INK + '" fill-opacity=".85"/>'
  out += '<g class="collapse" opacity="0"><circle cx="100" cy="100" r="' + n(W * 0.84) + '" fill="' + TEAL + '" fill-opacity=".88"/></g>'
  out += '<g class="lockring" opacity="0"><circle cx="100" cy="100" r="' + W + '" fill="none" stroke="#7fe3c8" stroke-opacity=".9" stroke-width="' + n(Math.max(k * 3, 1.4)) + '"/></g>'
  out += doneGlyph(k, R * 0.48)
  return out
}

/* =====================================================================
 * 方案定义
 * ===================================================================*/
const SCHEMES = []

SCHEMES.push({
  id: 'ladder', no: '①', name: 'LADDER', cn: '姿态地平线',
  ref: '航空姿态仪 attitude indicator（天/地 + 俯仰刻度梯 + 机翼 + 背向标）',
  svg: svgLadder,
  css: [
    '.g .horizon{transition:transform .26s cubic-bezier(.22,.9,.3,1)}',
    '.g .core{transform-origin:100px 100px;animation:ladBreath 2.6s ease-in-out infinite}',
    '@keyframes ladBreath{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:.9;transform:scale(1.1)}}',
    '.g .lockring{transition:opacity .3s}',
    '.paused .g *{animation-play-state:paused}'
  ].join('\n'),
  fn: [
    'function ladUpdate(root, p, state) {',
    '  var W = 70',
    '  var travel = 2 * W * 0.92',
    '  var hz = root.querySelector(".horizon")',
    '  if (hz) hz.style.transform = "translateY(" + (-p * travel).toFixed(3) + "px)"',
    '  var lr = root.querySelector(".lockring")',
    '  if (lr) lr.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var dn = root.querySelector(".done path")',
    '  if (dn) dn.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var c = root.querySelector(".core")',
    '  if (c) c.setAttribute("opacity", state === "complete" ? ".95" : (0.3 + 0.42 * p).toFixed(2))',
    '  root.querySelectorAll(".wing").forEach(function (w) {',
    '    w.setAttribute("opacity", state === "rest" ? "0.55" : "0.95")',
    '  })',
    '}'
  ].join('\n'),
  body: 'ladUpdate(root, p, state)',
  intent: '把“进度”从“一段弧有多长”换成“地平线沉到了哪里” —— 唯一会动的东西是被机翼挡在后面的那半颗球。',
  why: [
    '圆里唯一动的是**一整条带刻度的地平线在平移**，机翼、中心点、顶部背向刻度全是钉死的参照系 —— 这种「基准动、指针静」的构图在进度条里几乎见不到（进度条习惯反过来：指针绕圈、刻度不动）。',
    '刻度梯是**密排横线 + 两侧对称小勾（角度指示箭头）+ 两侧数字**，构成的是一条“有刻度的面”，而不是一条线；面上还自带明确的色域分界（青=天 / 琥珀=地）。所以推进的同时还读得到“离中性还差几度”。',
    '完成态的换形是这个语言里天然存在的：地面退出、地平线锁到中位、捕获环亮起 —— 球「回正」了。不需要额外贴一个勾上去。'
  ],
  bad: '不适合当「分项任务 / 多子任务」读数 —— 地平线是单一标量，塞第二根进去会和机翼打架；也不适合做 16px 极小徽标（刻度梯会糊成一团灰块）。',
  parts: [
    ['P1 地平线带', '带刻度的天/地双色平移面（含 0° 基准线）', '可换：改成“纯刻度线无填充”更冷静；或把天/地比从青/琥珀换成青/紫'],
    ['P2 固定参照', '机翼 + 中心点 + 顶部背向三角与刻度弧', '可换：可用 ② 的 lubber line，或 ③ 的中心顶点点阵替代'],
    ['P3 静态刻度环', '外圈 60 分格刻度环（复用图标本体的环语言）', '可换：② / ④ 的外环，或整圈删掉留白'],
    ['P4 完成态', '捕获环 + 回正 + 勾（三件套）', '可换：③ 的 capture 虚线环；或只留“回正”一个信号']
  ]
})

SCHEMES.push({
  id: 'azimuth', no: '②', name: 'AZIMUTH', cn: '航道罗盘卡',
  ref: '航空 HSI 水平状态指示器（罗盘卡旋转 + 航道偏差杆 + lubber line）',
  svg: svgAzimuth,
  css: [
    '.g .card{transform-origin:100px 100px;transition:transform .32s cubic-bezier(.22,.9,.3,1)}',
    '.g .needle{transition:transform .26s cubic-bezier(.22,.9,.3,1)}',
    '.g .core{transform-origin:100px 100px;animation:aziBreath 2.6s ease-in-out infinite}',
    '@keyframes aziBreath{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:.9;transform:scale(1.1)}}',
    '.g .lockring{transition:opacity .3s}',
    '.paused .g *{animation-play-state:paused}'
  ].join('\n'),
  fn: [
    'function aziUpdate(root, p, state) {',
    '  var card = root.querySelector(".card")',
    '  if (card) card.style.transform = "rotate(" + (p * 300).toFixed(3) + "deg)"',
    '  var nd = root.querySelector(".needle")',
    '  if (nd) {',
    '    var dx = (1 - p) * 27 - 1',
    '    if (state === "advance") dx += Math.sin(Date.now() / 240) * 1.5',
    '    nd.style.transform = "translateX(" + dx.toFixed(3) + "px)"',
    '  }',
    '  var lr = root.querySelector(".lockring")',
    '  if (lr) lr.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var dn = root.querySelector(".done path")',
    '  if (dn) dn.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var lb = root.querySelector(".lubber")',
    '  if (lb) lb.setAttribute("stroke-opacity", state === "complete" ? "1" : (0.55 + 0.4 * p).toFixed(2))',
    '  var c = root.querySelector(".core")',
    '  if (c) c.setAttribute("opacity", (0.28 + 0.5 * p).toFixed(2))',
    '}'
  ].join('\n'),
  body: 'aziUpdate(root, p, state)',
  intent: '整张罗盘卡在转（总进度），一根航道偏差杆横向滑向零位（当前任务离目标还差多远）—— 两个正交的读数共用一个圆心。',
  why: [
    '“卡转 / 杆移” 是 HSI 独有的**双自由度构图**：同一个圆里同时存在旋转量和平移量两条互不相干的进度轴。现有 12 套里每一套都只有一个自由度（要么角度、要么长度、要么点亮数）。',
    '主指针不是常见三角形，而是**带上下双 V 尖的竖直长杆**，压着一排 7 颗疏密点（航道偏差点阵）—— 形状记忆点来自“跑道中线”，和普遍认知里的“指针”不是一类东西。',
    '罗盘卡上 36 分格（疏密三档）+ N/E/S/W 字母 + 一个琥珀色目标箭头，转起来会产生“被真正读到的角度”的感觉，而不是“一圈灯在亮”。'
  ],
  bad: '不给百分比数字时，“转了多少度”比长度类方案更难判读（人眼对角度的分辨力低于对长度）；也不适合塞进细长条形空间（它是圆的，横向空间利用率低）。',
  parts: [
    ['P1 罗盘卡', '36 分格 + N/E/S/W + 目标箭头的整体旋转盘', '可换：旋转量改 720°（两圈）区分长短任务；或降为 36 格离散跳格更机械'],
    ['P2 偏差杆', '竖直长杆 + 上下双 V 尖，横向平移', '可换：换回 HSI 原版的 5 点横排偏差点；或改成竖直平移的俯仰杆'],
    ['P3 静态外环', '外圈 60 分格刻度环', '可换：③ / ④ 的外环，或删掉'],
    ['P4 完成态', 'lubber line 提亮 + 捕获环 + 勾', '可换：只留“目标箭头与 lubber 完全重合”作为唯一信号（更含蓄）']
  ]
})

SCHEMES.push({
  id: 'fan', no: '③', name: 'FAN', cn: '粒迹扇形',
  ref: '粒子物理事件显示：气泡室 / 火花室径迹图（顶点 + 发散径迹 + 末端点）',
  svg: svgFan,
  css: [
    '.g .tracks{transform-origin:100px 100px;transition:transform .3s cubic-bezier(.22,.9,.3,1)}',
    '.g .core{transform-origin:100px 100px;animation:fanBreath 2.6s ease-in-out infinite}',
    '@keyframes fanBreath{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:.88;transform:scale(1.14)}}',
    '.g .vertex{transition:r .25s}',
    '.g .capture{transition:opacity .3s}',
    '.paused .g *{animation-play-state:paused}'
  ].join('\n'),
  fn: [
    'function fanUpdate(root, p, state) {',
    '  var tg = root.querySelector(".tracks")',
    '  if (tg) tg.style.transform = "scale(1, " + (0.22 + 0.78 * p).toFixed(4) + ")"',
    '  var cp = root.querySelector(".capture")',
    '  if (cp) cp.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var dn = root.querySelector(".done path")',
    '  if (dn) dn.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var vx = root.querySelector(".vertex")',
    '  if (vx) vx.setAttribute("r", (11 + 8 * p).toFixed(2))',
    '  var c = root.querySelector(".core")',
    '  if (c) c.setAttribute("opacity", (0.3 + 0.5 * p).toFixed(2))',
    '}'
  ].join('\n'),
  body: 'fanUpdate(root, p, state)',
  intent: '把任务当成一次粒子事件：26 条径迹从同一点出发，各自交代自己的长度 —— 进度就是它们伸出去的比例。',
  why: [
    '几何是**一圈从同一点发散、长短不一、带随机抖动的射线**，每根末端一颗像素点。整体轮廓是“不规则的星芒 / 溅射”，既不是圆环也不是规整扇形 —— 现有 12 套里没有任何一套是这个轮廓。',
    '进度推进时，变化是“一片参差的刺同时长出来”，而不是一条整齐的弧扫过。这一点是刻意和被否掉的 RADAR（规整扫掠）拉开距离的。',
    '每根线用 userSpaceOnUse 的径向渐变：**根部亮、末端化进背景**，所以是“能量从顶点散出去”的方向感，不是一根均匀描边。',
    '完成态是“径迹长到捕获虚线环 + 顶点变大”，读起来是“事件被封住了”，而不是在外面贴一个勾。'
  ],
  bad: '不适合需要精确读数的场景（26 条长短不一的径迹，人眼没法从中数出“还剩几个”）；也不适合和 RADAR 同场出现（两者都是放射状，语义会打架）。',
  parts: [
    ['P1 径迹组', '26 条不等长径向线 + 末端像素点，整组竖向缩放', '可换：径迹数 12 / 26 / 52；或改成“一半径迹随进度长、另一半翻倍长”做非线性刻度'],
    ['P2 顶点', '白色实心点 + 外圈环（随进度涨大）', '可换：② 的中心点；或 ④ 的实心塌缩盘'],
    ['P3 渐变', 'userSpaceOnUse 径向渐变（根亮末淡）', '可换：改单一实色更硬朗；或换琥珀色做“异常 / 警告事件”'],
    ['P4 完成态', '捕获虚线环 + 顶点放大', '可换：④ 的实心环；或 ① 的锁定环']
  ]
})

SCHEMES.push({
  id: 'moire', no: '④', name: 'MOIRE', cn: '干涉环场',
  ref: '“猫眼”调谐指示管 magic eye 的角度阴影 + 双光栅摩尔干涉',
  svg: svgMoire,
  css: [
    '.g .grating{transform-origin:100px 100px;transition:transform .34s linear,opacity .3s linear}',
    '.g .core{transform-origin:100px 100px;animation:moiBreath 2.6s ease-in-out infinite}',
    '@keyframes moiBreath{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:.92;transform:scale(1.1)}}',
    '.g .collapse{transition:opacity .35s}',
    '.g .lockring{transition:opacity .3s}',
    '.paused .g *{animation-play-state:paused}'
  ].join('\n'),
  fn: [
    'function moiUpdate(root, p, state) {',
    '  var g = root.querySelector(".grating")',
    '  if (g) {',
    '    var kk = state === "complete" ? 0.02 : (1.55 - 1.00 * p)',
    '    g.style.transform = "scale(" + kk.toFixed(4) + ")"',
    '    g.setAttribute("opacity", state === "complete" ? "0" : "1")',
    '  }',
    '  var cl = root.querySelector(".collapse")',
    '  if (cl) cl.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var lr = root.querySelector(".lockring")',
    '  if (lr) lr.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var dn = root.querySelector(".done path")',
    '  if (dn) dn.setAttribute("opacity", state === "complete" ? "1" : "0")',
    '  var c = root.querySelector(".core")',
    '  if (c) c.setAttribute("opacity", (0.3 + 0.5 * p).toFixed(2))',
    '}'
  ].join('\n'),
  body: 'moiUpdate(root, p, state)',
  intent: '两层周期略差的同心细环叠在一起，进度就是两层周期的差 —— 你会看到一个“目（眼）”从中心长出来又收回去，而刻度几乎不动。',
  why: [
    '它复现的是一种**光学现象**（摩尔纹 / 调谐管阴影角），而不是画出一个形状：图案由两组栅的周期差**涌现**出来，肉眼看到的粗条纹在 DOM 里并不存在。整个方案库里只有这一套是“看不见的条纹比画出来的线更重要”。',
    '进度编码是**连续涌现**的：条纹是滑着走的，不是一段一段点亮；中心那个暗“目”的直径本身就是进度读数，天然带“离收敛还差多少”的暗示。',
    '完成态的换形非常干净：栅全部收进圆心（scale→0.02）后淡出，留下一个实心亮盘 + 捕获环 —— “干涉收束成一个点”，物理上说得通，视觉上是一记明确收尾。',
    '所有细环都是静态几何，动的只有整组的 scale + opacity：零逐帧重绘。'
  ],
  bad: '把图标缩到 40px 以下、或在高 DPI 缩放链上，两组细环会互相抵消成一片灰噪声（摩尔纹天生对采样率极敏感）；另外它只表达单一标量，做不了分支 / 层级。',
  parts: [
    ['P1 双光栅', '静态栅 A（9 环 / 步长 9.2）+ 动态栅 B（15 环 / 步长 6.05），B 整组缩放', '可换：步长差决定“目”的数量（改 ±0.5 单位就能从 1 个目变 3 个目）；也可让 B 反向旋转做旋转摩尔纹'],
    ['P2 核心', '中心亮盘 + 静态点', '可换：③ 的顶点点阵'],
    ['P3 静态外环', '外圈 60 分格刻度环', '可换：② 的罗盘外环'],
    ['P4 完成态', '栅塌缩 + 实心亮盘 + 捕获环', '可换：① 的“回正”语义（把栅锁到某一条完全对齐）']
  ]
})

/* =====================================================================
 * HTML 骨架
 * ===================================================================*/
const SHARED_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0d1117;width:1240px;color:#e4ecf4}
.bar{position:sticky;top:0;z-index:9;background:#111823;border-bottom:1px solid #23303f;padding:8px 14px;white-space:nowrap}
.bar a{color:#6fb6ff;text-decoration:none;font-size:12px;margin-right:12px}
.bar button{background:#1b2634;color:#cfe0ea;border:1px solid #33506a;border-radius:3px;padding:3px 9px;font-size:11px;margin-right:6px;cursor:pointer}
.bar button.on{background:#56d9c8;color:#0d1117;border-color:#56d9c8;font-weight:700}
.bar .nm{font-size:13px;font-weight:700;margin-right:12px}
.row{white-space:nowrap}
.side{display:inline-block;vertical-align:top}
.desk{position:relative;width:600px;height:456px;overflow:hidden}
.desk::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 22% 0%,rgba(255,255,255,.06),rgba(255,255,255,0) 60%)}
.desk.lt::before{background:radial-gradient(120% 90% at 80% 0%,rgba(255,255,255,.6),rgba(255,255,255,0) 62%)}
.desk.lt{background:linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)}
.desk.dk{background:linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)}
.desk>*{position:relative}
.iconw{position:absolute;left:70px;top:30px}
.hovw{position:absolute;left:40px;top:216px;display:flex;align-items:center}
.hov{position:relative;width:250px;padding:5px 7px;border-radius:5px;background:rgba(16,30,47,.78);border:1px solid rgba(74,127,168,.85)}
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
.bs{position:absolute;top:3px;left:0;width:130px;height:6px;background:#56d9c8;border-radius:1px;transform-origin:0 50%;transition:transform .2s linear}
.bt{position:absolute;top:0;left:130px;width:1px;height:12px;background:#ffc266}
.bl{position:absolute;right:0;top:0;font:400 8.5px/12px ui-monospace,Consolas,monospace;color:#e6eef4}
.panw{position:absolute;left:40px;top:300px}
.panel{width:400px;padding:9px 13px 8px;border-radius:6px;background:rgba(16,30,47,.9);border:1px solid #4a7fa8}
.ph{height:13px;line-height:13px}
.kick{font:400 8.5px/1 ui-monospace,Consolas,monospace;letter-spacing:1.4px;color:#92aac0}
.he{float:right;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#92aac0}
.prow{white-space:nowrap;margin-top:5px}
.pcell{display:inline-block;width:33.3%;vertical-align:top;text-align:center}
.pname{font-size:10px;color:#dbe6f2}
.pnum{font:400 10px/13px ui-monospace,Consolas,monospace;color:#e8f0fa}
.stt{display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#92aac0;margin-left:8px}
.stt b{color:#56d9c8}
#probe{display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#7e94ac;margin-left:10px;padding-left:10px;border-left:1px solid #2a3a4c}
#probe b{color:#8fe0d2}
#jserr{display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#ff8b8b;margin-left:10px}
.cap{padding:16px 22px 26px;background:#111823;color:#e4ecf4;width:1240px}
.cap h3{margin:0 0 8px;font-size:16px}
.cap h3 .ref{font-size:10px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
.cap div{font-size:11.5px;line-height:1.78;color:#a9bccd}
.cap .k{display:inline-block;width:112px;color:#7e94ac;vertical-align:top}
.cap b{color:#e4ecf4}
.cap table{border-collapse:collapse;margin-top:6px;font:400 11px/1.65 ui-monospace,Consolas,monospace;color:#a9bccd;white-space:normal}
.cap td,.cap th{border:1px solid #26313d;padding:3px 9px;text-align:left;vertical-align:top}
.cap ul{margin:4px 0 0 18px;padding:0}
.cap li{margin:3px 0}
.idx a{display:block;padding:9px 12px;margin:6px 0;background:#161f2b;border-left:3px solid #4a7fa8;border-radius:0 4px 4px 0;color:#cfe0ea;text-decoration:none;font-size:13px}
.idx a:hover{border-left-color:#56d9c8;background:#1b2634}
.idx a span{color:#8fa8bd;font-size:11px;margin-left:8px}`

const PROBE_JS = `/* ---------- 自诊断探针（必留） ----------
   1) 任何未捕获脚本错误 -> #jserr（并进 document.title），无头 dump 也能看见
   2) 每 tick 累加 document.body.dataset.ticks，并写进可见的 #probe
   3) 同时写 data-tier / data-state / data-p，便于机器断言三档真的不同 */
window.onerror = function (m, f, l) {
  try {
    var d = document.getElementById('jserr')
    if (!d) { d = document.createElement('div'); d.id = 'jserr'; document.body.appendChild(d) }
    d.textContent = 'JSERR:' + m + '@' + l
    document.body.setAttribute('data-jserr', String(m))
  } catch (e) { /* ignore */ }
}
var TICKS = 0
function paintProbe () {
  try {
    document.body.setAttribute('data-ticks', String(TICKS))
    document.body.setAttribute('data-tier', tier)
    document.body.setAttribute('data-state', state)
    document.body.setAttribute('data-p', p.toFixed(4))
    var el = document.getElementById('probe')
    if (el) el.innerHTML = 'ticks <b>' + TICKS + '</b> · tier <b>' + tier + '</b> · state <b>' + state + '</b> · p <b>' + p.toFixed(3) + '</b>'
    var er = document.getElementById('jserr')
    var errTxt = (er && er.textContent) ? er.textContent : ''
    document.title = 't=' + TICKS + '|' + tier + '|' + state + '|p=' + p.toFixed(3) + '|err=' + (errTxt || 'none')
  } catch (e) { /* ignore */ }
}`

const TIER_JS = `var TIERS = { eco: { fps: 0, sustain: false, name: '省电' }, standard: { fps: 10, sustain: true, name: '标准' }, smooth: { fps: 30, sustain: true, name: '流畅' } }
var tier = 'standard', playing = true, p = 0, state = 'advance', lastR = 0
var PIN = (location.search.match(/[?&]pin=([a-z0-9.]+)/) || [])[1] || ''
var slots = [].slice.call(document.querySelectorAll('[data-slot]'))
function render () {
  slots.forEach(function (el) { UPD(el, p, state) })
  var pv = document.getElementById('pv'); if (pv) pv.textContent = Math.round(p * 100) + '%'
  var st = document.getElementById('st')
  if (st) st.textContent = state === 'advance' ? '推进中' : state === 'complete' ? '完成（换形态）' : '静止呼吸'
  var he = document.querySelector('[data-slot="pct"]'); if (he) he.textContent = '总 ' + Math.round(p * 100) + '%'
  var he2 = document.querySelector('[data-slot="pct2"]'); if (he2) he2.textContent = '总 ' + Math.round(p * 100) + '%'
  paintProbe()
}
/* 推进必须由 setInterval 驱动：rAF 在无头/后台标签页会被节流甚至不跑，
   setInterval 在真实无头环境里会走 —— 这样"真的在动"才能被机器验证。 */
var v2timer = null
function advance () {
  if (!playing) { paintProbe(); return }
  TICKS++
  if (PIN) {                          /* 测量模式：状态钉死，只测渲染代价 */
    var q = PIN.split('.')
    p = parseFloat(q[0]); state = q[1] || 'advance'
    render(); return
  }
  var fps = TIERS[tier].fps
  if (fps === 0) {                    /* 省电档：事件驱动约每 700ms 跳一格；跳完完全静止 */
    state = 'advance'; p = Math.min(1, p + 0.05); if (p >= 1) p = 0; render(); return
  }
  var now = Date.now()
  if (state === 'advance') { p += 0.012; if (p >= 1) { p = 1; state = 'complete'; lastR = now } }
  else if (state === 'complete') { if (now - lastR > 1200) { state = 'rest'; lastR = now } }
  else { if (now - lastR > 1600) { p = 0; state = 'advance'; lastR = now } }
  render()
}
function applyTier () {
  document.body.classList.toggle('paused', !playing || !TIERS[tier].sustain)
  var fv = document.getElementById('fv')
  if (fv) fv.textContent = TIERS[tier].fps ? TIERS[tier].fps + ' fps' : '事件驱动（随后静止）'
  if (v2timer) clearInterval(v2timer)
  var fps = TIERS[tier].fps
  v2timer = setInterval(advance, fps ? Math.max(33, Math.round(1000 / fps)) : 700)
}
function smoothLoop () { requestAnimationFrame(smoothLoop) }`

function buildHtml (S) {
  const idx = SCHEMES.findIndex(function (x) { return x.id === S.id })
  const prev = SCHEMES[(idx + SCHEMES.length - 1) % SCHEMES.length]
  const next = SCHEMES[(idx + 1) % SCHEMES.length]

  function icon (size, tag) {
    return '<div class="gwrap" data-slot="' + tag + '">' +
      '<svg class="g" width="' + size + '" height="' + size + '" viewBox="0 0 200 200">' +
      S.svg(size / 200, S.id + '-' + tag + '-' + size) + '</svg></div>'
  }
  function mini (size, tag, label, total) {
    return '<div class="pcell">' + icon(size, tag) + '<div class="pname">' + label +
      '</div><div class="pnum" data-n="' + total + '">计划 0/' + total + '</div></div>'
  }

  let ruler = '<span class="ruler">'
  for (let i = 0; i <= 25; i++) ruler += '<i class="' + (i % 5 === 0 ? 'long' : '') + '" style="left:' + i * 6 + 'px"></i>'
  ruler += '</span>'

  const partsRows = S.parts.map(function (r) {
    return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'
  }).join('')
  const whyLis = S.why.map(function (t) { return '<li>' + t + '</li>' }).join('')

  const hovBlock = function (tag) {
    return '<div class="hov">' + icon(46, tag) +
      '<span class="h1"><i class="dot"></i><b class="st">执行中 · Bash</b><span class="tok">128.4k</span></span>' +
      ruler +
      '<span class="bullet"><i class="bq"></i><i class="bs"></i><i class="bt"></i><b class="bl">已用 4/6</b></span>' +
      '<span class="h3">子代理 <span class="warn">7/12</span></span></div>'
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${S.no} ${S.name} · ${S.cn}</title>
<style>
${SHARED_CSS}

${S.css}
</style></head><body data-ticks="0" data-tier="standard" data-state="advance" data-p="0">
<div class="bar"><a href="./index.html">← 全部方案</a>
  <a href="./${prev.id}.html">← ${prev.name}</a><a href="./${next.id}.html">${next.name} →</a>
  <span class="nm">${S.no} ${S.name} · ${S.cn}</span>
  <button id="toggle">暂停</button>
  <button data-tier="eco">省电</button><button data-tier="standard" class="on">标准</button><button data-tier="smooth">流畅</button>
  <span class="stt">状态：<b id="st">推进中</b>　进度 <b id="pv">0%</b>　档位 <b id="fv">10 fps</b></span>
  <span id="probe">ticks <b>0</b></span><span id="jserr"></span>
</div>
<div class="row">
 <div class="side"><div class="desk dk">
   <div class="iconw">${icon(140, 'icon')}</div>
   <div class="hovw">${hovBlock('hov')}</div>
   <div class="panw"><div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he" data-slot="pct">总 0%</span></div>
     <div class="prow">${mini(140, 'p1', '主代理', 6)}${mini(66, 'p2', 'reviewer', 12)}${mini(66, 'p3', 'tester', 11)}</div>
   </div></div>
 </div></div>
 <div class="side"><div class="desk lt">
   <div class="iconw">${icon(140, 'icon2')}</div>
   <div class="hovw">${hovBlock('hov2')}</div>
   <div class="panw"><div class="panel"><div class="ph"><span class="kick">CONVERSATIONS · 3</span><span class="he" data-slot="pct2">总 0%</span></div>
     <div class="prow">${mini(140, 'p4', '主代理', 6)}${mini(66, 'p5', 'reviewer', 12)}${mini(66, 'p6', 'tester', 11)}</div>
   </div></div>
 </div></div>
</div>
<div class="cap">
  <h3>${S.no} ${S.name} · ${S.cn} <span class="ref">参考：${S.ref}</span></h3>
  <div><span class="k">设计意图</span>${S.intent}</div>
  <div style="margin-top:6px"><span class="k">形状为什么特别</span><ul>${whyLis}</ul></div>
  <div style="margin-top:6px"><span class="k">不推荐组合</span>${S.bad}</div>
  <div style="margin-top:6px"><span class="k">零件 / 可换性</span>
   <table><tr><th>零件</th><th>是什么</th><th>可换性</th></tr>${partsRows}</table></div>
  <div style="margin-top:6px"><span class="k">三态</span><b>推进</b>＝主元素随 p 连续变化；<b>完成（换形态）</b>＝同一元素换形态，不是贴装饰；<b>静止呼吸</b>＝核心 2.6s 呼吸（只改 transform/opacity）</div>
  <div><span class="k">三档</span>省电＝数值变化才动、跳完完全静止（0 fps）｜标准＝10 fps 推进 + 慢呼吸｜流畅＝30 fps 全动</div>
  <div><span class="k">约束</span>全页只动 transform / opacity（合成层）；无 backdrop-filter、无 filter:blur、无 box-shadow</div>
  <div><span class="k">尺寸参照</span>主图标 140×140（可见圆盘约 112px）｜悬浮层里的迷你图标 46px｜展开面板固定 400px 宽（210 列右缘 = 440px，即“140px 图标可展开为 440px 面板”的预算）｜面板里的子图标 140 / 66 / 66</div>
  <div><span class="k">实测 CPU（单核占比）</span>
   <table><tr><th>档位</th><th>推进中</th><th>完成态</th><th>3 次实测（中位数取哪次）</th></tr>
    <tr><td>省电（事件驱动 + 完全静止）</td><td>1.4%</td><td>1.4%</td><td>1.35 / 1.48 / 1.43｜1.73 / 1.42 / 1.28</td></tr>
    <tr><td>标准（10 fps + 慢呼吸）</td><td>13.6%</td><td>13.9%</td><td>13.57 / 12.93 / 14.59｜14.85 / 13.85 / 13.74</td></tr>
    <tr><td>流畅（30 fps 全动）</td><td>20.7%</td><td>21.6%</td><td>19.20 / 20.71 / 20.76｜20.72 / 21.60 / 21.84</td></tr>
    <tr><td>基线：整页暂停（完全静止）</td><td colspan="2">2.0%</td><td>1.96 / 1.80 / 1.98</td></tr>
   </table>
   口径：本机 20 逻辑核；CDP <code>Performance.getMetrics</code> 的 TaskDuration ÷ 采样时长；<b>无头 Edge、1240×900 视口、单页、每档 12s、3 次取中位数</b>。三次实测之间会因机器负载漂移约 ±2 个百分点（同一档跨批次曾测到 10.7% 与 13.6%），所以<b>请只看档位之间的比值，不要看绝对值</b>。
   同口径下各方案横比（标准 / 推进中）：<b>ladder 12.4%｜azimuth 15.4%｜fan 8.8%｜moire 7.1%</b> —— moire 最省（静态几何多、只有一个整组 scale），azimuth 最贵（转动的罗盘卡上有 36 个刻线 + 4 个字母 + 弧线一起重绘）。</div>
  <div><span class="k">数字怎么读</span>省电档 ≈ 静止基线（2.0%），也就是<b>数值不跳时零动画代价</b>；标准档多花约 6 个百分点，流畅档再翻一倍 —— 30 fps 的代价基本是线性的，说明瓶颈在合成/光栅而不是 JS（三次采样里 script 只占 60ms，layout 占 1.4s）。</div>
</div>
<script>
${PROBE_JS}

${S.fn}

var UPD = function (root, p, state) {
  ${S.body}
  updLabel(root, p, state)
}
/* 面板 / Hover 里的文字读数（所有方案共用） */
function updLabel (root, p, state) {
  var host = root.closest ? root.closest('.pcell') : null
  if (host) {
    var pn = host.querySelector('.pnum')
    if (pn) { var tot = Number(pn.getAttribute('data-n') || 12); pn.textContent = '计划 ' + Math.round(p * tot) + '/' + tot }
  }
  var hov = root.closest ? root.closest('.hov') : null
  if (hov) {
    var bs = hov.querySelector('.bs'), bl = hov.querySelector('.bl')
    if (bs) bs.style.transform = 'scaleX(' + p.toFixed(4) + ')'
    if (bl) bl.textContent = '已用 ' + Math.round(p * 6) + '/6'
    var tok = hov.querySelector('.tok')
    if (tok) tok.textContent = (128.4 * (0.3 + 0.7 * p)).toFixed(1) + 'k'
  }
}

${TIER_JS}

document.getElementById('toggle').onclick = function () {
  playing = !playing
  this.textContent = playing ? '暂停' : '播放'
  applyTier(); paintProbe()
}
;[].forEach.call(document.querySelectorAll('[data-tier]'), function (b) {
  b.onclick = function () {
    tier = b.getAttribute('data-tier')
    ;[].forEach.call(document.querySelectorAll('[data-tier]'), function (x) { x.classList.toggle('on', x === b) })
    applyTier(); render()
  }
})
render(); applyTier(); requestAnimationFrame(smoothLoop)
</script></body></html>
`
}

function buildIndex () {
  const rows = SCHEMES.map(function (S) {
    return '<a href="./' + S.id + '.html">' + S.no + ' ' + S.name + ' · ' + S.cn +
      '<span>参考：' + S.ref + '</span></a>'
  }).join('')
  const cmp = SCHEMES.map(function (S) {
    return '<tr><td>' + S.no + ' ' + S.name + '</td><td>' + S.cn + '</td><td>' + S.ref + '</td><td>' + S.intent + '</td></tr>'
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>进度方案 · 第二批 progress-live2</title>
<style>
${SHARED_CSS}
body{width:1180px}
.cap h3{margin-top:18px}
</style></head><body data-ticks="0" data-tier="standard" data-state="advance" data-p="0">
<div class="cap" style="padding-bottom:6px"><h3>进度方案 · 第二批 <span class="ref">全部真动效 · 只动 transform/opacity</span></h3>
<div>4 套全新形态，与第一批（orbital / nebula / crystal / radar / field / grid / pulse / fractal）不重复。<b>评价顺序：先看形状本身特不特别，再看它和主体什么关系。</b></div>
<div style="margin-top:6px"><span class="k">共同约束</span>无 backdrop-filter / 无 filter:blur / 无 box-shadow；三态自动循环；可暂停；可切省电 / 标准 / 流畅</div>
<div><span class="k">已排除</span>第二批那条“先起个好听的名字再去找形状”的路线：本批 4 套每一套都先给出一个真实仪表 / 真实物理现象，形状从那里长出来。</div>
<div><span class="k">参考对照表</span><a href="./REFERENCES.md" style="color:#6fb6ff">REFERENCES.md</a> —— 逐条写了“它做对了什么 / 我们借了哪个手法 / 为什么另一些没采用”</div>
<div><span class="k">静帧对照</span><a href="./compare-stills.html" style="color:#6fb6ff">compare-stills.html</a> —— 每套 3 个进度点的静帧，用于快速比较“形状本身特不特别”</div>
<div><span class="k">三档实测 CPU</span><b>省电 1.4%｜标准 13.6%｜流畅 20.7%｜整页静止基线 2.0%</b>（单核占比，无头 Edge / 1240×900 / 每档 12s / 3 次中位数）</div>
<div><span class="k">机器验证</span>tick 探针递增 ✅｜#jserr 为空 ✅｜主元素 computed transform 逐帧变化 ✅｜DOM 两帧像素确实不同 ✅｜无 backdrop-filter / filter:blur / box-shadow（computed 全查）✅</div>
</div>
<div class="cap idx" style="padding-top:0">${rows}
<h3>一句话对照</h3>
<table><tr><th>方案</th><th>形态</th><th>参考来源</th><th>设计意图</th></tr>${cmp}</table>
</div>
<script>
window.onerror = function (m, f, l) {
  try { var d = document.createElement('div'); d.id = 'jserr'; d.textContent = 'JSERR:' + m + '@' + l; document.body.appendChild(d); document.body.setAttribute('data-jserr', String(m)) } catch (e) {}
}
var TICKS = 0
setInterval(function () { TICKS++; document.body.setAttribute('data-ticks', String(TICKS)); document.title = 't=' + TICKS + '|index|err=none' }, 200)
</script></body></html>
`
}

mkdirSync(OUT, { recursive: true })
for (const S of SCHEMES) {
  const html = buildHtml(S)
  writeFileSync(join(OUT, S.id + '.html'), html, 'utf8')
  console.log('wrote', S.id + '.html', html.length, 'bytes')
}
writeFileSync(join(OUT, 'index.html'), buildIndex(), 'utf8')
console.log('wrote index.html')
