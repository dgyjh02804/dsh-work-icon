const P='file:///C:/Users/david/.dsh/profiles/web/node_modules/playwright/index.mjs';
const {chromium}=await import(P);
const fs=await import('node:fs');
const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
for (const id of ['ladder','azimuth','fan','moire']) {
  const page=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:2});
  const pts=[['05','0.05.advance'],['50','0.50.advance'],['done','1.complete']];
  for (const [tag,pin] of pts) {
    await page.goto('file:///C:/Users/david/.dsh/local-plugins/dsh-work-icon/docs/progress-live2/'+id+'.html?pin='+pin);
    await page.waitForTimeout(1000);
    const png=await page.screenshot({clip:{x:70,y:30,width:140,height:140}});
    fs.writeFileSync('shot-'+id+'-'+tag+'.png', png);
  }
  await page.close();
  console.log('shots for', id);
}
await b.close();
