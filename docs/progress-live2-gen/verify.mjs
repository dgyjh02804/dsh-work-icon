/* progress-live2 verifier
 * 1) 真动效验证：tick 是否递增、#jserr 是否为空、DOM 是否真的在变
 * 2) 合规静态检查：无 backdrop-filter / filter:blur / box-shadow；只读 transform/opacity/background-position
 * 3) 三档 CPU 实测：CDP Performance.getMetrics 的 TaskDuration，换算成"单核占比 %"
 * 全部离屏（headless），不弹窗，不碰用户进程。
 */
// playwright 装在 DSH profile 里，本目录没有 node_modules —— 用绝对 file:// 路径 import
const PW = 'file:///C:/Users/david/.dsh/profiles/web/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
import { pathToFileURL } from 'node:url'
import { writeFileSync, existsSync } from 'node:fs'

const DIR = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/progress-live2'
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find(existsSync)
const SCHEMES = ['ladder', 'azimuth', 'fan', 'moire']
const EXEC = process.argv[2] || EDGE || undefined
const report = { ts: new Date().toISOString(), exec: EXEC || '(bundled chromium)', live: {}, static: {}, cpu: {}, cpuAll: {} }

function url (id, q) { return pathToFileURL(DIR + '/' + id + '.html').href + (q || '') }

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--disable-gpu'] })

const MAIN = {
  ladder: '.g .horizon',
  azimuth: '.g .card',
  fan: '.g .tracks',
  moire: '.g .grating'
}
const TRANS_PROBE = `(function(){ var out={}; var M=${JSON.stringify(MAIN)};
  for (var k in M) { var e=document.querySelector(M[k]); out[k]= e ? getComputedStyle(e).transform : null }
  return out })()`

/* ---------------- 1) 真动效 ---------------- */
for (const id of SCHEMES) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(url(id), { waitUntil: 'load' })
  const t0 = await page.evaluate(() => ({
    ticks: document.body.dataset.ticks,
    jserr: (document.getElementById('jserr') || {}).textContent || '',
    title: document.title
  }))
  await page.waitForTimeout(2500)
  const t1 = await page.evaluate((probeSrc) => ({
    ticks: document.body.dataset.ticks,
    jserr: (document.getElementById('jserr') || {}).textContent || '',
    title: document.title,
    p: document.body.dataset.p,
    state: document.body.dataset.state,
    tier: document.body.dataset.tier,
    trans: eval(probeSrc)
  }), TRANS_PROBE)
  const px1 = await page.screenshot({ clip: { x: 70, y: 30, width: 140, height: 140 } })
  await page.waitForTimeout(700)
  const t2 = await page.evaluate((probeSrc) => ({
    ticks: document.body.dataset.ticks,
    trans: eval(probeSrc)
  }), TRANS_PROBE)
  const px2 = await page.screenshot({ clip: { x: 70, y: 30, width: 140, height: 140 } })
  const pixelChanged = Buffer.compare(px1, px2) !== 0
  const vm = t1.trans[id]
  const vm2 = t2.trans[id]
  const domChanged = vm !== vm2
  const svgCount = await page.evaluate(() => document.querySelectorAll('svg.g').length)
  const primCount = await page.evaluate(() => document.querySelectorAll('svg.g *').length)
  const anims = await page.evaluate(() => document.getAnimations().length)
  report.live[id] = {
    ticks_t0: Number(t0.ticks), ticks_t1: Number(t1.ticks), ticks_t2: Number(t2.ticks),
    ticks_incremented: Number(t2.ticks) > Number(t1.ticks) && Number(t1.ticks) > Number(t0.ticks),
    tick_delta_2p5s: Number(t1.ticks) - Number(t0.ticks),
    jserr_t0: t0.jserr, jserr_t1: t1.jserr,
    jserr_empty: t0.jserr === '' && t1.jserr === '',
    title: t1.title,
    main_element: MAIN[id],
    computed_transform_v1: vm, computed_transform_v2: vm2, dom_changed: domChanged,
    pixel_diff_of_140px_icon: pixelChanged,
    state_at_t1: t1.state, p_at_t1: t1.p, tier_at_t1: t1.tier,
    svg_count: svgCount, svg_primitive_count: primCount, running_animations: anims
  }
  await page.close()
}

/* ---------------- 1b) 三档行为差异 ---------------- */
report.tiers = {}
for (const id of SCHEMES) {
  report.tiers[id] = {}
  for (const tier of ['eco', 'standard', 'smooth']) {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 } })
    await page.goto(url(id), { waitUntil: 'load' })
    await page.click('[data-tier="' + tier + '"]')
    await page.waitForTimeout(1500)
    const a = await page.evaluate(() => Number(document.body.dataset.ticks))
    const frozen_a = await page.evaluate(() => document.body.classList.contains('paused'))
    await page.waitForTimeout(3000)
    const b = await page.evaluate(() => Number(document.body.dataset.ticks))
    const attr = await page.evaluate(() => {
      const m = { ladder: '.g .horizon', azimuth: '.g .card', fan: '.g .tracks', moire: '.g .grating' }
      const e = document.querySelector(m[Object.keys(m).find(k => document.querySelector(m[k]) !== null)])
      return e ? e.style.transform : null
    })
    report.tiers[id][tier] = { ticks_delta_3s: b - a, body_paused: frozen_a, sample_transform: attr }
    await page.close()
  }
}

/* ---------------- 2) 静态合规 ---------------- */
for (const id of SCHEMES) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } })
  await page.goto(url(id), { waitUntil: 'load' })
  const res = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    const count = (re) => (css.match(re) || []).length
    // 逐元素检查 computed style 里有无被禁属性
    let badComputed = []
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.backdropFilter && cs.backdropFilter !== 'none') badComputed.push([el.tagName + '.' + el.className, 'backdropFilter=' + cs.backdropFilter])
      if (cs.boxShadow && cs.boxShadow !== 'none') badComputed.push([el.tagName + '.' + el.className, 'boxShadow=' + cs.boxShadow])
      if (cs.filter && cs.filter !== 'none') badComputed.push([el.tagName + '.' + el.className, 'filter=' + cs.filter])
    }
    // 收集所有 transition / animation 的 property
    const props = new Set()
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      String(cs.transitionProperty || '').split(',').forEach(s => { const t = s.trim(); if (t && t !== 'all' && t !== 'none') props.add(t) })
      const an = el.getAnimations ? el.getAnimations() : []
      for (const a of an) {
        const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : []
        for (const k of kf) for (const key of Object.keys(k)) if (key !== 'offset' && key !== 'computedOffset' && key !== 'easing' && key !== 'composite') props.add(key)
      }
    }
    return {
      keyframes_blocks: count(/@keyframes/g),
      animation_refs: count(/animation\s*:/g),
      backdrop_filter_in_css: count(/backdrop-filter/g),
      filter_blur_in_css: count(/filter\s*:\s*blur/g),
      box_shadow_in_css: count(/box-shadow/g),
      feGaussianBlur_in_dom: document.querySelectorAll('feGaussianBlur').length,
      animated_properties: [...props].sort(),
      forbidden_computed_hits: badComputed.slice(0, 10),
      inline_style_transform_js: true
    }
  })
  report.static[id] = res
  await page.close()
}

/* ---------------- 3) 三档 CPU 实测 ---------------- */
const SAMPLE_MS = 12000
async function measure (id, tier, state) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const pin = state === 'complete' ? '1.complete' : '0.45.advance'
  await page.goto(url(id, '?measure=1&pin=' + pin), { waitUntil: 'load' })
  await page.click('[data-tier="' + tier + '"]')
  await page.waitForTimeout(1500)             // 预热：让 style recalc / layout 稳定
  const m0 = await cdp.send('Performance.getMetrics')
  await page.waitForTimeout(SAMPLE_MS)
  const m1 = await cdp.send('Performance.getMetrics')
  const g = (m, n) => { const x = m.metrics.find(v => v.name === n); return x ? x.value : 0 }
  const task = (g(m1, 'TaskDuration') - g(m0, 'TaskDuration')) * 1000   // ms
  const script = (g(m1, 'ScriptDuration') - g(m0, 'ScriptDuration')) * 1000
  const layout = (g(m1, 'LayoutDuration') - g(m0, 'LayoutDuration')) * 1000
  const recalc = (g(m1, 'RecalcStyleDuration') - g(m0, 'RecalcStyleDuration')) * 1000
  const ticks = await page.evaluate(() => Number(document.body.dataset.ticks))
  const alive = await page.evaluate(() => (document.getElementById('jserr') || {}).textContent || '')
  await page.close()
  return {
    tier, state, sample_ms: SAMPLE_MS,
    task_ms: +task.toFixed(1),
    single_core_pct: +((task / SAMPLE_MS) * 100).toFixed(2),
    script_ms: +script.toFixed(1), layout_ms: +layout.toFixed(2),
    recalc_style_ms: +recalc.toFixed(2),
    ticks_after_sample: ticks, jserr: alive
  }
}

const REPS = 3
function median (xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/* 三档 × 两种状态，在 azimuth（中等元素量）上做基准；每档跑 3 次取中位数 */
for (const tier of ['eco', 'standard', 'smooth']) {
  for (const state of ['advance', 'complete']) {
    const runs = []
    for (let i = 0; i < REPS; i++) runs.push(await measure('azimuth', tier, state))
    const pcts = runs.map(r => r.single_core_pct)
    report.cpu[tier + '/' + state] = {
      tier, state, reps: REPS, sample_ms: SAMPLE_MS,
      single_core_pct_runs: pcts,
      single_core_pct: median(pcts),
      task_ms_median: median(runs.map(r => r.task_ms)),
      script_ms_median: median(runs.map(r => r.script_ms)),
      layout_ms_median: median(runs.map(r => r.layout_ms)),
      recalc_style_ms_median: median(runs.map(r => r.recalc_style_ms)),
      ticks_after_sample: runs[0].ticks_after_sample,
      jserr: runs[0].jserr
    }
    console.log('CPU', tier, state, pcts.join('/') + ' -> median ' + median(pcts) + '%')
  }
}
/* 四套方案在同一档（standard / advance）下的横向对比，证明不同元素量代价确实不同 */
for (const id of SCHEMES) {
  const runs = []
  for (let i = 0; i < REPS; i++) runs.push(await measure(id, 'standard', 'advance'))
  const pcts = runs.map(r => r.single_core_pct)
  report.cpuAll[id] = { scheme: id, reps: REPS, sample_ms: SAMPLE_MS, single_core_pct_runs: pcts, single_core_pct: median(pcts) }
  console.log('CPU', id, 'standard/advance', pcts.join('/') + ' -> median ' + median(pcts) + '%')
}
/* 基线：整页暂停（完全静止） */
{
  const runs = []
  for (let i = 0; i < REPS; i++) {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 } })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.goto(url('azimuth', '?measure=1&pin=0.45.advance'), { waitUntil: 'load' })
    await page.click('#toggle')                 // 暂停 = 完全静止
    await page.waitForTimeout(1500)
    const m0 = await cdp.send('Performance.getMetrics')
    await page.waitForTimeout(SAMPLE_MS)
    const m1 = await cdp.send('Performance.getMetrics')
    const g = (m, n) => { const x = m.metrics.find(v => v.name === n); return x ? x.value : 0 }
    runs.push(+(((g(m1, 'TaskDuration') - g(m0, 'TaskDuration')) * 1000 / SAMPLE_MS) * 100).toFixed(2))
    await page.close()
  }
  report.cpu['baseline/static'] = { tier: 'baseline', state: 'static', reps: REPS, sample_ms: SAMPLE_MS, single_core_pct_runs: runs, single_core_pct: median(runs) }
  console.log('CPU baseline static', runs.join('/') + ' -> median ' + median(runs) + '%')
}

await browser.close()
const out = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/progress-live2-gen/verify-report.json'
writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
console.log('REPORT ->', out)
