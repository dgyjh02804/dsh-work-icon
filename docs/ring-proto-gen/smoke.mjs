const PW = 'file:///C:/Users/david/.dsh/profiles/web/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
for (const f of ['v1-reuse-arcs', 'v2-outer-ring']) {
  const p = await b.newPage({ viewport: { width: 1260, height: 1000 } })
  const errs = []
  p.on('pageerror', e => errs.push('PAGEERROR:' + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text()) })
  await p.goto('file:///C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto/' + f + '.html', { waitUntil: 'load' })
  await p.waitForTimeout(2200)
  const r = await p.evaluate(() => {
    const ls = [...document.querySelectorAll('.lyr')]
    const vis = ls.filter(e => getComputedStyle(e).display !== 'none')
    const L = vis[0]
    const q = c => L ? L.querySelector(c) : null
    const pr = q('.prun'), sg = q('.seg'), cl = q('.cloud'), pf = q('.pfill')
    return {
      ticks: document.body.dataset.ticks, state: document.body.dataset.state, p: document.body.dataset.p,
      visibleLayers: vis.length, visibleSt: L ? L.getAttribute('data-st') : null,
      runTf: pr ? getComputedStyle(pr).transform : null,
      segTf: sg ? getComputedStyle(sg).transform : null,
      cloudTf: cl ? getComputedStyle(cl).transform : null,
      dash: pf ? pf.getAttribute('stroke-dasharray') : null,
      jserr: (document.getElementById('jserr') || {}).textContent || '',
      paintedPrimitives: vis.reduce((a, e) => a + e.querySelectorAll('*').length, 0),
      title: document.title
    }
  })
  console.log(f, JSON.stringify(r))
  console.log('  errors:', errs.length ? errs.join(' | ') : 'none')
  await p.close()
}
await b.close()
