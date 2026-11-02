/* Small reliability and export tools for the standalone distribution. */
(() => {
 let pausedAt=0;
 const oldPause=togglePause,oldLoad=load,oldUpdate=update;
 togglePause=force=>{
  const next=typeof force==='boolean'?force:!paused;
  if(next&&!paused)pausedAt=Date.now();
  if(!next&&pausedAt){if(start)start+=Date.now()-pausedAt;pausedAt=0}
  oldPause(force);
 };
 update=()=>{if(paused&&pausedAt)return;oldUpdate()};
 load=i=>{pausedAt=0;$('pauseBtn').classList.remove('active');return oldLoad(i)};
 // Holding a key should not silently complete a game or a line of text.
 document.addEventListener('keydown',e=>{
  const inLesson=!document.body.classList.contains('school-mode');
  if(inLesson&&(e.repeat||e.isComposing||$('drawer').classList.contains('open')||!$('settingsPanel').hidden)){
   if(e.key.length===1){e.stopImmediatePropagation();if(!e.isComposing)e.preventDefault()}
  }
 },true);
})();
