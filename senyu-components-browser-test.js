'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const read=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8'):'';
async function pageFor(t,width=1000){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height:800}});await page.route('**/*',r=>r.abort());
 await page.setContent('<html lang="zh-CN" data-ui-theme="senyu"><head><style>'+read('public/css/senyu-tokens.css')+read('public/css/senyu-components.css')+'</style></head><body class="sy-theme"><form><button type="button" class="sy-button sy-button--primary" id="save">保存分类</button><button type="button" class="sy-button sy-button--accent" id="commit">核对并入库</button><button type="button" class="sy-button sy-button--primary" disabled id="off">保存分类</button><button type="button" class="sy-button sy-button--secondary" id="cancel">取消</button><button type="button" class="sy-button sy-button--danger" id="remove">删除</button><label for="subject">学科</label><select id="subject"><option value="math">数学</option><option value="disabled" disabled>未开设</option><option value="english">英语</option></select><label for="day">日期</label><input id="day" type="date" value="2026-11-09" min="2026-11-02" max="2026-12-15"><button type="button" id="after">下一步</button></form><script>'+read('public/js/senyu-controls.js')+'</script></body></html>');
 return page;
}
test('shared actions remain distinct, accessible and disabled while adopting approved palette',async t=>{
 const p=await pageFor(t);const m=await p.evaluate(()=>Object.fromEntries(['save','commit','off'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e);return [id,{background:s.backgroundColor,color:s.color,height:e.getBoundingClientRect().height,disabled:e.disabled}]})));
 assert.equal(m.save.background,'rgb(12, 89, 75)');assert.equal(m.commit.background,'rgb(249, 201, 87)');assert.equal(m.commit.color,'rgb(20, 58, 51)');assert.ok(m.save.height>=44);assert.equal(m.off.disabled,true);
 await p.locator('#save').focus();assert.equal(await p.locator('#save').evaluate(e=>getComputedStyle(e).outlineColor),'rgb(12, 89, 75)');
});
test('native selectable options retain values, disabled semantics and real themed popup',async t=>{
 const p=await pageFor(t);assert.equal(await p.locator('#subject').evaluate(e=>getComputedStyle(e).appearance),'base-select');
 await p.locator('#subject').selectOption('english');assert.equal(await p.locator('#subject').inputValue(),'english');assert.equal(await p.locator('#subject option[value=disabled]').isDisabled(),true);
});
test('date picker preserves source input, range validation and input/change notifications',async t=>{
 const p=await pageFor(t);await p.evaluate(()=>{window.events=[];for(const type of ['input','change'])day.addEventListener(type,()=>events.push(type+':'+day.value));});
 await p.locator('#day').click();const dlg=p.getByRole('dialog',{name:'选择日期'});await dlg.waitFor();
 await p.getByRole('button',{name:'2026年11月1日',exact:true}).isDisabled().then(x=>assert.equal(x,true));
 await p.getByRole('button',{name:'2026年11月16日',exact:true}).click();assert.equal(await p.locator('#day').inputValue(),'2026-11-16');assert.deepEqual(await p.evaluate(()=>events),['input:2026-11-16','change:2026-11-16']);assert.equal(await dlg.count(),0);assert.equal(await p.evaluate(()=>document.activeElement.id),'day');
 await p.locator('#day').press('Alt+ArrowDown');await dlg.waitFor();await p.keyboard.press('Escape');assert.equal(await dlg.count(),0);assert.equal(await p.locator('#day').inputValue(),'2026-11-16');
});
test('date picker stays inside narrow viewport and respects disabled input',async t=>{
 const p=await pageFor(t,390);await p.locator('#day').click();const box=await p.getByRole('dialog',{name:'选择日期'}).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);await p.keyboard.press('Escape');await p.locator('#day').evaluate(e=>e.disabled=true);assert.equal(await p.getByRole('dialog',{name:'选择日期'}).count(),0);
});

test('all shared actions show actual hover and pressed states while disabled actions stay still',async t=>{
 const p=await pageFor(t);
 for(const [id,background] of [['save','rgb(9, 75, 63)'],['commit','rgb(241, 189, 61)'],['cancel','rgb(229, 241, 233)'],['remove','rgb(254, 243, 242)']]){
  await p.locator('#'+id).hover();await p.waitForFunction(({id,background})=>getComputedStyle(document.getElementById(id)).backgroundColor===background,{id,background});
  await p.mouse.down();await p.waitForFunction(id=>getComputedStyle(document.getElementById(id)).transform==='matrix(1, 0, 0, 1, 0, 1)',id);await p.mouse.up();
 }
 await p.locator('#off').hover();await p.mouse.down();assert.equal(await p.locator('#off').evaluate(e=>getComputedStyle(e).transform),'none');await p.mouse.up();
});
