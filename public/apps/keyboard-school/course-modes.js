/* Lesson presentation and game rules reuse the typing engine and its hand poses. */
(() => {
 const baseLoad=load,baseRender=render,baseUpdate=update,baseFinish=finish;
 let step=0,misses=0,combo=0,bestCombo=0,demoTimer,lastCollected=0,gameFeedback='';
 const introduction=[['把手放好','左手放在 A S D F，右手放在 J K L ;。两个拇指靠近空格键。','f'],['找到定位键','摸摸 F 和 J 上的小凸起，不看键盘也能找到位置。','j'],['手随键位移动','按 R 时，左手向前移动，食指轻轻触键；放松后回到基准位。','r'],['轮到右手','按 U 时让右手自然向前移动，用右手食指触键。','u'],['空格与练习','用拇指按空格。先慢慢打准，再逐渐提速。',' ']];
 const posture=[['坐得自然','背部自然挺直，肩膀放松，双脚有支撑。不要弯腰贴近屏幕。',null],['放松手腕','手腕自然平直，不要向上折，也不要用力压在桌沿。','f'],['轻轻触键','手指自然弯曲，轻轻按键。移动到远处键位时，让手跟着移动。','r'],['记得休息','感觉疲劳时停下来，看看远处、活动身体。准备好后再继续。',null]];
 function steps(){return lesson===0?introduction:posture}
 function weakKeys(){let data={};try{data=JSON.parse(htGet('weak','{}')||'{}')}catch{}return Object.entries(data).filter(([k,n])=>k.length===1&&/[a-z0-9]/i.test(k)&&Number.isFinite(n)).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k)}
 load=i=>{
  clearTimeout(demoTimer);step=0;misses=0;combo=0;bestCombo=0;lastCollected=0;gameFeedback='';
  const l=lessons[Math.max(0,Math.min(i,lessons.length-1))];
  if(l.adaptive){const keys=weakKeys();if(!keys.length)keys.push('f','j','d','k','r','u');l.text=extendPractice(Array.from({length:18},(_,n)=>keys[n%keys.length]+keys[(n+1)%keys.length]+keys[n%keys.length]).join(' '))}
  document.body.classList.toggle('game-course',l.kind==='game');document.body.classList.toggle('guide-course',l.kind==='guide');
  const result=baseLoad(i);document.title=`第 ${lesson+1} 课 · ${lessons[lesson].name}`;
  if(l.kind==='guide')updateHandPose(steps()[step][2]);return result;
 };
 render=()=>{
  const l=lessons[lesson],box=$('words');
  if(l.kind==='guide'){
   const list=steps(),s=list[step];
   box.classList.remove('cards');box.innerHTML=`<div class="lesson-guide"><small>本地交互教学 · ${step+1} / ${list.length}</small><h2>${s[0]}</h2><p>${s[1]}</p><div><button data-guide="back" ${step===0?'disabled':''}>上一步</button><button data-guide="demo">演示一下</button><button data-guide="next">${step===list.length-1?'完成本课':'下一步'}</button></div></div>`;return;
  }
  if(l.kind==='game'){
   box.classList.remove('cards');const words=sequence.split(' ');let offset=0;let current=words.length-1;
   for(let i=0;i<words.length;i++){if(pos<=offset+words[i].length){current=i;break}offset+=words[i].length+1}
   const collected=current>lastCollected;lastCollected=current;
   box.innerHTML=`<div class="balloon-game ${gameFeedback==='wrong'?'game-oops':''}"><div class="game-score"><strong>🎈 彩虹气球岛</strong><b>⭐ ${current*10} 分</b><span>收集 ${current} / ${words.length}</span></div><div class="island-progress"><i style="width:${current/words.length*100}%"></i></div><div class="balloon-field"><div class="island-sun" aria-hidden="true">☀</div><div class="island-cloud cloud-one" aria-hidden="true"></div><div class="island-cloud cloud-two" aria-hidden="true"></div><div class="island-rainbow" aria-hidden="true"></div><div class="island-hills" aria-hidden="true"></div><div class="balloon-lane">${words.slice(current,current+3).map((word,n)=>`<div class="balloon-wrap color-${(current+n)%5} ${n===0?'aimed':''}"><small>${n===0?'▼ 打这个':'接下来'}</small><div class="word-balloon ${n===0?'target-balloon':''}">${[...word].map((c,j)=>`<span class="${n===0&&offset+j<pos?'hit':n===0&&offset+j===pos?'next-letter':''}">${displayChar(c)}</span>`).join('')}</div></div>`).join('')}</div><div class="island-mascot" aria-hidden="true">🐰 <span>🌼 🌷 🌼</span></div>${collected?'<div class="collect-reward" aria-hidden="true">✨ +10 ⭐<div>收集成功！</div></div><div class="island-confetti" aria-hidden="true">✦ ● ★ ◆ ✦</div>':''}</div><div class="game-help"><span>${gameFeedback==='wrong'?'🌱 没关系，看准字母再试试！':sequence[pos]===' '?'✨ 按空格，把气球收入背包！':'⌨ 输入「打这个」气球上的字符'}</span><b>🔥 ${combo} 连击</b></div><p class="game-gentle">不用抢时间，打准就能过关 · 最高连击 ${bestCombo}</p></div>`;gameFeedback='';return;
  }
  baseRender();requestAnimationFrame(()=>{const current=box.querySelector('.current');current?.scrollIntoView({block:'nearest',inline:'nearest'})});
 };
 update=()=>{baseUpdate();if(lessons[lesson].kind==='game')$('accuracy').textContent=pos+misses?Math.round(pos/(pos+misses)*100):100};
 finish=()=>{baseFinish();if(lessons[lesson].kind==='game')$('finishAccuracy').textContent=Math.round(pos/(pos+misses)*100);if(lessons[lesson].kind==='guide'){$('finishSpeed').textContent='—';$('finishAccuracy').textContent='—'}};
 $('words').addEventListener('click',e=>{
  const button=e.target.closest('[data-guide]');if(!button)return;
  const action=button.dataset.guide;
  if(action==='demo'){clearTimeout(demoTimer);const key=steps()[step][2];updateHandPose(key,true);demoTimer=setTimeout(()=>updateHandPose(null),650);return}
  if(action==='back')step=Math.max(0,step-1);
  if(action==='next'){if(step===steps().length-1){pos=sequence.length;start=Date.now();finish();return}step++}
  render();updateHandPose(steps()[step][2]);
 });
 document.addEventListener('keydown',e=>{
  if(document.body.classList.contains('school-mode')||document.querySelector('dialog[open]')||!$('finish').hidden||$('drawer').classList.contains('open')||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  const l=lessons[lesson];
  if(l.kind==='guide'){if(e.key.length===1){e.preventDefault();e.stopImmediatePropagation();updateHandPose(e.key,true)}return}
  if(e.key.length!==1||e.repeat)return;
  if(!paused&&e.key!==sequence[pos]){let weak={};try{weak=JSON.parse(htGet('weak','{}')||'{}')}catch{}const key=sequence[pos];if(key&&key!==' ')weak[key]=(Number(weak[key])||0)+1;htSet('weak',JSON.stringify(weak))}
  if(l.kind!=='game')return;
  e.preventDefault();e.stopImmediatePropagation();
  if(paused){togglePause(false);return}
  if(e.key!==sequence[pos]){misses++;combo=0;gameFeedback='wrong';beep(false);strikeKey(e.key);render();update();return}
  combo++;bestCombo=Math.max(bestCombo,combo);type(e);
 },true);
 document.addEventListener('keyup',()=>{if(lessons[lesson].kind==='guide'&&!document.body.classList.contains('school-mode'))updateHandPose(null)});
})();
