/* 空闲（静止呼吸）态：三档的自转是否真的按档位在动 / 省电档是否完全静止 */
const PW = 'file:///C:/Users/david/.dsh/profiles/web/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const P = `(function(){
  var L = document.querySelector('.lyr-IDLE');
  function q(c){ return L ? L.querySelector(c) : null }
  var sg = q('.seg'), cl = q('.cloud'), pg = q('.prog'), ga = q('.glowA'), co = q('.core')
  return { ticks: Number(document.body.dataset.ticks), state: document.body.dataset.state, p: document.body.dataset.p,
    tier: document.body.dataset.fpstier, ring: pg ? pg.getAttribute('opacity') : null,
    seg: sg ? getComputedStyle(sg).transform : 'no-seg',
    cloud: cl ? getComputedStyle(cl).transform : 'no-cloud',
    glowA: ga ? ga.getAttribute('opacity') : null,
    core: co ? co.getAttribute('opacity') : null }
})()`
const out = {}
for (const v of ['v1-reuse-arcs', 'v2-outer-ring']) {
  out[v] = {}
  for (const tier of ['eco', 'standard', 'smooth']) {
    const pg = await b.newPage({ viewport: { width: 1260, height: 1000 } })
    await pg.goto('file:///C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto/' + v + '.html?pin=1.rest', { waitUntil: 'load' })
    await pg.click('[data-tier="' + tier + '"]')
    await pg.waitForTimeout(1200)
    const a = await pg.evaluate(P)
    await pg.waitForTimeout(2500)
    const c = await pg.evaluate(P)
    out[v][tier] = {
      tier_in_page: c.tier, state: c.state,
      ticks_delta_2500ms: c.ticks - a.ticks,
      ring_painted_at_rest: c.ring,
      cloud_moving: a.cloud !== c.cloud,
      cloud_tf: c.cloud,
      seg_present: c.seg !== 'no-seg',
      seg_moving: c.seg !== 'no-seg' && a.seg !== c.seg,
      glowA_opacity: [a.glowA, c.glowA],
      core_opacity: [a.core, c.core],
      breath_changing: a.glowA !== c.glowA
    }
    await pg.close()
  }
}
console.log(JSON.stringify(out, null, 1))
await b.close()
