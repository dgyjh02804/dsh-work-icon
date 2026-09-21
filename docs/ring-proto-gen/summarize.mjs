import fs from 'node:fs'
const r = JSON.parse(fs.readFileSync('C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto-gen/verify-report.json', 'utf8'))
console.log('===== LIVE =====')
for (const [k, v] of Object.entries(r.live)) {
  console.log(k, 'ticks', JSON.stringify(v.ticks), 'incr:' + v.ticks_incremented,
    '| p', JSON.stringify(v.p), 'advanced:' + v.p_advanced, '| jserr_empty:' + v.jserr_empty)
  console.log('   runTf', v.runTf_v1, '->', v.runTf_v2, '| changing:' + v.run_transform_changing)
  console.log('   dash', v.dash_v1, '| changing:' + v.dash_changing, '| state', v.state)
}
console.log('\n===== TIERS =====')
for (const [k, tt] of Object.entries(r.tiers)) {
  console.log(k)
  for (const [t, v] of Object.entries(tt)) console.log('  ', t.padEnd(9), JSON.stringify(v))
}
console.log('\n===== STATIC =====')
for (const [k, v] of Object.entries(r.static)) console.log(k, JSON.stringify(v))
console.log('\n===== ELEMENTS =====')
for (const [k, v] of Object.entries(r.elements)) console.log(k, JSON.stringify(v))
console.log('\n===== CPU 汇总 =====')
console.log('key'.padEnd(26), 'median%  runs  | script/layout/recalc ms')
for (const [k, v] of Object.entries(r.cpu)) {
  if (k === 'baseline/paused') { console.log(k.padEnd(26), v.pct_median + '%', JSON.stringify(v.pct_runs)); continue }
  console.log(k.padEnd(26), String(v.pct_median).padStart(5) + '%',
    ' ' + v.pct_runs.join('/'),
    ' | ' + v.script_ms_median + ' / ' + v.layout_ms_median + ' / ' + v.recalc_ms_median)
}
