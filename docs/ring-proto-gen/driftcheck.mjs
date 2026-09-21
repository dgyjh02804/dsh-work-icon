import fs from 'node:fs'
const s = fs.readFileSync('C:/Users/david/.dsh/local-plugins/dsh-work-icon/runtime/electron/index.html', 'utf8')
const m = s.match(/<g id="base-h2">[\s\S]*?<\/g>\s*<\/defs>/)
console.log('base-h2 found:', !!m, 'length:', m ? m[0].length : 0)
if (m) {
  const now = m[0].replace(/\s*<\/defs>$/, '').trim()
  const norm = (x) => x.replace(/\s+/g, ' ').trim()
  // 与我生成时的快照比（gen.mjs 里写的长度是 1318）
  console.log('normalized length:', norm(now).length)
  console.log(norm(now).slice(0, 700))
  console.log('...')
  console.log(norm(now).slice(-260))
}
console.log('--- st- colors now ---')
const re = /\.st-(IDLE|THINKING|WORKING|WAITING|SUCCESS|ERROR|DISCONNECTED)\s*\{([^}]*)\}/g
let x
while ((x = re.exec(s))) console.log('  .st-' + x[1].padEnd(13), x[2].trim().slice(0, 95))
console.log('--- 是否已有进度环相关类 ---')
for (const k of ['prog', 'pfill', 'prun', 'ptrack', 'outer']) {
  console.log('  "' + k + '" 出现次数:', (s.match(new RegExp(k, 'g')) || []).length)
}
