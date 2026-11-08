'use strict';
// 合成数据，无数据库或 AI：待审核界面必须暴露空题干并可进入编辑。
const assert=require('assert'); let chromium;
try{({chromium}=require('playwright'))}catch(_){try{({chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}catch(_){console.log('跳过空题干浏览器测试：Playwright 不可用');process.exit(0)}}
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{const p=await b.newPage();
 await p.setContent('<!doctype html><body></body>');
 await p.evaluate(()=>{window.ADM={page:{}};window.esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');window.ic=()=>'';window.pagerHTML=()=>'';window.optText=o=>typeof o==='string'?o:o.text;window.optLabel=(o,i)=>o.label||String.fromCharCode(65+i);window.api=async()=>({page:1,size:20,total:1,counts:{},status_counts:{},list:[{id:'run:1:0:empty',kind:'run',source:'photo',source_label:'拍照识别',batch_id:1,batch_title:'测试',index:0,qno:'13',type:'single',type_name:'单选题',stem:'',material:'',options:[{label:'A',text:'选项'}],images:[],original_page:1,original_pages:1,source_pages:[1],answer:'',analysis:'',tags:[],figure_missing:[],image_errors:[]}]});window.modal=o=>{window.editBody=o.body;return {}};});
 await p.addScriptTag({path:require('path').join(__dirname,'public/admin/pendingui.js')});
 const html=await p.evaluate(async()=> (await viewPending()).html);await p.setContent(html);
 assert((await p.locator('body').innerText()).includes('题干缺失，待补录'));assert((await p.locator('body').innerText()).includes('原题号 13'));
 assert((await p.locator('[data-act="original"]').count())>=1);assert.equal(await p.locator('[data-act="edit"]').count(),1);
 await p.evaluate(()=>pdEdit({source_label:'拍照识别',type:'single',subject:'数学',stage:'junior',grade:'',stem:'',material:'',options:[{label:'A',text:'选项'}],answer:'',analysis:'',point:'',images:[],match_prompts:[]}));
 assert((await p.evaluate(()=>window.editBody)).includes('id="pdE-stem"')); console.log('空题干卡浏览器提示、原页入口与编辑控件通过');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
