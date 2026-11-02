/* The learning center reuses the existing lesson engine and local progress. */
(() => {
  const page = document.getElementById('schoolPage');
  let filter = 'all';
  const groups = [{id:'all',name:'全部课程'}, ...COURSE_GROUPS];
  const groupOf = i => lessons[i].group;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  page.innerHTML = `
    <div class="school-content">
      <section class="school-hero"><div><div class="school-eyebrow">从第一下按键开始</div><h1>让每一次练习，都成为看得见的进步。</h1><p>认识键盘 · 学习指法 · 练习英文，循序渐进，用十根手指轻松打字。</p><button class="school-primary" id="continueLearning">继续学习 →</button></div><div class="school-keys" aria-hidden="true">${'ASDFJKL;'.split('').map(k=>`<span>${k}</span>`).join('')}</div></section>
      <section class="school-records" aria-label="学习记录"><h2 class="school-section-title">学习记录</h2><div class="school-summary" id="progress"></div></section>
      <div class="school-filter"><h2 class="school-section-title">课程分类</h2><div class="school-tabs" aria-label="课程分类">${groups.map(g=>`<button class="school-tab ${g.id==='all'?'selected':''}" data-group="${g.id}" aria-pressed="${g.id==='all'}">${g.name}</button>`).join('')}</div></div>
      <div class="school-grid" id="courseGrid"></div>
    </div>`;
  function draw() {
    const done = doneLessons().filter(i => Number.isInteger(i) && lessons[i]);
    const percent = Math.round(done.length / lessons.length * 100);
    document.getElementById('progress').innerHTML = `<div class="school-stat"><strong>${done.length}</strong><span><b>已完成课程</b>共 ${lessons.length} 节课程</span></div><div class="school-stat"><strong>${percent}%</strong><span><b>学习进度</b><div class="school-progress"><i style="width:${percent}%"></i></div></span></div><div class="school-stat"><strong>${lessons.length-done.length}</strong><span><b>待探索课程</b>每一次练习都是新的进步</span></div><div class="school-stat school-printbox"><strong>🖨</strong><span><b>资料打印</b><span class="school-print-links"><a href="print/finger-return.jpg" download>手指回位图</a><a href="print/blind-order.jpg" download>盲打顺序图</a><a href="print/first10.jpg" download>先学10键图</a><a class="school-print-all" href="print.html" target="_blank">打印全部</a></span></span></div>`;
    const matches = lessons.map((l,i)=>({l,i})).filter(({l,i}) => filter==='all'||groupOf(i)===filter);
    let previousGroup=null;
    const grid=document.getElementById('courseGrid');
    grid.innerHTML = matches.map(({l,i}) => {
      const g=COURSE_GROUPS.find(g=>g.id===l.group),heading=previousGroup!==l.group?`<h3 class="catalog-group">${g.name}<small>第 ${g.start}–${g.end} 课</small></h3>`:'';previousGroup=l.group;
      return heading+`<button class="school-card" data-lesson="${i}"><div class="school-card-top"><span class="school-card-icon">${l.id}</span><span class="school-card-status ${done.includes(i)?'done':''}">${l.kind==='pending'?'待补充内容':done.includes(i)?'✓ 已完成':i===lesson?'正在学习':'待学习'}</span></div><h3>${escape(l.name)}</h3><p>${escape(l.description)}</p><div class="school-card-bottom"><span>第 ${l.id} 课${l.text?' · '+l.text.length+' 次按键':''}</span><b>${l.kind==='pending'?'查看明细':done.includes(i)?'再练一次':'开始学习'} →</b></div></button>`;
    }).join('') || '<p class="school-empty">没有找到相关课程，试试其他关键词。</p>';
    grid.scrollTop=0;
  }
  function openLesson(i) {
    i=Math.max(0,Math.min(i,lessons.length-1));
    if(lessons[i].kind==='pending'){home();showCourseDetails(lessons[i]);return}
    page.hidden = true;
    document.body.classList.remove('school-mode');
    load(i);
    history.replaceState(null,'',`#lesson-${i+1}`);
  }
  function home() {
    clearInterval(timer);clearTimeout(gestureTimer);closeDrawer();
    if(start && !paused) togglePause(true);
    document.body.classList.add('school-mode');page.hidden=false;draw();
    document.title='键盘学堂 · 学习中心';
  }
  page.addEventListener('click', e=>{
    const card=e.target.closest('[data-lesson]');if(card) openLesson(Number(card.dataset.lesson));
    const tab=e.target.closest('[data-group]');if(tab){filter=tab.dataset.group;page.querySelectorAll('[data-group]').forEach(b=>{b.classList.toggle('selected',b===tab);b.setAttribute('aria-pressed',String(b===tab))});draw()}
  });
  // Capture before the exercise listener: searching the catalog must not type a lesson.
  document.addEventListener('keydown',e=>{if(document.body.classList.contains('school-mode')) e.stopImmediatePropagation()},true);
  document.getElementById('continueLearning').onclick=()=>openLesson(lesson);
  document.getElementById('schoolReturn').onclick=()=>{history.replaceState(null,'','#school');home()};
  function route(){const match=location.hash.match(/^#lesson-(\d+)$/);if(match)openLesson(Number(match[1])-1);else home()}
  window.addEventListener('hashchange',route);
  route();
})();
