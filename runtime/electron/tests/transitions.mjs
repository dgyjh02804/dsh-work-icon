#!/usr/bin/env node
/* transitions.mjs —— 状态切换必须 300ms 交叉淡入（禁止硬切）+ 粒子数插值过渡
 * 做法：用 --trans-test 在非冻结模式下抓「切换途中」的帧，再证明中间帧既不等于起始态也不等于终止态，
 *       且中间帧与两端的差异量级相当（= 混合，而不是瞬跳）。
 * 全程隐藏窗口。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runRuntime, tmpHome, OUT, GOLDEN, mkdir, killStrayElectron, sleep, section, report, runDir } from './harness.mjs'

const DIR = runDir('trans')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

function diff (a, b) {
  const r = spawnSync('node', [path.join(GOLDEN, 'compare.mjs'), a, b], { encoding: 'utf8' })
  const o = (r.stdout || '') + (r.stderr || '')
  const m = o.match(/差异占比\s*([\d.]+)%/)
  const e = o.match(/平均通道误差\s*:\s*([\d.]+)/)
  return { ratio: m ? Number(m[1]) : NaN, mean: e ? Number(e[1]) : NaN }
}
function meanLuma (f) {
  const r = spawnSync('node', ['-e', `
    const {createRequire}=require('node:module');const sharp=createRequire('C:/Users/david/.dsh/profiles/')('sharp');
    (async()=>{const {data,info}=await sharp(process.argv[1]).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let s=0;for(let i=0;i<data.length;i+=4)s+=data[i+1];console.log((s/(info.width*info.height)).toFixed(3))})()`, f], { encoding: 'utf8' })
  return Number((r.stdout || '').trim())
}

section('300ms 交叉淡入：抓切换途中帧（隐藏窗口，非冻结模式）')
const home = tmpHome('trans')
const log = path.join(DIR, 'trans.log')
fs.rmSync(log, { force: true })
const st = runRuntime(['--hidden', '--trans-test', DIR], { home, log })
const r = await st.waitExit(40000)
check('抓帧流程正常结束', !!r && r.code === 0, 'exit=' + (r && r.code))
const files = ['a-idle', 'b-mid080', 'c-mid200', 'd-work500', 'e-err120', 'f-err420'].map((n) => path.join(DIR, n + '.png'))
check('六个阶段帧都拿到了', files.every((f) => fs.existsSync(f)), files.filter((f) => !fs.existsSync(f)).join(','))

const D1 = diff(files[0], files[1])   // IDLE vs 切换后 ~80ms
const D2 = diff(files[0], files[2])   // IDLE vs 切换后 ~200ms
const D3 = diff(files[0], files[3])   // IDLE vs WORKING（终点）
const D4 = diff(files[4], files[5])   // ERROR 切换中途 vs 终点
const D5 = diff(files[3], files[4])   // WORKING vs ERROR 切换中途
const D6 = diff(files[3], files[5])   // WORKING vs ERROR 终点
const l = files.map(meanLuma)

console.log(`    帧序列绿通道均值：IDLE ${l[0]} → 80ms ${l[1]} → 200ms ${l[2]} → 500ms ${l[3]}`)
console.log(`    各帧与 IDLE 的差异：80ms ${D1.ratio}% / 200ms ${D2.ratio}% / 终点 ${D3.ratio}%`)
console.log(`    平均通道误差：80ms ${D1.mean} / 200ms ${D2.mean} / 终点 ${D3.mean}`)
console.log(`    ERROR 切换：WORKING→中途 ${D5.ratio}%，中途 vs 终点 ${D4.ratio}%，WORKING vs ERROR 终点 ${D6.ratio}%`)

check('两态本身差异显著（不是同一张图）', D3.ratio > 5, D3.ratio + '%')
check('过渡帧 != 起始态（不是硬切）', D1.ratio > 0.05 && D2.ratio > 0.05, `${D1.ratio}% / ${D2.ratio}%`)
check('过渡帧 != 终止态（不是硬切）', diff(files[1], files[3]).ratio > 0.05, diff(files[1], files[3]).ratio + '%')
check('亮度沿时间单调推进（= 逐帧插值，不是瞬跳）',
  l[0] < l[1] && l[1] < l[2] && l[2] <= l[3] + 0.01,
  `${l[0]} → ${l[1]} → ${l[2]} → ${l[3]}`)
check('过渡帧与起始态的差异随时间递增',
  D1.ratio < D2.ratio && D2.ratio < D3.ratio, `${D1.ratio} < ${D2.ratio} < ${D3.ratio}`)
check('ERROR 切换同样有中间过渡帧', D5.ratio > 0.05 && D4.ratio > 0.05, `中途 ${D5.ratio}% / ${D4.ratio}%`)

section(ok ? '交叉淡入：全部通过' : '交叉淡入：有失败项')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
