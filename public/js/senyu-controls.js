/* Shared date presentation only. The native input remains the value/validation source. */
(function(){
 'use strict';
 if(window.SenyuControls)return;
 var state=null,sequence=0;
 function unavailable(input){if(!themedDate(input)||!input.isConnected)return true;for(var el=input;el&&el.nodeType===1;el=el.parentElement){if(el.hidden||el.inert||el.getAttribute('aria-hidden')==='true')return true;var style=window.getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return true;}return false;}
 function themedDate(el){return el&&el.matches&&el.matches('input[type="date"]')&&el.closest('body.sy-theme')&&!el.disabled&&!el.readOnly;}
 function parse(value){if(!/^\d{4,}-\d{2}-\d{2}$/.test(value||''))return null;var d=new Date(value+'T12:00:00');return Number.isNaN(d.getTime())?null:d;}
 function iso(d){return String(d.getFullYear()).padStart(4,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
 function label(d){return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';}
 function close(restore){if(!state)return;var old=state;state=null;if(old.observer)old.observer.disconnect();old.popup.remove();Object.keys(old.aria).forEach(function(name){if(old.aria[name]===null)old.input.removeAttribute(name);else old.input.setAttribute(name,old.aria[name]);});if(restore&&old.input.isConnected)old.input.focus();}
 function allowed(value){var probe=state.input.cloneNode(false);probe.value=value;return !probe.validity.rangeUnderflow&&!probe.validity.rangeOverflow&&!probe.validity.stepMismatch&&!probe.validity.badInput;}
 function shiftMonth(date,amount){var day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()+amount);date.setDate(Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0,12).getDate()));return date;}
 function nearestAllowed(date,direction){
  var probe=state.input.cloneNode(false);probe.value=iso(date);
  if(probe.validity.rangeUnderflow){if(direction<0)return null;probe.value=state.input.min;}
  if(probe.validity.rangeOverflow){if(direction>0)return null;probe.value=state.input.max;}
  if(probe.validity.stepMismatch){try{direction>0?probe.stepUp():probe.stepDown();}catch(_){return null;}}
  var candidate=parse(probe.value);if(!candidate||!allowed(probe.value))return null;
  if(direction>0&&candidate<date||direction<0&&candidate>date)return null;return candidate;
 }
 function position(){if(!state)return;var r=state.input.getBoundingClientRect(),p=state.popup,b=p.getBoundingClientRect();p.style.left=Math.max(8,Math.min(r.left,window.innerWidth-b.width-8))+'px';p.style.top=Math.max(8,Math.min(r.bottom+6,window.innerHeight-b.height-8))+'px';}
 function commit(value){if(!state)return;var input=state.input;if(unavailable(input)){close(false);return;}if(value&&!allowed(value))return;var changed=input.value!==value;input.value=value;close(true);if(changed){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}}
 function render(focus){
  if(!state)return;var month=state.month,p=state.popup,year=month.getFullYear(),m=month.getMonth();
  p.innerHTML='<div class="sy-calendar-header"><button type="button" data-sy-month="-1" aria-label="上个月">‹</button><span class="sy-calendar-title" aria-live="polite">'+year+'年'+(m+1)+'月</span><button type="button" data-sy-month="1" aria-label="下个月">›</button></div><div class="sy-calendar-grid" role="group" aria-label="日期"><span class="sy-calendar-weekday">一</span><span class="sy-calendar-weekday">二</span><span class="sy-calendar-weekday">三</span><span class="sy-calendar-weekday">四</span><span class="sy-calendar-weekday">五</span><span class="sy-calendar-weekday">六</span><span class="sy-calendar-weekday">日</span></div><div class="sy-calendar-footer"><button type="button" data-sy-clear>清空</button><button type="button" data-sy-close>关闭</button></div>';
  var grid=p.querySelector('.sy-calendar-grid'),start=new Date(year,m,1,12);start.setDate(start.getDate()-((start.getDay()+6)%7));
  for(var i=0;i<42;i++){var date=new Date(start);date.setDate(start.getDate()+i);var value=iso(date),btn=document.createElement('button');btn.type='button';btn.textContent=String(date.getDate());btn.dataset.syDate=value;btn.dataset.outside=String(date.getMonth()!==m);btn.setAttribute('aria-label',label(date));btn.setAttribute('aria-pressed',String(value===state.input.value));if(value===iso(new Date()))btn.setAttribute('aria-current','date');btn.disabled=!allowed(value);btn.tabIndex=value===state.cursor?0:-1;grid.appendChild(btn);}
  position();if(focus){var target=grid.querySelector('[data-sy-date="'+state.cursor+'"]:not(:disabled)')||grid.querySelector('button:not(:disabled)')||p.querySelector('button');target.tabIndex=0;target.focus();}
 }
 function open(input){
  if(unavailable(input))return;if(state&&state.input===input)return;close(false);
  var d=parse(input.value)||parse(input.min)||new Date(),popup=document.createElement('div');popup.className='sy-calendar';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','选择日期');popup.setAttribute('aria-modal','false');popup.id='sy-calendar-'+(++sequence);var aria={};['aria-haspopup','aria-expanded','aria-controls'].forEach(function(name){aria[name]=input.getAttribute(name);});input.setAttribute('aria-controls',popup.id);input.setAttribute('aria-haspopup','dialog');input.setAttribute('aria-expanded','true');
  state={input:input,popup:popup,aria:aria,month:new Date(d.getFullYear(),d.getMonth(),1,12),cursor:iso(d)};document.body.appendChild(popup);render(true);
  state.observer=new MutationObserver(function(records){
   if(!state||state.input!==input)return;if(unavailable(input)){close(false);return;}
   if(records.some(function(r){return r.target===input&&['min','max','step','value'].includes(r.attributeName);}))render(popup.contains(document.activeElement));
  });state.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','aria-hidden','class','style','disabled','readonly','type','min','max','step','value']});
  popup.addEventListener('click',function(e){e.stopPropagation();var btn=e.target.closest('button');if(!btn||btn.disabled||!state)return;if(btn.hasAttribute('data-sy-date'))commit(btn.dataset.syDate);else if(btn.hasAttribute('data-sy-month')){state.month.setMonth(state.month.getMonth()+Number(btn.dataset.syMonth));state.cursor=iso(state.month);render(true);}else if(btn.hasAttribute('data-sy-clear'))commit('');else if(btn.hasAttribute('data-sy-close'))close(true);});
  popup.addEventListener('keydown',function(e){
   e.stopPropagation();if(!state)return;
   if(e.key==='Escape'){e.preventDefault();close(true);return;}
   if(e.key==='Tab'){
    var all=Array.from(popup.querySelectorAll('button:not(:disabled)')).filter(function(b){return b.tabIndex>=0;}),first=all[0],last=all[all.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}return;
   }
   var day=e.target.closest('[data-sy-date]');if(!day)return;
   var date=parse(day.dataset.syDate),direction=1,delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
   if(e.key in delta){direction=Math.sign(delta[e.key]);date.setDate(date.getDate()+delta[e.key]);}
   else if(e.key==='PageUp'||e.key==='PageDown'){direction=e.key==='PageUp'?-1:1;shiftMonth(date,direction);}
   else if(e.key==='Home'){direction=-1;date.setDate(date.getDate()-((date.getDay()+6)%7));}
   else if(e.key==='End'){date.setDate(date.getDate()+6-((date.getDay()+6)%7));}
   else return;
   e.preventDefault();date=nearestAllowed(date,direction);
   if(date){state.cursor=iso(date);state.month=new Date(date.getFullYear(),date.getMonth(),1,12);render(true);}
  });
 }
 document.addEventListener('click',function(e){if(themedDate(e.target)){e.preventDefault();open(e.target);}else if(state&&!state.popup.contains(e.target))close(false);});
 document.addEventListener('keydown',function(e){if(themedDate(e.target)&&e.altKey&&e.key==='ArrowDown'){e.preventDefault();open(e.target);}});
 window.addEventListener('resize',position);window.addEventListener('scroll',position,true);window.addEventListener('hashchange',function(){close(false);});
 window.SenyuControls={openDate:open,closeDate:function(input){if(state&&(!input||state.input===input))close(false);}};
})();
