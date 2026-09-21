/* ring-proto verifier
 * 证据口径（按用户要求，**不用两帧像素差**）：
 *   1) tick 探针递增
 *   2) #jserr 为空
 *   3) 主元素 computed transform 逐帧变化（.prun 运行体 / .seg 现有弧）
 *   4) 进度确实在推进（data-p 递增）+ 环填充 stroke-dasharray 随之变化
 *   5) 三档行为不同（tick/3s）
 *   6) 静态合规：computed 全量扫 backdrop-filter / filter / box-shadow
 *   7) 三档 CPU：CDP Performance.getMetrics TaskDuration ÷ 采样时长
 * 全部离屏无头 Edge，不弹窗，不碰用户进程。
 */
const PW = 'file:///C:/Users/david/.dsh/profiles/web/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
import { writeFileSync } from 'node:fs'

const DIR = 'file:///C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto/'
const PAGE = { v1: DIR + 'v1-reuse-arcs.html', v2: DIR + 'v2-outer-ring.html' }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const OUT = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto-gen/verify-report.json'
const report = { ts: new Date().toISOString(), exec: EDGE, live: {}, tiers: {}, static: {}, cpu: {}, elements: {} }

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--disable-gpu'] })

const PROBE = `(function(){
  function vis(sel){ var n=document.querySelectorAll(sel); for (var i=0;i<n.length;i++){ if (getComputedStyle(n[i]).display!=='none') return n[i] } return null }
  var L = vis('.lyr');
  function q(c){ return L ? L.querySelector(c) : null }
  var pr=q('.prun'), sg=q('.seg'), cl=q('.cloud'), pf=q('.pfill');
  return {
    ticks: Number(document.body.dataset.ticks),
    p: Number(document.body.dataset.p),
    state: document.body.dataset.state,
    tier: document.body.dataset.fpstier,
    jserr: (document.getElementById('jserr')||{}).textContent || '',
    visible_layer: L ? L.getAttribute('data-st') : null,
    runTf: pr ? getComputedStyle(pr).transform : null,
    segTf: sg ? getComputedStyle(sg).transform : null,
    cloudTf: cl ? getComputedStyle(cl).transform : null,
    dash: pf ? pf.getAttribute('stroke-dasharray') : null,
    progOpacity: q('.prog') ? q('.prog').getAttribute('opacity') : null
  }
})()`

/* ---------- 1) 真动效 ---------- */
for (const key of ['v1', 'v2']) {
  const page = await browser.newPage({ viewport: { width: 1260, height: 1000 } })
  await page.goto(PAGE[key], { waitUntil: 'load' })
  const a = await page.evaluate(PROBE)
  await page.waitForTimeout(2500)
  const b = await page.evaluate(PROBE)
  await page.waitForTimeout(1200)
  const c = await page.evaluate(PROBE)
  report.live[key] = {
    ticks: [a.ticks, b.ticks, c.ticks],
    ticks_incremented: c.ticks > b.ticks && b.ticks > a.ticks,
    p: [a.p, b.p, c.p],
    p_advanced: c.p > a.p,
    jserr_empty: a.jserr === '' && b.jserr === '' && c.jserr === '',
    jserr: c.jserr,
    runTf_v1: b.runTf, runTf_v2: c.runTf,
    run_transform_changing: b.runTf !== c.runTf,
    segTf_v1: b.segTf, segTf_v2: c.segTf,
    cloudTf_v1: b.cloudTf, cloudTf_v2: c.cloudTf,
    dash_v1: b.dash, dash_v2: c.dash,
    dash_changing: b.dash !== c.dash,
    state: c.state, title: await page.title()
  }
  // 元素计数（用于"新增几何"这条论据）
  report.elements[key] = await page.evaluate(() => {
    const ls = [...document.querySelectorAll('.lyr')]
    const vis = ls.filter(e => getComputedStyle(e).display !== 'none')
    const one = vis[0]
    return {
      scene_lyr_total: ls.length,
      visible_layers: vis.length,
      visible_layer_state: one ? one.getAttribute('data-st') : null,
      primitives_per_layer: one ? one.querySelectorAll('*').length : -1,
      prog_nodes_per_layer: one ? one.querySelectorAll('.prog > *').length : -1,
      has_seg_in_layer: !!(one && one.querySelector('.seg')),
      has_outer_in_layer: !!(one && one.querySelector('.outer')),
      ico_slots: document.querySelectorAll('svg.ico').length,
      painted_svg_primitives: vis.reduce((a, e) => a + e.querySelectorAll('*').length, 0)
    }
  })
  await page.close()
}

/* ---------- 2) 三档行为差异（tick 速率 + 空闲自转是否真的停住） ---------- */
for (const key of ['v1', 'v2']) {
  report.tiers[key] = {}
  for (const tier of ['eco', 'standard', 'smooth']) {
    const page = await browser.newPage({ viewport: { width: 1260, height: 1000 } })
    await page.goto(PAGE[key], { waitUntil: 'load' })
    await page.click('[data-tier="' + tier + '"]')
    await page.waitForTimeout(1200)
    const a = await page.evaluate(PROBE)
    await page.waitForTimeout(3000)
    const b = await page.evaluate(PROBE)
    // 空闲（rest，环不画）：把进度钉死在 rest，看云核/分段弧还动不动 —— 省电档必须完全静止
    await page.goto(PAGE[key] + '?pin=1.rest', { waitUntil: 'load' })
    await page.click('[data-tier="' + tier + '"]')
    await page.waitForTimeout(900)
    const f1 = await page.evaluate(PROBE)
    await page.waitForTimeout(2500)
    const f2 = await page.evaluate(PROBE)
    report.tiers[key][tier] = {
      ticks_delta_3s: b.ticks - a.ticks,
      expected_fps: tier === 'eco' ? 4 : tier === 'standard' ? 15 : 30,
      state_at_3s: b.state,
      ring_painted_at_rest: f1.progOpacity,
      idle_cloud_tf: f1.cloudTf,
      idle_cloud_frozen: f1.cloudTf === f2.cloudTf,
      idle_cloud_changed: f1.cloudTf !== f2.cloudTf,
      idle_seg_frozen: f1.segTf === f2.segTf
    }
    await page.close()
  }
}

/* ---------- 3) 静态合规 ---------- */
for (const key of ['v1', 'v2']) {
  const page = await browser.newPage({ viewport: { width: 1260, height: 1000 } })
  await page.goto(PAGE[key], { waitUntil: 'load' })
  await page.waitForTimeout(600)
  report.static[key] = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.backdropFilter && cs.backdropFilter !== 'none') bad.push('backdropFilter:' + cs.backdropFilter)
      if (cs.boxShadow && cs.boxShadow !== 'none') bad.push('boxShadow:' + cs.boxShadow)
      if (cs.filter && cs.filter !== 'none') bad.push('filter:' + cs.filter)
    }
    const props = new Set()
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      String(cs.transitionProperty || '').split(',').forEach(s => { const t = s.trim(); if (t && t !== 'none' && t !== 'all') props.add(t) })
      const an = el.getAnimations ? el.getAnimations() : []
      for (const x of an) {
        const kf = x.effect && x.effect.getKeyframes ? x.effect.getKeyframes() : []
        for (const k of kf) for (const kk of Object.keys(k)) if (['offset', 'computedOffset', 'easing', 'composite'].indexOf(kk) < 0) props.add(kk)
      }
    }
    return {
      animated_properties: [...props].sort(),
      forbidden_computed: [...new Set(bad)].slice(0, 6),
      forbidden_count: bad.length,
      keyframes: document.querySelectorAll('style').length ? (([...document.querySelectorAll('style')].map(s => s.textContent).join('')).match(/@keyframes/g) || []).length : 0,
      running_css_animations: document.getAnimations().length,
      feGaussianBlur_in_dom: document.querySelectorAll('feGaussianBlur').length
    }
  })
  await page.close()
}

/* ---------- 4) 三档 CPU（每档 12s × 3 次取中位数） ---------- */
const SAMPLE = 12000, REPS = 3
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
async function measure (key, tier, pin) {
  const page = await browser.newPage({ viewport: { width: 1260, height: 1000 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(PAGE[key] + '?pin=' + pin, { waitUntil: 'load' })
  await page.click('[data-tier="' + tier + '"]')
  await page.waitForTimeout(1500)
  const m0 = await cdp.send('Performance.getMetrics')
  await page.waitForTimeout(SAMPLE)
  const m1 = await cdp.send('Performance.getMetrics')
  const g = (m, n) => { const x = m.metrics.find(v => v.name === n); return x ? x.value : 0 }
  const task = (g(m1, 'TaskDuration') - g(m0, 'TaskDuration')) * 1000
  const scr = (g(m1, 'ScriptDuration') - g(m0, 'ScriptDuration')) * 1000
  const lay = (g(m1, 'LayoutDuration') - g(m0, 'LayoutDuration')) * 1000
  const rec = (g(m1, 'RecalcStyleDuration') - g(m0, 'RecalcStyleDuration')) * 1000
  await page.close()
  return { pct: +((task / SAMPLE) * 100).toFixed(2), task: +task.toFixed(1), script: +scr.toFixed(1), layout: +lay.toFixed(2), recalc: +rec.toFixed(2) }
}
const PINS = [['rest', '1.rest'], ['advance', '0.62.advance'], ['small', '0.08.advance'], ['complete', '1.complete']]
for (const key of ['v1', 'v2']) {
  for (const tier of ['eco', 'standard', 'smooth']) {
    for (const [pname, pin] of PINS) {
      const runs = []
      for (let i = 0; i < REPS; i++) runs.push(await measure(key, tier, pin))
      const pcts = runs.map(r => r.pct)
      report.cpu[key + '/' + tier + '/' + pname] = {
        key, tier, ph: pname, reps: REPS, sample_ms: SAMPLE,
        pct_runs: pcts, pct_median: median(pcts),
        script_ms_median: median(runs.map(r => r.script)),
        layout_ms_median: median(runs.map(r => r.layout)),
        recalc_ms_median: median(runs.map(r => r.recalc))
      }
      console.log('CPU', key, tier, pname, pcts.join('/'), '-> median', median(pcts) + '%')
    }
  }
}
/* 基线：暂停（完全静止） */
{
  const runs = []
  for (let i = 0; i < REPS; i++) {
    const page = await browser.newPage({ viewport: { width: 1260, height: 1000 } })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.goto(PAGE.v2, { waitUntil: 'load' })
    await page.click('#toggle')
    await page.waitForTimeout(1500)
    const m0 = await cdp.send('Performance.getMetrics')
    await page.waitForTimeout(SAMPLE)
    const m1 = await cdp.send('Performance.getMetrics')
    const g = (m, n) => { const x = m.metrics.find(v => v.name === n); return x ? x.value : 0 }
    runs.push(+((((g(m1, 'TaskDuration') - g(m0, 'TaskDuration')) * 1000 / SAMPLE) * 100).toFixed(2)))
    await page.close()
  }
  report.cpu['baseline/paused'] = { pct_runs: runs, pct_median: median(runs) }
  console.log('CPU baseline paused', runs.join('/'), '-> median', median(runs) + '%')
}

await browser.close()
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('REPORT ->', OUT)
