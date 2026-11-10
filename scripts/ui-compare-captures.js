'use strict';
// Render comparison documents from untouched reference and browser captures.
// No image editing, production service, remote uploads or network requests.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const ref=process.env.UI_REFERENCES||path.resolve(root,'../zhilexue-ui-concepts-20261108');
const out=path.join(root,'docs/ui-evidence-20261108/comparisons');
const scenes=[
 {name:'learning',reference:'01-智乐学-学生学习空间-概念图.png',actual:'docs/ui-evidence-20261108/learning/learning-1487.png',focus:{x:244,y:260,w:1216,h:386}},
 {name:'quiz',reference:'02-智乐学-固定答题工作台-概念图.png',actual:'evidence/ui-quiz/quiz-checked-1487.png',focus:{x:980,y:570,w:485,h:470}},
 {name:'review',reference:'03-智乐学-后台逐题审核-概念图.png',actual:'docs/ui-evidence-20261108/review/admin-review-1487.png',focus:{x:522,y:280,w:945,h:680}}
];
const data=file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{for(const scene of scenes){
  const images=[data(path.join(ref,scene.reference)),data(path.join(root,scene.actual))];
  for(const focused of [false,true]){
   const f=focused?scene.focus:{x:0,y:0,w:1487,h:1058};
   const page=await browser.newPage({viewport:{width:f.w*2,height:f.h+42},deviceScaleFactor:1});
   await page.setContent('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#fff;font:16px Arial;display:flex}section{width:'+f.w+'px}header{height:42px;padding:10px 16px;background:#e9eef5;border-right:1px solid #8190a7}.crop{width:'+f.w+'px;height:'+f.h+'px;position:relative;overflow:hidden}img{position:absolute;left:-'+f.x+'px;top:-'+f.y+'px;width:1487px;height:1058px;max-width:none}</style>'+images.map((src,i)=>'<section><header>'+(i?'实际浏览器渲染 · 隔离合成数据':'选定概念图 · 设计示例')+'</header><div class="crop"><img src="'+src+'"></div></section>').join(''));
   await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
   await page.screenshot({path:path.join(out,scene.name+(focused?'-focus':'-full')+'.png')});await page.close();
  }
 }console.log('Saved three equal-density full and focused comparison pairs to '+out);}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
