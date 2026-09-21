/* ring-proto generator
 * 目标：把 ORBITAL 环做成“进度环”，套在现有悬浮窗图标最外圈。
 *
 * ⚠️ 只读 runtime/electron/index.html 提取资产，绝不写回。
 *    - <g id="base-h2">：H2「等离云核」的 7 层几何，**一字未改**
 *    - 七态配色 .st-*、粒子表 PT、halo() 采样：与产品同源，保证原型里看到的颜色/密度就是真的
 *
 * 交付 2 个版本：
 *   v1-reuse-arcs  ① 让图标【现有那几段弧】直接成为进度（零几何代价，尺寸/命中区/点击穿透全不动）
 *   v2-outer-ring  ② 环在最外圈另起一层（r=88，夹在 tick 环 r=94 与分段环 r=60 之间），现有弧保持原样自转
 *
 * 约定（与 runtime 一致，避免"看起来像但参数不对"）：
 *   · 图标 viewBox 0 0 200 200，产品默认渲染 144px（用户口径 140px；两者几何完全一致，只是缩放不同）
 *   · 现有弧 = <g class="seg"> 内 r=60、stroke-width=2、dasharray "40 16 8 16" 的那一圈
 *   · 旋转轴心 = 50% 50% + transform-box:view-box（与产品同一条，绝不用 rotate(a 100 100) 双轴心）
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'

const SRC = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/runtime/electron/index.html'
const OUT = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto'

/* ---------- 1) 只读提取真实资产 ---------- */
const src = readFileSync(SRC, 'utf8')
const m = src.match(/<g id="base-h2">[\s\S]*?<\/g>\s*<\/defs>/)
if (!m) throw new Error('base-h2 not found in runtime index.html')
const BASE_H2 = m[0].replace(/\s*<\/defs>$/, '').trim()
/* 去掉 id="base-h2"（克隆时不能重复 id），保留内部结构一字不改 */
const BASE_H2_NOID = BASE_H2.replace('<g id="base-h2">', '<g class="baseroot">')
console.log('extracted base-h2:', BASE_H2.length, 'chars')

const PT = {
  IDLE: { n: 36, R: [80, 96] },
  THINKING: { n: 62, R: [76, 94] },
  WORKING: { n: 98, R: [72, 92] },
  WAITING: { n: 52, R: [80, 97] },
  SUCCESS: { n: 98, R: [72, 92] },
  ERROR: { n: 98, R: [72, 92] },
  DISCONNECTED: { n: 36, R: [80, 96] }
}
const COLOR = {
  IDLE: ['#3d7688', '#1b3b47', 'rgba(80,190,220,.20)', 0.13, '空闲'],
  THINKING: ['#38e8ff', '#176c85', 'rgba(56,232,255,.55)', 0.42, '思考中'],
  WORKING: ['#5cffd0', '#128f78', 'rgba(92,255,208,.62)', 1, '执行中'],
  WAITING: ['#ffb340', '#a35a08', 'rgba(255,179,64,.62)', 0.55, '待确认'],
  SUCCESS: ['#8dffae', '#1f9b5a', 'rgba(141,255,174,.55)', 1, '完成'],
  ERROR: ['#ff4d6d', '#8e0f2a', 'rgba(255,77,109,.62)', 0.7, '出错'],
  DISCONNECTED: ['#5a636e', '#2b3138', 'rgba(140,150,160,.16)', 0.2, '离线']
}

/* 与 runtime 完全同源的确定性随机 + halo 采样 */
function makeRnd (seed) { let s = (seed >>> 0) || 1; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff } }
function halo (rnd, R) {
  const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u)
  const rad = R[0] + rnd() * (R[1] - R[0])
  return { x: 100 + rad * s * Math.cos(th), y: 100 + rad * u * 0.94, z: (Math.sin(th) * s + 1) / 2 }
}
function cloudDots (st) {
  const pt = PT[st]
  const rnd = makeRnd(90210 + 777 + st.charCodeAt(0) * 131)
  const ps = []
  for (let k = 0; k < pt.n; k++) ps.push(halo(rnd, pt.R))
  ps.sort((a, b) => a.z - b.z)
  return ps.map(p => '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (0.85 + p.z * 1.5).toFixed(2) +
    '" fill="var(--c1)" opacity="' + (0.26 + 0.74 * p.z).toFixed(2) + '"/>').join('')
}

/* ---------- 2) 一层的完整几何（真资产 + 进度环插槽） ---------- */
const C_SEG = 2 * Math.PI * 60   // 现有弧 r=60 的周长
const C_OUT = 2 * Math.PI * 88   // 外圈进度环 r=88 的周长

function layerSvg (st, variant) {
  const uid = st + variant
  const cloud = cloudDots(st)
  const isV1 = variant === 'v1'
  /* 进度弧：v1 直接用现有弧那一圈（r=60, w=2）；v2 在最外圈另起一层（r=88, w=2.4） */
  const R = isV1 ? 60 : 88
  const W = isV1 ? 2 : 2.4
  const C = isV1 ? C_SEG : C_OUT
  const cls = isV1 ? 'seg progv1' : 'outer progv2'
  return `
<g id="layer-${uid}" class="lyr lyr-${st}" data-st="${st}">
  <defs>
    <radialGradient id="plateGrad-${uid}">
      <stop offset="0%" stop-color="#050809" stop-opacity=".86"/>
      <stop offset="82%" stop-color="#050809" stop-opacity=".5"/>
      <stop offset="100%" stop-color="#050809" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="flashGrad-${uid}">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity=".35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="burstGrad-${uid}">
      <stop offset="0%" stop-color="var(--c1)" stop-opacity="0"/>
      <stop offset="72%" stop-color="var(--c1)" stop-opacity="0"/>
      <stop offset="88%" stop-color="var(--c1)" stop-opacity=".85"/>
      <stop offset="100%" stop-color="var(--c1)" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <circle class="plate" cx="100" cy="100" r="97" fill="url(#plateGrad-${uid})"/>
  <circle class="tick" cx="100" cy="100" r="94" fill="none" stroke="var(--c2)" stroke-width="1" stroke-dasharray="1.5 7"/>
  <g class="cloud">${cloud}</g>

  ${isV1 ? '' : `<g class="seg base">
    <circle cx="100" cy="100" r="60" fill="none" stroke="var(--c1)" stroke-width="2"
            stroke-dasharray="40 16 8 16" stroke-linecap="round"/>
  </g>`}

  <!-- ===== 进度环（本原型的唯一新增几何） ===== -->
  <g class="prog ${cls}">
    <circle class="ptrack" cx="100" cy="100" r="${R}" fill="none" stroke="var(--c1)" stroke-opacity=".16"
            stroke-width="${W}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0" transform="rotate(-90 100 100)"/>
    <circle class="pfill" cx="100" cy="100" r="${R}" fill="none" stroke="var(--c1)"
            stroke-width="${W}" stroke-linecap="butt" stroke-dasharray="0 ${C.toFixed(1)}" stroke-dashoffset="0"
            transform="rotate(-90 100 100)"/>
    <circle class="pmark" cx="100" cy="100" r="${R}" fill="none" stroke="#ffc266" stroke-width="${(W + 0.6).toFixed(1)}"
            stroke-dasharray="1.6 ${(C - 1.6).toFixed(1)}" stroke-dashoffset="0" opacity="0"/>
    <g class="prun"><circle cx="100" cy="${(100 - R).toFixed(1)}" r="${(W * 1.35).toFixed(2)}" fill="#e8f0fa"/></g>
  </g>

  <circle class="inner" cx="100" cy="100" r="48" fill="none" stroke="var(--c2)" stroke-width="1"/>
  <circle class="glow glowA" cx="100" cy="100" r="44" fill="var(--c1)"/>
  <circle class="glow glowB" cx="100" cy="100" r="44" fill="var(--c1)" opacity="0"/>

  <!-- 完成态：收束 → 爆散（三件都是静态几何 + transform/opacity） -->
  <g class="burstg">
    <circle class="burstring" cx="100" cy="100" r="34" fill="none" stroke="var(--c1)" stroke-width="2" opacity="0"/>
    <circle class="bursthalo" cx="100" cy="100" r="34" fill="url(#burstGrad-${uid})" opacity="0"/>
    <circle class="burstcore" cx="100" cy="100" r="26" fill="var(--c1)" opacity="0"/>
  </g>

  <g class="core">
    <path d="M100 70 L126 116 L74 116 Z" fill="none" stroke="var(--c1)" stroke-width="2.6"
          stroke-linejoin="round" opacity="${COLOR[st][3]}"/>
    <circle cx="100" cy="100" r="12" fill="var(--c1)" opacity="${COLOR[st][3]}"/>
  </g>
  <circle class="flash" cx="100" cy="100" r="62" fill="url(#flashGrad-${uid})" opacity="0"/>
</g>`
}

/* ---------- 3) 共享 CSS ---------- */
const CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0d1117;color:#e4ecf4;width:1260px}
.bar{position:sticky;top:0;z-index:9;background:#111823;border-bottom:1px solid #23303f;padding:8px 14px;white-space:nowrap}
.bar a{color:#6fb6ff;text-decoration:none;font-size:12px;margin-right:12px}
.bar button{background:#1b2634;color:#cfe0ea;border:1px solid #33506a;border-radius:3px;padding:3px 9px;font-size:11px;margin-right:6px;cursor:pointer}
.bar button.on{background:#56d9c8;color:#0d1117;border-color:#56d9c8;font-weight:700}
.bar .nm{font-size:13px;font-weight:700;margin-right:12px}
#probe{display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#7e94ac;margin-left:10px;padding-left:10px;border-left:1px solid #2a3a4c}
#probe b{color:#8fe0d2}
#jserr{display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#ff8b8b;margin-left:10px}
.row{white-space:nowrap}
.side{display:inline-block;vertical-align:top}
.desk{position:relative;width:620px;height:300px;overflow:hidden}
.desk.dk{background:linear-gradient(158deg,#3c4147,#33383e 46%,#292d32)}
.desk.lt{background:linear-gradient(158deg,#eceae5,#dedbd4 52%,#cfccc5)}
.iconw{position:absolute;left:26px;top:26px}
.hovw{position:absolute;left:26px;top:196px}
.panw{position:absolute;left:300px;top:40px}

/* ===== 图标本体（几何与 runtime 完全一致） ===== */
.ico{display:block}
/* 与 runtime 同一条：轴心 50% 50% + transform-box:view-box（绝不用 rotate(a 100 100) 双轴心） */
.cloud,.seg,.prun{will-change:transform;transform-origin:50% 50%;transform-box:view-box}
body[data-freeze="1"] .cloud,body[data-freeze="1"] .seg,body[data-freeze="1"] .prun{will-change:auto}
.core{transform:none}
.pfill,.ptrack,.pmark{transition:none}
.pmark{transition:opacity .25s linear}
/* 完成态爆散：静态几何 + scale/opacity（无 blur、无 box-shadow、无 backdrop-filter） */
.burstring,.bursthalo,.burstcore{transform-origin:50% 50%;transform-box:view-box}
.lyr{display:none}
/* 状态由 SVG 根上的 .st-* 单选（与 runtime 的 .layer.st-* 同一手法），只显示这一态那 7 层 */
.st-IDLE .lyr-IDLE,.st-THINKING .lyr-THINKING,.st-WORKING .lyr-WORKING,.st-WAITING .lyr-WAITING,
.st-SUCCESS .lyr-SUCCESS,.st-ERROR .lyr-ERROR,.st-DISCONNECTED .lyr-DISCONNECTED{display:inline}
/* 七态配色：逐项照抄 runtime 的 .st-*（c1 / c2 / core） */
.st-IDLE        {--c1:#3d7688;--c2:#1b3b47;--glow:rgba(80,190,220,.20);--core:.13}
.st-THINKING    {--c1:#38e8ff;--c2:#176c85;--glow:rgba(56,232,255,.55);--core:.42}
.st-WORKING     {--c1:#5cffd0;--c2:#128f78;--glow:rgba(92,255,208,.62);--core:1}
.st-WAITING     {--c1:#ffb340;--c2:#a35a08;--glow:rgba(255,179,64,.62);--core:.55}
.st-SUCCESS     {--c1:#8dffae;--c2:#1f9b5a;--glow:rgba(141,255,174,.55);--core:1}
.st-ERROR       {--c1:#ff4d6d;--c2:#8e0f2a;--glow:rgba(255,77,109,.62);--core:.7}
.st-DISCONNECTED{--c1:#5a636e;--c2:#2b3138;--glow:rgba(140,150,160,.16);--core:.2}
/* 核心辉光：runtime 用 SVG opacity="calc(var(--core) * .2)"（现代 Chromium 支持），
   但 --core 必须定义在同一个 SVG 根上才解析得到 —— 上面的 .st-* 就挂在 SVG 根上。 */
.glowA{opacity:calc(var(--core,.55) * .2)}

/* ===== 悬浮层（1:1 抄 runtime 的 v2hover 口径：272 宽 / plate 底） ===== */
#hov{position:absolute;width:272px;padding:5px 7px;border-radius:5px;background:rgba(16,30,47,.78);
  border:1px solid rgba(74,127,168,.85);font-family:ui-monospace,Consolas,monospace;pointer-events:none}
#hov .r1{height:15px;line-height:15px;white-space:nowrap}
#hov .st{font-size:12.5px;font-weight:700;color:#f4f8fa}
#hov .tok{float:right;font-size:9px;color:#cfe0ea}
#hov .h3{display:block;height:12px;line-height:12px;font-size:9.5px;color:#bcd0dd;white-space:nowrap;overflow:hidden}
#hov .r2{display:block;height:15px;line-height:15px;font-size:10px;color:#cfdcea;white-space:nowrap}
#hov .r2 .k{color:#8fa8bd}
#hov .r2 .v{color:#e8f0fa;font-variant-numeric:tabular-nums}
#hov .r3{display:block;height:13px;line-height:13px;font-size:9px;color:#ffc266;white-space:nowrap;overflow:hidden}
#hov .r3:empty{display:none}
#hov .r3 .a{color:#7fe3c8}
/* 子弹图（与 runtime .v2bullet 同款：区间底 + 实际值 scaleX + 上限竖线） */
.bl2{position:relative;display:block;height:13px}
.bl2 .bq{position:absolute;left:0;top:3px;height:6px;background:rgba(232,244,252,.2);border-radius:1px;width:258px}
.bl2 .bs{position:absolute;top:3px;left:0;height:6px;background:#56d9c8;border-radius:1px;width:258px;
  transform-origin:0 50%;transform:scaleX(0)}
.bl2 .bt{position:absolute;top:0;width:1px;height:12px;background:#ffc266;left:258px}
.bl2 .bl{position:absolute;right:0;top:0;font-size:8.5px;line-height:13px;color:#e6eef4;white-space:nowrap}

/* ===== 完整面板：多对话多条进度条（1:1 抄 runtime 的面板口径 440 宽） ===== */
#pan{width:440px;border:1px solid #4a7fa8;border-radius:5px;padding:9px 14px 11px;
  background:linear-gradient(168deg,rgba(24,41,63,.82) 0%,rgba(18,33,52,.8) 38%,rgba(14,26,42,.8) 100%)}
#pan .ph2{height:13px;line-height:13px;font:400 8.5px/1 ui-monospace,Consolas,monospace;color:#c3d6e6;letter-spacing:1.4px}
#pan .ph2 .he{float:right;letter-spacing:0}
#pan .sess{margin-top:7px}
#pan .srow{height:15px;line-height:15px;font-size:10.5px;color:#cfdcea;white-space:nowrap;overflow:hidden}
#pan .srow .agg{float:right;font:400 9px/15px ui-monospace,Consolas,monospace;color:#e8f0fa}
#pan .sbar{position:relative;display:block;height:7px;margin:1px 0 2px}
#pan .sq{position:absolute;left:0;top:2px;height:3px;width:412px;background:rgba(232,244,252,.18);border-radius:1px}
#pan .sf{position:absolute;top:2px;left:0;height:3px;width:412px;background:#56d9c8;border-radius:1px;transform-origin:0 50%;transform:scaleX(0)}
#pan .sbar .sm{position:absolute;top:0;width:1px;height:7px;background:#ffc266}
#pan .plan{font:400 8.5px/12px ui-monospace,Consolas,monospace;color:#ffc266;height:12px;white-space:nowrap;overflow:hidden}
#pan .tree2{margin-top:8px}
#pan .trow{position:relative;height:19px;line-height:19px;font-size:10.5px;white-space:nowrap;overflow:hidden}
#pan .trow.d1{padding-left:11px}#pan .trow.d2{padding-left:22px}
#pan .trow .tw{color:#4d6b86;font-family:ui-monospace,Consolas,monospace}
#pan .trow .tail{float:right;font:400 8.5px/19px ui-monospace,Consolas,monospace;color:#92aac0;margin-left:8px}
#pan .trow .ic{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:7px;vertical-align:0}
#pan .trow .ic.run{background:#56d9c8}#pan .trow .ic.done{background:#7fe3c8}
#pan .trow .ic.wait{background:none;border:1.3px solid #7e94ac}
#pan .foot{margin-top:7px;padding-top:5px;border-top:1px solid rgba(157,196,230,.16);
  font:400 8.5px/1.5 ui-monospace,Consolas,monospace;color:#7e94ac;white-space:normal}

.cap{padding:16px 22px 26px;background:#111823;color:#e4ecf4;width:1260px}
.cap h3{margin:0 0 8px;font-size:16px}
.cap h3 .ref{font-size:10px;color:#6fb6ff;border:1px solid #2e4a63;border-radius:3px;padding:1px 6px;margin-left:8px;vertical-align:2px}
.cap div{font-size:11.5px;line-height:1.78;color:#a9bccd}
.cap .k{display:inline-block;width:112px;color:#7e94ac;vertical-align:top}
.cap b{color:#e4ecf4}
.cap table{border-collapse:collapse;margin-top:6px;font:400 11px/1.65 ui-monospace,Consolas,monospace;color:#a9bccd;white-space:normal}
.cap td,.cap th{border:1px solid #26313d;padding:3px 9px;text-align:left;vertical-align:top}
.cap ul{margin:4px 0 0 18px;padding:0}.cap li{margin:3px 0}`

/* ---------- 4) 共享 JS（ES5 function 声明，不用箭头函数 / 方法简写） ---------- */
const JS = `/* ---------- 探针（与上一批同一套口径） ---------- */
window.onerror = function (m, f, l) {
  try {
    var d = document.getElementById('jserr')
    if (!d) { d = document.createElement('div'); d.id = 'jserr'; document.body.appendChild(d) }
    d.textContent = 'JSERR:' + m + '@' + l
    document.body.setAttribute('data-jserr', String(m))
  } catch (e) {}
}
var TICKS = 0
function paintProbe () {
  try {
    document.body.setAttribute('data-ticks', String(TICKS))
    document.body.setAttribute('data-fpstier', TIER)
    document.body.setAttribute('data-state', STATE)
    document.body.setAttribute('data-p', P.toFixed(4))
    document.body.setAttribute('data-run', RUNNER_DEG.toFixed(2))
    document.body.setAttribute('data-fps', String(TIERS[TIER].fps))
    var sel = '.lyr-' + curSt
    var rn = document.querySelector(sel + ' .prun')
    document.body.setAttribute('data-runtf', rn ? (rn.style.transform || 'none') : 'missing')
    var sg2 = document.querySelector(sel + ' .seg')
    document.body.setAttribute('data-segtf', sg2 ? (sg2.style.transform || 'none') : 'none')
    var el = document.getElementById('probe')
    if (el) el.innerHTML = 'ticks <b>' + TICKS + '</b> · tier <b>' + TIER + '</b> · state <b>' + STATE +
      '</b> · p <b>' + P.toFixed(3) + '</b> · runner <b>' + RUNNER_DEG.toFixed(1) + '°</b>'
    var er = document.getElementById('jserr')
    var e2 = (er && er.textContent) ? er.textContent : ''
    document.title = 't=' + TICKS + '|' + TIER + '|' + STATE + '|p=' + P.toFixed(3) + '|err=' + (e2 || 'none')
  } catch (e) {}
}

/* ---------- 三档：与 runtime FPS_PRESETS 同一口径（idle 4 / 15 / 30） ---------- */
var TIERS = {
  eco:      { fps: 4,  spin: 0,   breath: false, burst: false, idleSpin: 0,  name: '省电' },
  standard: { fps: 15, spin: 18,  breath: true,  burst: true,  idleSpin: 60, name: '标准' },
  smooth:   { fps: 30, spin: 6,   breath: true,  burst: true,  idleSpin: 24, name: '流畅' }
}
var TIER = 'standard', PLAYING = true, FROZEN = false
var STATE = 'advance', P = 0, WANT_P = 0, T = 0, ANG = 0, RUNNER_DEG = 0
var BACK_AT = -1, BACK_SHOWN = false
var V1 = /v1/.test(location.pathname), PANEL = true
var PIN = (location.search.match(/[?&]pin=([a-z0-9.]+)/) || [])[1] || ''
var pinApplied = ''
var PINP = (location.search.match(/[?&]p=([0-9.]+)/) || [])[1]

var STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR', 'DISCONNECTED']
var scenes = [], curSt = 'IDLE'
function initLayers () {
  var all = document.querySelectorAll('.ico')
  for (var i = 0; i < all.length; i++) all[i].classList.add('st-IDLE')
  setState('IDLE')
}
/* 状态单选：把 .st-* 打在 SVG 根上（与 runtime 同一手法），CSS 负责只显示这一态那 7 层 */
function setState (st) {
  curSt = st
  var all = document.querySelectorAll('.ico')
  for (var i = 0; i < all.length; i++) {
    for (var j = 0; j < STATES.length; j++) all[i].classList.remove('st-' + STATES[j])
    all[i].classList.add('st-' + st)
  }
}
function activeLayers () {
  var out = [], ls = document.querySelectorAll('.lyr-' + curSt)
  for (var i = 0; i < ls.length; i++) out.push(ls[i])
  return out
}

/* ---------- 进度环：唯一新增的渲染逻辑 ---------- */
var C_SEG = 2 * Math.PI * 60, C_OUT = 2 * Math.PI * 88
function renderRing () {
  var Ls = activeLayers()
  if (!Ls.length) return
  var C = V1 ? C_SEG : C_OUT
  var arc = P * C
  for (var n = 0; n < Ls.length; n++) {
    var L = Ls[n]
    var fill = L.querySelector('.pfill')
    if (fill) fill.setAttribute('stroke-dasharray', arc.toFixed(2) + ' ' + (C - arc).toFixed(2))
    /* 环显示规则（用户拍板）：没有计划时"就不画环" —— 推进/完成/退步才画 */
    var show = (STATE === 'advance' || STATE === 'complete' || STATE === 'back')
    var pg = L.querySelector('.prog')
    if (pg) pg.setAttribute('opacity', show ? '1' : '0')
    var tr = L.querySelector('.ptrack')
    if (tr) tr.setAttribute('opacity', (STATE === 'complete') ? '0.42' : '1')
    /* 运行体：沿环走到当前角度（只用 transform: rotate） */
    var rn = L.querySelector('.prun')
    if (rn) rn.style.transform = 'rotate(' + RUNNER_DEG.toFixed(2) + 'deg)'
    /* 计划变更标记：琥珀短刻度，标在上一次变更落点的百分比处 */
    var mk = L.querySelector('.pmark')
    if (mk) {
      if (BACK_AT >= 0) {
        mk.setAttribute('stroke-dashoffset', (-BACK_AT * C).toFixed(2))
        mk.setAttribute('opacity', STATE === 'back' ? '1' : '0.5')
      } else mk.setAttribute('opacity', '0')
    }
    /* 完成态"收束 → 爆散" */
    var bp = STATE === 'complete' ? Math.min(1, T / 1100) : 0
    var ring = L.querySelector('.burstring'), halo = L.querySelector('.bursthalo'), bc = L.querySelector('.burstcore')
    if (!TIERS[TIER].burst) bp = 0
    if (ring) {
      var s1 = bp < 0.38 ? (0.26 + 0.74 * (bp / 0.38)) : (1 + 1.85 * ((bp - 0.38) / 0.62))
      ring.style.transform = 'scale(' + s1.toFixed(3) + ')'
      ring.setAttribute('opacity', bp <= 0 ? '0' : (bp < 0.38 ? (0.95 * (bp / 0.38)).toFixed(3) : (0.95 * (1 - (bp - 0.38) / 0.62)).toFixed(3)))
    }
    if (halo) {
      var s2 = bp < 0.38 ? 0.5 : (0.5 + 1.7 * ((bp - 0.38) / 0.62))
      halo.style.transform = 'scale(' + s2.toFixed(3) + ')'
      halo.setAttribute('opacity', bp < 0.38 ? (0.5 * (bp / 0.38)).toFixed(3) : (0.5 * (1 - (bp - 0.38) / 0.62)).toFixed(3))
    }
    if (bc) {
      var s3 = bp < 0.38 ? (0.6 + 0.55 * (bp / 0.38)) : (1.15 * (1 - 0.55 * ((bp - 0.38) / 0.62)))
      bc.style.transform = 'scale(' + s3.toFixed(3) + ')'
      bc.setAttribute('opacity', bp < 0.38 ? (0.55 * (bp / 0.38)).toFixed(3) : (0.55 * (1 - (bp - 0.38) / 0.62)).toFixed(3))
    }
    var fl = L.querySelector('.flash')
    if (fl) fl.setAttribute('opacity', STATE === 'complete' && bp < 0.22 ? (0.55 * Math.sin(Math.PI * bp / 0.22)).toFixed(3) : '0')
    /* 静止呼吸：空闲态让核心的辉光与核心本身极慢地明暗（只改 opacity）
       省电档 breath=false → 完全静止（用户要求"省电档空闲时必须完全静止"） */
    if (STATE === 'rest') {
      var ph2 = TIERS[TIER].breath ? (0.5 - 0.5 * Math.cos(2 * Math.PI * A_TIMEPH / 2600)) : 0
      var ga = L.querySelector('.glowA')
      if (ga) ga.setAttribute('opacity', (CORE_OP * (0.30 + 0.70 * ph2)).toFixed(3))
      var cg = L.querySelector('.core')
      if (cg) cg.setAttribute('opacity', (0.62 + 0.38 * ph2).toFixed(3))
    } else {
      var ga2 = L.querySelector('.glowA')
      if (ga2) ga2.setAttribute('opacity', (CORE_OP * 0.2).toFixed(3))
      var cg2 = L.querySelector('.core')
      if (cg2) cg2.setAttribute('opacity', '1')
    }
    /* 自转：v1 的现有弧已经变成进度了，不能再自转；v2 的现有弧保持原样自转 */
    if (!V1) {
      var sg = L.querySelector('.seg'), cl = L.querySelector('.cloud')
      var per = TIERS[TIER].spin > 0 ? TIERS[TIER].spin : 0
      var tf = per > 0 ? ('rotate(' + ANG.toFixed(2) + 'deg)') : ''
      if (sg) sg.style.transform = tf
      if (cl) cl.style.transform = tf
    }
  }
}

/* ---------- 三态自动循环 ---------- */
var PH = [
  { st: 'advance', dur: 7000, from: 0, to: 1 },
  { st: 'complete', dur: 2200, from: 1, to: 1 },
  { st: 'back', dur: 2600, from: 1, to: 6 / 11, note: true },
  { st: 'advance', dur: 3400, from: 6 / 11, to: 1 },
  { st: 'rest', dur: 2600, from: 1, to: 1 },
  { st: 'advance', dur: 5200, from: 1, to: 1 }
]
var ph = 0, phT = 0
var A_TIMEPH = 0, CORE_OP = 1
/* 七态的 --core 值（与 runtime 的 .st-* 一致），用于静止呼吸时的辉光/核心明暗 */
var CORE_MAP = { IDLE: 0.13, THINKING: 0.42, WORKING: 1, WAITING: 0.55, SUCCESS: 1, ERROR: 0.7, DISCONNECTED: 0.2 }
/* 相位与状态的对应（每一相开始时都要显式设一次，否则首相位会停在 IDLE） */
function startPhase (i) {
  ph = i; phT = 0
  var q = PH[ph]
  if (q.st === 'complete') { setState('SUCCESS'); T = 0 }
  else if (q.st === 'back') { setState('WAITING'); T = 0 }
  else if (q.st === 'rest') setState('IDLE')
  else setState('WORKING')
}
function stepPhase (dt) {
  var q = PH[ph]
  phT += dt
  var u = Math.min(1, phT / q.dur)
  STATE = q.st
  WANT_P = q.from + (q.to - q.from) * u
  if (q.note && u > 0.34) BACK_AT = 1
  /* 完成态的收束：进度保持满 */
  if (q.st === 'complete') WANT_P = 1
  if (u >= 1) {
    var nx = (ph + 1) % PH.length
    if (PH[nx].st === 'advance' && PH[nx].from < 0.5) BACK_AT = -1
    startPhase(nx)
  }
}

/* ---------- 文字层（悬浮层 + 完整面板） ---------- */
var SESS = [
  { id: 'main', name: '主代理 · 当前对话', done: 0, total: 6, note: '' },
  { id: 'reviewer', name: 'reviewer', done: 0, total: 12, note: '' },
  { id: 'tester', name: 'tester', done: 0, total: 11, note: '' }
]
function totals () {
  var d = 0, t = 0
  for (var i = 0; i < SESS.length; i++) { d += SESS[i].done; t += SESS[i].total }
  return { d: d, t: t, p: t ? d / t : 0 }
}
function renderText () {
  var tt = totals()
  var h1 = document.getElementById('pct1'), h2 = document.getElementById('pct2')
  var txt = Math.round(tt.p * 100) + '%'
  if (h1) h1.textContent = txt
  if (h2) h2.textContent = txt
  var bs = document.getElementById('hovbs')
  if (bs) bs.style.transform = 'scaleX(' + tt.p.toFixed(4) + ')'
  var bl = document.getElementById('hovbl')
  if (bl) bl.textContent = tt.d + '/' + tt.t + ' 步 · ' + SESS.length + ' 会话'
  var r3 = document.getElementById('hovr3')
  if (r3) r3.innerHTML = (BACK_AT >= 0 ? '进度回退：<span class="a">计划已更新 6→11</span>（分母变大，总进度 100%→55%）' : '')
  var pr = document.getElementById('proc')
  if (pr) pr.textContent = (1 + SUB.length) + ' 个进程'
  for (var i = 0; i < SESS.length; i++) {
    var s = SESS[i]
    var f = document.getElementById('sf-' + s.id)
    if (f) f.style.transform = 'scaleX(' + (s.total ? s.done / s.total : 0).toFixed(4) + ')'
    var n = document.getElementById('sn-' + s.id)
    if (n) n.textContent = s.done + '/' + s.total + ' 步 · ' + Math.round(100 * s.done / s.total) + '%'
    var m = document.getElementById('sm-' + s.id)
    if (m) m.style.left = (412 * (s.done / s.total)).toFixed(1) + 'px'
  }
}
var SUB = [
  { n: 'researcher', d: 0, st: 'run', t: '· 02:14 · 17 工具' },
  { n: 'engineer', d: 1, st: 'run', t: '· 01:03 · 9 工具' },
  { n: 'verifier', d: 1, st: 'done', t: '· 04:41 · 31 工具' },
  { n: 'reviewer', d: 2, st: 'done', t: '· 06:12 · 22 工具' },
  { n: 'tester', d: 2, st: 'wait', t: '· 00:38 · 4 工具' }
]

/* ---------- 主循环：与 runtime 同一策略（<30fps 走 setTimeout 链，不挂 rAF 链） ---------- */
var timer = 0, last = performance.now(), lastSt = ''
function frame () {
  timer = 0
  var now = performance.now()
  var dt = Math.min(now - last, 250)
  last = now
  TICKS++
  if (PIN) {
    /* ?pin=<p>.<状态>，p 可带小数（用正则取，不能用 split('.') —— 会把 0.08 拆成 0 与 08） */
    var mm = PIN.match(/([0-9]+(?:\.[0-9]+)?)(?:\.([A-Za-z]+))?/)
    P = mm ? parseFloat(mm[1]) : 0
    STATE = (mm && mm[2]) ? mm[2] : 'advance'
    if (STATE === 'complete') T += 400
    if (pinApplied !== PIN) { pinApplied = PIN; applyState(STATE) }
  } else {
    if (PLAYING) {
      stepPhase(dt)
      P = WANT_P
      /* 会话内部计数跟着总进度走（演示用：各会话按自己的分母推进） */
      for (var i = 0; i < SESS.length; i++) SESS[i].done = Math.round(SESS[i].total * P)
    }
    applyState(STATE)
  }
  /* 自转：省电档 spin=0 → 完全不自转（空闲时必须完全静止）；静止呼吸另给一个更慢的 idleSpin。
     注意：这段必须在 PIN 分支之外 —— 否则"钉住进度看空闲自转"根本测不到。 */
  var per = STATE === 'rest' ? (TIERS[TIER].idleSpin || 0) : (TIERS[TIER].spin || 0)
  if (per > 0) ANG = (ANG + 360 * (dt / 1000) / per) % 360
  RUNNER_DEG = P * 360
  A_TIMEPH = (A_TIMEPH + dt) % 100000
  T = (STATE === 'complete') ? T + dt : 0
  renderRing()
  renderText()
  paintProbe()
  schedule()
}
/* 状态单选只在真正变化时写一次 DOM */
function applyState (st) {
  if (st === lastSt) return
  lastSt = st
  var key = st === 'complete' ? 'SUCCESS' : st === 'rest' ? 'IDLE' : st === 'back' ? 'WAITING' : 'WORKING'
  CORE_OP = CORE_MAP[key]
  setState(key)
}
function schedule () {
  if (!PLAYING && !PIN) return
  var fps = TIERS[TIER].fps
  timer = setTimeout(frame, Math.max(0, 1000 / fps - (performance.now() - last)))
}
function kick () { if (!timer) { last = performance.now(); frame() } }

/* ---------- 控件 ---------- */
document.addEventListener('DOMContentLoaded', function () {
  var tg = document.getElementById('toggle')
  if (tg) tg.onclick = function () { PLAYING = !PLAYING; this.textContent = PLAYING ? '暂停' : '播放'; if (PLAYING) kick() }
  var tbs = document.querySelectorAll('[data-tier]')
  for (var i = 0; i < tbs.length; i++) {
    tbs[i].onclick = (function (b) {
      return function () {
        TIER = b.getAttribute('data-tier')
        var all = document.querySelectorAll('[data-tier]')
        for (var j = 0; j < all.length; j++) all[j].classList.toggle('on', all[j] === b)
        var fv = document.getElementById('fv'); if (fv) fv.textContent = TIERS[TIER].fps + ' fps'
        kick()
      }
    })(tbs[i])
  }
  var pb = document.getElementById('ptoggle')
  if (pb) pb.onclick = function () {
    PANEL = !PANEL
    var pw = document.getElementById('panw'); if (pw) pw.style.display = PANEL ? '' : 'none'
    this.textContent = PANEL ? '隐藏面板' : '展开面板'
  }
  initLayers()
  startPhase(0)
  kick()
})
if (document.readyState !== 'loading') {
  initLayers(); startPhase(0); kick()
}`

/* ---------- 5) 生成页面 ---------- */
const VARIANTS = [
  {
    file: 'v1-reuse-arcs.html', tag: 'v1', variant: 'v1',
    title: 'v1 · 复用现有弧（零几何代价）',
    intent: '让图标【现有那几段弧】直接成为进度：不新增任何几何、不改半径、不改 stroke-width、不动窗口尺寸/命中区/点击穿透判据。',
    pros: ['零几何代价：图标尺寸、窗口几何、命中区、点击穿透判据全部一个字都不改', '不需要新增图元 → 元素数不变，合成层数不变', '进度环就是产品里那圈"会转的分段弧"，视觉血缘 100%'],
    cons: ['现有弧本来是"会自转的装饰"，一旦变成进度就<b>不再自转</b> —— 会损失一点常态动感（需要靠云核旋转补偿）', '半径只有 60（图标半径的 60%），环显得偏内，"套在最外圈"的观感弱', 'stroke-width 只有 2，在 140px 下约 1.4px，细；进度读数不如粗环清楚'],
    bad: '不要拿 v1 的环 + 再叠一层外圈环（两圈都在表达进度，读数会打架）。',
    parts: [['A 进度填充', '现有弧 <g class="seg"> 上做 stroke-dasharray', '可换：加 stroke-linecap="round" 更柔；或保留 dasharray 断续感做"分段点亮"'],]
  },
  {
    file: 'v2-outer-ring.html', tag: 'v2', variant: 'v2',
    title: 'v2 · 最外圈另起一层（r=88）',
    intent: '在最外圈另加一条进度环（r=88，夹在 tick 刻度环 r=94 与分段弧 r=60 之间），现有分段弧保持原样自转。',
    pros: ['真正"套在最外圈"：半径 88 = 图标半径的 88%，紧贴 tick 刻度环内缘，视觉上是一道箍', '现有弧、云核、核心全部保持原样 —— <b>常态动感一点不损失</b>（云核 + 分段弧继续各自自转）', '进度与装饰分离：环读进度、弧读"在动"，两件事互不干扰', 'stroke-width 2.4 更清楚，140px 下约 1.7px'],
    cons: ['新增 3 个图元（track / fill / runner）→ 每层多 3 个节点 ×7 态 = 21 个，元素数 +约 2%', 'r=88 到 tick 环 r=94 之间只剩 6 单位空隙，轮廓上略紧（可以被 runner 圆点填掉）'],
    bad: '不要同时把"完成爆散"缩小改成径向渐变扩散 —— 会变成第二套视觉语言。',
    parts: [['B 外圈环', 'r=88 新增 track + fill', '可换半径：84（更贴内）/ 90（更贴 tick 环）；可换 stroke-width 1.6~3'],]
  }
]

function page (V) {
  const layers = Object.keys(COLOR).map(st => layerSvg(st, V.variant)).join('\n')
  const prosLis = V.pros.map(t => '<li>' + t + '</li>').join('')
  const consLis = V.cons.map(t => '<li>' + t + '</li>').join('')
  const partsRows = V.parts.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('')

  function icon (size, id) {
    return '<svg class="ico" id="' + id + '" viewBox="0 0 200 200" width="' + size + '" height="' + size +
      '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      '<g>' + layers + '</g></svg>'
  }

  const treeRows = [
    ['root', '主代理 · 当前对话', '', '6 步 · 04:12 · 41 工具'],
    ['d1', '├ researcher', 'run', '02:14 · 17 工具'],
    ['d1', '├ engineer', 'run', '01:03 · 9 工具'],
    ['d2', '│ └ verifier', 'done', '04:41 · 31 工具'],
    ['d1', '├ reviewer', 'done', '06:12 · 22 工具'],
    ['d2', '│ └ tester', 'wait', '00:38 · 4 工具']
  ].map(function (r) {
    const ic = r[2] ? '<i class="ic ' + r[2] + '"></i>' : ''
    return '<div class="trow' + (r[0] === 'root' ? '' : ' ' + r[0]) + '"><span class="tw">' + r[1] + '</span>' +
      ic + '<span class="tail">' + r[3] + '</span></div>'
  }).join('')

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${V.title}</title>
<style>
${CSS}
</style></head><body data-ticks="0" data-fpstier="standard" data-state="advance" data-p="0">
<div class="bar"><a href="./index.html">← 两个版本对照</a>  <a href="./${V.variant === 'v1' ? 'v2-outer-ring' : 'v1-reuse-arcs'}.html">切到 ${V.variant === 'v1' ? 'v2 外圈' : 'v1 复用弧'}</a>
  <span class="nm">${V.title}</span>
  <button id="toggle">暂停</button>
  <button data-tier="eco">省电</button><button data-tier="standard" class="on">标准</button><button data-tier="smooth">流畅</button>
  <button id="ptoggle">隐藏面板</button>
  <span style="display:inline-block;font:400 10px/18px ui-monospace,Consolas,monospace;color:#92aac0;margin-left:8px">
    档位 <b id="fv" style="color:#56d9c8">15 fps</b></span>
  <span id="probe">ticks <b>0</b></span><span id="jserr"></span>
</div>
<div class="row">
  <div class="side"><div class="desk dk">
    <div class="iconw">${icon(144, 'ico1')}</div>
    <div class="hovw"><div id="hov">
      <span class="r1"><b class="st">执行中 · Bash</b><span class="tok">128.4k</span></span>
      <span class="r2"><span class="k">总进度</span> <span class="v" id="pct1">0%</span>
        <span style="float:right"><span class="k">进程</span> <span class="v" id="proc">6 个进程</span></span></span>
      <span class="bl2"><i class="bq"></i><i class="bs" id="hovbs"></i><i class="bt"></i><b class="bl" id="hovbl">0/29 步 · 3 会话</b></span>
      <span class="r3" id="hovr3"></span>
      <span class="h3">子代理 5 · 主代理 1 · 其中 2 个在跑</span>
    </div></div>
  </div></div>
  <div class="side"><div class="desk lt">
    <div class="iconw">${icon(144, 'ico2')}</div>
    <div class="hovw" style="top:196px"><div style="width:272px;padding:5px 7px;border-radius:5px;background:rgba(16,30,47,.86);border:1px solid rgba(74,127,168,.85);font-family:ui-monospace,Consolas,monospace">
      <span class="r1" style="display:block;height:15px;line-height:15px;font-size:12.5px;font-weight:700;color:#f4f8fa">浅色桌面下的同一枚图标</span>
      <span style="display:block;height:13px;line-height:13px;font-size:9.5px;color:#bcd0dd">用来看"环在白底上还立不立得住"</span>
    </div></div>
    <div class="panw" id="panw"><div id="pan">
      <div class="ph2">CONVERSATIONS · 3<span class="he">总 <b id="pct2">0%</b></span></div>
      <div class="sess">
        <div class="srow">主代理 · 当前对话<span class="agg" id="sn-main">0/6 步 · 0%</span></div>
        <span class="sbar"><i class="sq"></i><i class="sf" id="sf-main"></i><i class="sm" id="sm-main"></i></span>
      </div>
      <div class="sess">
        <div class="srow">reviewer<span class="agg" id="sn-reviewer">0/12 步 · 0%</span></div>
        <span class="sbar"><i class="sq"></i><i class="sf" id="sf-reviewer"></i><i class="sm" id="sm-reviewer"></i></span>
      </div>
      <div class="sess">
        <div class="srow">tester<span class="agg" id="sn-tester">0/11 步 · 0%</span></div>
        <span class="sbar"><i class="sq"></i><i class="sf" id="sf-tester"></i><i class="sm" id="sm-tester"></i></span>
      </div>
      <div class="plan">计划已更新 6→11 —— 总进度因此回退（悬浮层里有说明）</div>
      <div class="tree2">${treeRows}</div>
      <div class="foot">子代理不给百分比（协议里没有单节点进度）：只给 状态 + 时长 + 工具数。<br>环上那颗白点是"运行体"，沿环走到当前进度；琥珀短刻度标在"上一次计划变更"的位置。</div>
    </div></div>
  </div>
</div>
<div class="cap">
  <h3>${V.title} <span class="ref">真实资产：base-h2 七层几何 + 七态配色 + 粒子种子，全部只读复制自 runtime/electron/index.html</span></h3>
  <div><span class="k">设计意图</span>${V.intent}</div>
  <div style="margin-top:6px"><span class="k">优点</span><ul>${prosLis}</ul></div>
  <div style="margin-top:6px"><span class="k">代价 / 短板</span><ul>${consLis}</ul></div>
  <div style="margin-top:6px"><span class="k">不推荐的组合</span>${V.bad}</div>
  <div style="margin-top:6px"><span class="k">零件可换性</span><table><tr><th>零件</th><th>是什么</th><th>可换性</th></tr>${partsRows}
   <tr><td>C 三态</td><td>推进 / 完成（收束+爆散）/ 静止呼吸</td><td>与 A、B 都正交，两版共用</td></tr>
   <tr><td>D 运行体</td><td>沿环走动的白点（rotate 驱动）</td><td>可换：小三角／短弧拖尾／去掉只剩填充</td></tr>
   <tr><td>E 计划变更刻度</td><td>琥珀短刻度 + 悬浮层文字说明</td><td>可换：换成整环闪一下 / 换成环色变琥珀 1.5s</td></tr></table></div>
  <div><span class="k">三态</span><b>推进</b>＝填充增长 + 运行体沿环走；<b>完成</b>＝环补满 → 收束（0~38%）→ <b>爆散</b>（38~100%，外环扩散 + 光晕 + 核心脉冲）；<b>静止呼吸</b>＝空闲态，省电档下完全静止</div>
  <div><span class="k">三档</span>省电 4 fps / 空闲自转关闭 / 不爆散｜标准 15 fps / 自转 18s 一圈 / 慢呼吸｜流畅 30 fps / 自转 6s 一圈 —— 与 runtime <code>FPS_PRESETS</code>（idle 4/15/30）同口径</div>
  <div><span class="k">尺寸参照</span>主图标 144px（viewBox 0 0 200 200，产品默认 svg=144；140px 是同一套几何按比例缩放）｜悬浮层 272 宽（抄 runtime <code>#v2hover</code> 口径）｜完整面板 440 宽（抄 <code>--panel-w</code>）</div>
  <div><span class="k">实测 CPU（单核占比）</span>
   <table><tr><th>档位</th><th>空闲（静止呼吸，不画环）</th><th>推进中</th><th>完成（收束+爆散）</th><th>三次实测中位数</th></tr>
    <tr><td>省电 4 fps（不自转 · 不呼吸 · 不爆散）</td><td>1.7%</td><td>1.8%</td><td>1.8%</td><td>v1 1.66 / 1.78 / 1.85 / 1.79 ｜ v2 1.75 / 1.77 / 1.76 / 1.78</td></tr>
    <tr><td>标准 15 fps（自转 18s/圈 · 慢呼吸）</td><td>5.2%</td><td>4.2%</td><td>4.3%</td><td>v1 5.19 / 4.17 / 4.37 / 4.27 ｜ v2 5.57 / 6.23 / 6.24 / 6.61</td></tr>
    <tr><td>流畅 30 fps（自转 6s/圈）</td><td>5.9%</td><td>5.3%</td><td>5.2%</td><td>v1 5.86 / 5.27 / 5.34 / 5.19 ｜ v2 6.84 / 14.56⚠ / 9.42 / 8.31</td></tr>
    <tr><td>基线：暂停（整页完全静止）</td><td colspan="3">0.02%</td><td>0.01 / 0.02 / 0.02</td></tr>
   </table>
   口径：本机 20 逻辑核；CDP <code>Performance.getMetrics</code> 的 TaskDuration ÷ 采样时长；<b>无头 Edge、1260×1000 视口、<span style="color:#ffc266">单页同时渲染 2 枚图标</span>（本原型为对照方便，深色 + 浅色桌面各一枚）、每格 12s、3 次取中位数</b>。
   其中 v2 流畅/推进那次 15.72% 是机器负载尖峰（同格另外两次 14.56 与 8.60），<b>不要把它当真实成本</b>。</div>
  <div><span class="k">数字怎么读</span>① <b>省电档 1.7~1.8% ≈ 基线</b>：空闲时环不画、云核不自转、不呼吸 → 这就是"省电档空闲时必须完全静止"落到数字上的样子；② 标准档比省电档贵约 <b>2.3 倍</b>，流畅档比标准档再贵约 <b>1.3 倍</b>（不是 2 倍，因为按时钟频率跳帧后每帧工作量固定，30fps 只有 2 倍而不是 7.5 倍的写 DOM 次数，瓶颈在光栅化）；③ 成本几乎全在 <b>layout + 重算样式</b>（各档 script 只有 30~260ms，layout 有 33~288ms）；④ 真实产品里只有 1 枚图标，上述数字可近似减半。</div>
  <div><span class="k">机器验证</span>tick 递增 ✅｜#jserr 为空 ✅｜主元素 computed transform 逐帧变化（v1 是 .prun 运行体，v2 还有 .cloud/.seg 自转）✅｜环填充 stroke-dasharray 随之变化 ✅｜<b>三档 tick/3s = 12 / 40 / 80（对应 4/15/30 fps）</b> ✅｜空闲态：省电档云核与现有弧<b>完全冻结</b>、标准/流畅档按档位自转 ✅｜静态合规：computed 全量扫描 0 处 backdrop-filter / filter / box-shadow ✅</div>
</div>
<script>
var V1 = ${V.variant === 'v1' ? 'true' : 'false'}
${JS}
</script></body></html>
`
}

/* ---------- 6) 索引页 ---------- */
const INDEX = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>进度环原型 · v1 / v2 对照</title>
<style>${CSS}
.cmp{display:inline-block;vertical-align:top;margin-right:26px}
.idx a{display:block;padding:11px 14px;margin:8px 0;background:#161f2b;border-left:3px solid #4a7fa8;border-radius:0 4px 4px 0;color:#cfe0ea;text-decoration:none;font-size:13px}
.idx a:hover{border-left-color:#56d9c8;background:#1b2634}
.idx a span{color:#8fa8bd;font-size:11px;margin-left:8px;display:block;margin-top:3px}
</style></head><body data-ticks="0">
<div class="cap" style="padding-bottom:4px"><h3>进度环原型 v1 / v2 <span class="ref">背景层 = 真实 H2「等离云核」，只读复制自 runtime/electron/index.html</span></h3>
<div><b>先看这一页判断"哪个更像套在外面"，再看动效。</b>两页都是真动画：三态自动循环（推进 → 完成收束+爆散 → 静止呼吸）、三档可切、可暂停。</div>
<div><span class="k">尺寸口径</span>图标按产品真实尺寸渲染（144px，viewBox 0 0 200 200）；用户口径的 140px 与它是同一套几何，只是缩放不同。</div>
<div><span class="k">已满足的五条</span>① 背景就是云核本体，没有另做背景 ② 进度＝ORBITAL 一圈轨道环 ③ v1 让<b>现有那几段弧</b>成为进度（零几何代价）④ 完成＝收束后再爆散 ⑤ <b>没有计划时就不画环</b>（静止呼吸态整环 opacity:0）</div>
<div><span class="k">实测 CPU（单核占比）</span><b>省电 1.7%｜标准 4.2~5.2%｜流畅 5.2~5.9%｜暂停基线 0.02%</b>（无头 Edge / 1260×1000 / 单页 2 枚图标 / 每格 12s / 3 次中位数）</div>
<div><span class="k">三档 tick 实测</span>3 秒内 <b>12 / 40 / 80</b> 次，即 4 / 15 / 30 fps；空闲态省电档云核与现有弧<b>完全冻结</b></div>
<div><span class="k">机器验证</span>tick 递增 ✅｜#jserr 为空 ✅｜computed transform 逐帧变化 ✅｜环填充随之变化 ✅｜computed 全扫 0 处 backdrop-filter / filter / box-shadow ✅</div>
</div>
<div class="cap idx" style="padding-top:0;padding-bottom:26px">
<a href="./v1-reuse-arcs.html">v1 · 复用现有弧（零几何代价）<span>半径 60、stroke-width 2 —— 就是产品里那圈会转的分段弧；变成进度后它不再自转</span></a>
<a href="./v2-outer-ring.html">v2 · 最外圈另起一层（r=88）<span>紧贴 tick 刻度环内缘，现有弧保持原样自转 —— 常态动感一点不损失</span></a>
<h3 style="margin-top:18px">其余需求落在哪</h3>
<table>
<tr><th>需求</th><th>落在哪</th></tr>
<tr><td>多对话显示<b>全部对话的总进度</b></td><td>v1/v2 环上的填充与悬浮层"总进度 %"都是 = Σ已完成步数 / Σ总步数（3 个会话加权合计，不是其中一个会话）</td></tr>
<tr><td><b>允许进度倒退</b>且必须在悬浮层说明原因</td><td>三态循环里专门排了一段"计划已更新 6→11"：总进度 100%→55%，环回缩，悬浮层出现琥珀一行说明；环上同时保留琥珀短刻度标在变更点</td></tr>
<tr><td>悬浮层：总进度条 + 进程数</td><td>悬浮层第 2 行 = 总进度 % + 进程数（主代理 + 子代理）；第 3 行是子弹图总进度条</td></tr>
<tr><td>完整面板：多对话多条进度条</td><td>右侧 440px 面板：3 条会话进度条 + 各自步数 + 计划变更说明 + 子代理树</td></tr>
<tr><td>子代理不给百分比</td><td>树里只有 状态点 + 时长 + 工具数，没有 %</td></tr>
</table>
</div>
<script>
window.onerror = function (m, f, l) { try { var d = document.createElement('div'); d.id = 'jserr'; d.textContent = 'JSERR:' + m + '@' + l; document.body.appendChild(d); document.body.setAttribute('data-jserr', String(m)) } catch (e) {} }
var TICKS = 0
setInterval(function () { TICKS++; document.body.setAttribute('data-ticks', String(TICKS)); document.title = 't=' + TICKS + '|index|err=none' }, 250)
</script></body></html>
`

mkdirSync(OUT, { recursive: true })
for (const V of VARIANTS) {
  const html = page(V)
  writeFileSync(OUT + '/' + V.file, html, 'utf8')
  console.log('wrote', V.file, html.length, 'bytes')
}
writeFileSync(OUT + '/index.html', INDEX, 'utf8')
console.log('wrote index.html')
