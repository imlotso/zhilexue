'use strict';
// 实际做题组件、样式及模拟答题接口；无需数据库或外部 AI。
const assert = require('assert');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { try { ({ chromium } = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); } catch (_) { console.log('跳过：Playwright 不可用'); process.exit(0); } }
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    for (const [width,height] of [[1440,900],[1100,800],[768,900],[390,844],[320,640]]) {
      const page = await browser.newPage({viewport:{width,height}});
      await page.setContent('<!doctype html><html><body></body></html>');
      await page.addStyleTag({path:path.join(__dirname,'public/css/app.css')});
      await page.evaluate(() => {
        window.esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        window.optText = o => typeof o === 'string' ? o : (o.text || o.content || '');
        window.t8Bind = () => {}; window.toast = () => {}; window.elConfirm = async () => true;
        window.Auth = {token:'test'}; window.api = async () => ({list:[{ungraded:true,answer:'',analysis:''}]});
        window.fetch = async () => { throw new Error('测试中不调用 AI'); };
      });
      await page.addScriptTag({path:path.join(__dirname,'public/js/bank.js')});
      await page.evaluate(() => BankQuiz.open({questions:[{id:1,type:'single',stem:'选择正确的选项',options:['长选项文字需要自动换行而且不能被截断'.repeat(8),'B 选项','C 选项','D 选项']}],submit:async()=>({})}));
      const inspect = async (open) => {
        const m = await page.evaluate(() => {
          const opts=[...document.querySelectorAll('.qz-opt')], r=opts.map(e=>e.getBoundingClientRect());
          const body=document.querySelector('.quiz-body'), box=document.querySelector('.quiz-box').getBoundingClientRect();
          const ai=document.querySelector('.r8-ai.show'); const a=ai && ai.getBoundingClientRect();
          return {rows:r.map(x=>({x:x.x,y:x.y,right:x.right,bottom:x.bottom})),parent:body.getBoundingClientRect().toJSON(),textOverflow:opts.some(e=>e.scrollWidth>e.clientWidth+1),box:box.toJSON(),ai:a && a.toJSON(),columns:getComputedStyle(document.querySelector('.qz-opts')).gridTemplateColumns.split(' ').length};
        });
        assert.equal(m.textOverflow,false,`${width}: 选项文字不能横向溢出`);
        assert(m.rows.every(x=>x.x>=m.parent.x-1 && x.right<=m.parent.right+1),`${width}: 选项不能超出题卡`);
        if (m.columns === 2) { assert(Math.abs(m.rows[0].y-m.rows[1].y)<1 && m.rows[1].x>m.rows[0].x,`${width}: A/B 同行`); assert(Math.abs(m.rows[2].y-m.rows[3].y)<1 && m.rows[2].y>m.rows[0].y,`${width}: C/D 次行`); }
        else assert(m.rows.every((r,i)=>!i || r.y>m.rows[i-1].y),`${width}: 窄屏单列`);
        if(open) assert(m.box.right<=m.ai.left+1 || m.box.bottom<=m.ai.top+1,`${width}: AI 面板不能遮住题卡`);
        return m.columns;
      };
      const cols = await inspect(false);
      assert.equal(cols,width<=390?1:2,`${width}: 响应式列数`);
      await page.locator('.qz-opt').nth(0).click(); await page.locator('#qzCheckOne').click();
      await page.locator('#qzAiFab').click(); await page.waitForSelector('.r8-ai.show');
      await page.waitForTimeout(350); await inspect(true);
      if (process.env.QUIZ_SCREENSHOT && width === 768) await page.screenshot({path:process.env.QUIZ_SCREENSHOT});
      await page.close();
    }
    const p=await browser.newPage(); await p.setContent('<body></body>');
    await p.evaluate(()=>{window.esc=s=>String(s==null?'':s);window.optText=o=>o;window.t8Bind=()=>{};window.toast=()=>{};window.elConfirm=async()=>true;window.api=async()=>({list:[{ungraded:true,answer:''}]});});
    await p.addScriptTag({path:path.join(__dirname,'public/js/bank.js')});
    await p.evaluate(()=>BankQuiz.open({questions:[{id:2,type:'judge',stem:'无标准答案的判断题'}],submit:async()=>({})}));
    await p.locator('.qz-jb').first().click(); await p.locator('#qzCheckOne').click();
    assert.equal(await p.locator('.qz-jb.r8-right, .qz-jb.r8-wrong').count(),0,'未评分判断题不能标记正确或错误');
    assert.equal(await p.locator('.qz-jb-r').count(),1,'没有参考答案时不显示空答案');
    await p.close(); console.log('选择题响应式两列、长文本、AI 避让及未评分判断题通过');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
