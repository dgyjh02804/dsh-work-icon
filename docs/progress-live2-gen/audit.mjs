import fs from 'node:fs'
const DIR = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/progress-live2/'
const FNS = { ladder: 'ladUpdate', azimuth: 'aziUpdate', fan: 'fanUpdate', moire: 'moiUpdate' }
const NAMES = { ladder: '姿态地平线', azimuth: '航道罗盘卡', fan: '粒迹扇形', moire: '干涉环场' }
let bad = 0
for (const id of Object.keys(FNS)) {
  const h = fs.readFileSync(DIR + id + '.html', 'utf8')
  const callOk = h.includes('  ' + FNS[id] + '(root, p, state)')
  const defOk = h.includes('function ' + FNS[id] + '(root, p, state)')
  const cnOk = h.includes(NAMES[id])
  const moji = /\uFFFD/.test(h)
  // 只审 CSS 块：正文说明里会出现这些字面量（"无 backdrop-filter、无 filter:blur、无 box-shadow"），不算违规
  const cssOnly = (h.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n')
  const bk = (cssOnly.match(/backdrop-filter/g) || []).length
  const blur = (cssOnly.match(/filter\s*:\s*blur/g) || []).length
  const bs = (cssOnly.match(/box-shadow/g) || []).length
  const kf = (h.match(/@keyframes/g) || []).length
  const anim = (h.match(/animation\s*:/g) || []).length
  const jserr = h.includes("document.getElementById('jserr')")
  const ticks = h.includes("document.body.setAttribute('data-ticks'")
  console.log(id.padEnd(8), 'def:' + (defOk ? 'Y' : 'N'), 'call:' + (callOk ? 'Y' : 'N'),
    'CN:' + (cnOk ? 'Y' : 'N'), 'mojibake:' + (moji ? 'Y' : 'N'),
    '| backdrop:' + bk, 'blur:' + blur, 'boxShadow:' + bs,
    '| @keyframes:' + kf, 'animation:' + anim, '| probe jserr:' + (jserr ? 'Y' : 'N'), 'ticks:' + (ticks ? 'Y' : 'N'))
  if (!callOk || !defOk || !cnOk || moji || bk || blur || bs || !jserr || !ticks) bad++
}
const idx = fs.readFileSync(DIR + 'index.html', 'utf8')
console.log('index.html  CN:' + (idx.includes('形状从那里长出来') ? 'Y' : 'N'),
  'mojibake:' + (/\uFFFD/.test(idx) ? 'Y' : 'N'),
  'links:' + (idx.includes('REFERENCES.md') && idx.includes('compare-stills.html') ? 'Y' : 'N'))
console.log(bad === 0 ? 'ALL SCHEME FILES OK' : 'PROBLEMS: ' + bad)
