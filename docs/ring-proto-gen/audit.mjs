import fs from 'node:fs'
const DIR = 'C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto/'
for (const f of ['v1-reuse-arcs.html', 'v2-outer-ring.html', 'index.html']) {
  const s = fs.readFileSync(DIR + f, 'utf8')
  const css = (s.match(/<style>[\s\S]*?<\/style>/g) || []).join('')
  const cnt = (re) => (s.match(re) || []).length
  const ccnt = (re) => (css.match(re) || []).length
  // 只看 CSS **声明**（属性名后必须跟冒号），否则会误命中正文里"无 backdrop-filter、无 box-shadow"这类说明
  const decl = (p) => ccnt(new RegExp('(^|[;{\\s])' + p + '\\s*:', 'g'))
  console.log(f.padEnd(20),
    'bytes ' + String(s.length).padStart(7),
    '| layers ' + cnt(/class="lyr /g),
    '| plate ' + cnt(/class="plate"/g),
    '| seg60 ' + cnt(/r="60" fill="none"/g),
    '| outer88 ' + cnt(/r="88"/g),
    '| probe ' + (s.includes("data-ticks") ? 'Y' : 'N') + (s.includes("getElementById('jserr')") ? '/Y' : '/N'),
    '| css decl backdrop/blur/boxshadow ' + decl('backdrop-filter') + '/' + decl('filter') + '/' + decl('box-shadow'),
    '| mojibake ' + (/\uFFFD/.test(s) ? 'Y' : 'N'))
}
// 关键定义是否还在（避免整段替换丢函数）
for (const f of ['v1-reuse-arcs.html', 'v2-outer-ring.html']) {
  const s = fs.readFileSync(DIR + f, 'utf8')
  const need = ['function initLayers', 'function setState', 'function activeLayers', 'function renderRing',
    'function stepPhase', 'function renderText', 'function frame', 'function schedule', 'function kick',
    'function paintProbe', 'var TIERS', 'var PH =', 'var SESS =', 'var SUB =']
  const miss = need.filter(n => !s.includes(n))
  console.log(f.padEnd(20), 'defs missing:', miss.length ? miss.join(', ') : 'none')
}
