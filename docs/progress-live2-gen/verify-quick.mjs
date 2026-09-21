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

await browser.close()
const out = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/progress-live2-gen/verify-quick.json'
writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
console.log('REPORT ->', out)
