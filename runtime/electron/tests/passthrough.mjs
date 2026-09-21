#!/usr/bin/env node
/* passthrough.mjs —— 点击穿透验证：**纯离屏 + exstyle 证据**，不显示窗口、不移动光标、不合成任何输入
 *
 * SPEC 第 10 节：禁止一切真实输入合成，也不拿真鼠标去点。所以穿透这件事分两段证明：
 *   ① 系统级开关：显式切换 setIgnoreMouseEvents 后读回窗口的 WS_EX_TRANSPARENT / WS_EX_LAYERED。
 *      这两个位就是 Windows 决定"点击是否跳过该窗口"的依据（隐藏窗口同样带位，所以不需要显示窗口）。
 *   ② 命中几何：把一组相对图标中心的偏移喂给 insideIcon()（与实时监看**同一段代码**），
 *      断言分界正好落在 r = 直径/2 ——  即"只在图标可绘的圆形区域内拦截，其余穿透"，
 *      而不是整个方形窗口都吃鼠标。
 * 用法: node tests/passthrough.mjs [scale]
 */
import fs from 'node:fs'
import path from 'node:path'
import { runRuntime, tmpHome, OUT, mkdir, sleep, section, report, killStrayElectron, runDir } from './harness.mjs'

const SCALE = Number(process.argv[2] || 140)
const DIR = runDir('passthrough')
const log = path.join(DIR, 'passthrough.log')
fs.rmSync(log, { force: true })
const home = tmpHome('passthrough')
let ok = true
const check = (n, v, d) => { ok = report(n, v, d) && ok }

section(`点击穿透验证（纯离屏：show=false，不移动光标、不合成输入）—— 尺寸 ${SCALE}px`)
const st = runRuntime(['--hidden', '--exstyle-probe', '--scale', String(SCALE), '--exit-after', '25'], { home, log })
const r = await st.waitExit(45000)
check('离屏取证会话正常结束（退出码 0）', !!r && r.code === 0, 'exit=' + (r && r.code))

const dbg = st.stdout.filter((l) => l.includes('"phase"')).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const ex = dbg.find((d) => d.phase === 'exstyle')
const geo = dbg.find((d) => d.phase === 'hit-geometry')
const lg = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''

check('窗口确实是隐藏的（show=false，全程没有显示过窗口）', !!ex && ex.hidden === true && /window created hidden/.test(lg),
  ex ? 'hidden=' + ex.hidden : '无 exstyle 证据')
check('未显示窗口也未移动光标：无 hit-test 轮询记录', !/hit-test cursor=/.test(lg), '鼠标监看轮询在取证前已暂停')

if (ex) {
  console.log('  ignore=off -> ' + ex.ignoreOff)
  console.log('  ignore=on  -> ' + ex.ignoreOn)
}
check('穿透关：WS_EX_TRANSPARENT 被清掉（此时圆形区域内由本窗口接收点击）',
  !!ex && /TRANSPARENT=no/.test(ex.ignoreOff), ex && ex.ignoreOff)
check('穿透开：WS_EX_TRANSPARENT 置上（系统级跳过本窗口 = 点击落到下层窗口）',
  !!ex && /TRANSPARENT=yes/.test(ex.ignoreOn), ex && ex.ignoreOn)
check('两次读到的 exstyle 不同（切换确实生效，不是没变化）',
  !!ex && ex.ignoreOff !== ex.ignoreOn, ex ? `${ex.ignoreOff.slice(0, 22)} vs ${ex.ignoreOn.slice(0, 22)}` : '')

if (geo) {
  console.log('  命中几何（f = 距圆心 / 半径）：' + geo.steps.map((s) => `${s.f}x=${s.inside ? 'IN' : 'out'}`).join(' '))
}
const steps = (geo && geo.steps) || []
const expectIn = steps.filter((s) => s.f <= 0.99)
const expectOut = steps.filter((s) => s.f >= 1.05)
const diag = steps.filter((s) => Math.abs(s.f - Math.SQRT2 * 0.7) < 1e-6)
check('圆内（≤0.99r）全部拦截', expectIn.length > 0 && expectIn.every((s) => s.inside === true),
  expectIn.map((s) => s.f + 'x:' + s.inside).join(' '))
check('圆外（≥1.05r）全部穿透', expectOut.length > 0 && expectOut.every((s) => s.inside === false),
  expectOut.map((s) => s.f + 'x:' + s.inside).join(' '))
check('四角方向按"圆"判定而非"方"（对角线 0.99r 在圆内、1.05r 在圆外）',
  diag.every((s) => s.inside === false) && steps.some((s) => s.f === 0.95 && s.inside === true),
  diag.map((s) => s.f + 'x:' + s.inside).join(' '))
check(`分界半径 = 直径/2 = ${(SCALE / 2).toFixed(1)}（窗口是 ${SCALE * 1.5}px，方角不吃鼠标）`,
  !!geo && Math.abs(geo.hitR - SCALE / 2) < 0.001, geo ? 'hitR=' + geo.hitR : '')

section(ok ? '点击穿透（离屏取证）：通过' : '点击穿透（离屏取证）：有失败项')
console.log('  说明：真实鼠标点击是否落到下层窗口，属于【只有真实输入才能验证】的项目，')
console.log('        由验收时用户手工做（≤30 秒合并一次），不由脚本做。')
killStrayElectron()
await sleep(200)
process.exit(ok ? 0 : 1)
