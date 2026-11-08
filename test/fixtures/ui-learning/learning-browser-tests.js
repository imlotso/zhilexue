// Clickable browser regression. Runs against actual Vue and BankPages DOM.
window.runLearningTests=async()=>{
 const results=[];
 const check=(name,pass,detail='')=>{results.push({name,pass:!!pass,detail});parent.postMessage({suite:'learning',results},'*');if(!pass)throw Error(name+': '+detail);};
 const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out waiting for UI');};
 try{
  const app=window.__stuVm;await wait(()=>document.querySelector('.learn-home'));
  check('real API course title rendered',document.querySelector('#learnHeroTitle').textContent==='混合运算与数量关系');
  check('API-backed progress rendered',document.querySelector('progress').value===60);
  check('real task rows rendered',document.querySelectorAll('.learn-task-row').length===2);
  check('no horizontal viewport overflow',document.documentElement.scrollWidth<=innerWidth+1,document.documentElement.scrollWidth+' / '+innerWidth);
  document.querySelector('.st-theme-btn').click();await wait(()=>document.querySelector('.theme-menu'));
  check('theme picker visible',document.querySelector('.theme-menu').getBoundingClientRect().width>0);
  app.pickTheme('green');await app.$nextTick();check('theme selection applies',document.body.dataset.theme==='green');app.pickTheme('day');
  document.querySelector('.learn-primary').click();await wait(()=>app.page==='course'&&!app.loading);check('continue opens real course',document.querySelector('.r8-hero')&&app.course.id===990012);
  const courseTheme=document.querySelector('.st-theme-btn');check('course theme control fits its label',courseTheme.scrollWidth<=courseTheme.clientWidth+1,courseTheme.scrollWidth+' / '+courseTheme.clientWidth);
  app.goHome();await wait(()=>app.page==='home'&&!app.loading);
  document.querySelector('.learn-task-start').click();await wait(()=>document.querySelector('.quiz-mask'));
  check('task opens real quiz',!!document.querySelector('.quiz-mask'));
  document.querySelector('#qzClose').click();await wait(()=>!document.querySelector('.quiz-mask'));
  document.querySelector('.learn-practice-row').click();await wait(()=>document.querySelector('#pkEdition'));
  check('self practice opens actual edition selector',document.querySelector('.pk-sel-h').textContent.includes('章节组卷'));
  document.querySelector('#pkSelX').click();app.goHome();await wait(()=>app.page==='home'&&!app.loading);
  window.fixtureMode='empty';await app.load();check('empty course truthful',document.querySelector('#learnHeroTitle').textContent==='准备好开始学习了吗');check('empty tasks truthful',document.querySelector('.learn-empty').textContent.includes('暂无学习任务'));check('empty progress hidden',!document.querySelector('progress'));
  window.fixtureMode='error';await app.load();check('error clears stale course',document.querySelector('#learnHeroTitle').textContent==='课程暂时未能加载');check('error clears stale tasks',!document.querySelector('.learn-task-row'));
  window.fixtureMode='populated';await app.load();
  if(innerWidth<=760){document.querySelector('.learn-menu').click();await wait(()=>document.querySelector('.st-side').getBoundingClientRect().left===0);check('mobile nav opens',document.querySelector('.st-side').getBoundingClientRect().left===0);document.querySelector('.learn-nav-shade').click();await wait(()=>document.querySelector('.st-side').getBoundingClientRect().right<=0);check('mobile nav closes completely',!document.querySelector('.learn-nav-shade'));}
  check('no uncaught browser errors',window.fixtureErrors.length===0,JSON.stringify(window.fixtureErrors));
  results.push({name:'COMPLETE',pass:true});
 }catch(e){results.push({name:'ERROR',pass:false,detail:e.message});}
 parent.postMessage({suite:'learning',results},'*');window.learningTestResults=results;return results;
};
