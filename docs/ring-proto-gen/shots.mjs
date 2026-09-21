const PW='file:///C:/Users/david/.dsh/profiles/web/node_modules/playwright/index.mjs'
const {chromium}=await import(PW)
const fs=await import('node:fs')
const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
// 两个版本 × 三个进度点，只截图标区域（144px，deviceScaleFactor 2）
for (const [f,tag] of [['v1-reuse-arcs','v1'],['v2-outer-ring','v2']]) {
  const p=await b.newPage({viewport:{width:1260,height:1000},deviceScaleFactor:2})
  for (const [name,pin] of [['early','0.08.advance'],['mid','0.55.advance'],['done','1.complete']]) {
    await p.goto('file:///C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto/'+f+'.html?pin='+pin,{waitUntil:'load'})
    await p.waitForTimeout(900)
    const box=await p.locator('#ico1').boundingBox()
    await p.screenshot({path:'shot-ring-'+tag+'-'+name+'.png', clip:{x:box.x-18,y:box.y-18,width:box.width+36,height:box.height+36}})
  }
  // 深色桌面下的整条 bar + 悬浮层
  await p.goto('file:///C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/ring-proto/'+f+'.html?pin=0.62.advance',{waitUntil:'load'})
  await p.waitForTimeout(900)
  await p.screenshot({path:'shot-context-'+tag+'.png', clip:{x:0,y:40,width:620,height:300}})
  await p.close()
}
console.log('shots done')
await b.close()
