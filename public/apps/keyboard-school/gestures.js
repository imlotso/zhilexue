/* Continuous hand silhouettes; the ten existing fingers are the only highlights. */
(() => {
  const svg = $('poseHands');
  const ns = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs) => {const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el};
  svg.replaceChildren();
  const special = {backspace:'右手小指',tab:'左手小指',capslock:'左手小指',enter:'右手小指',shift:'左手小指',ctrl:'左手小指',alt:'左手拇指',meta:'左手小指',menu:'右手小指'};
  const names=['小指','无名指','中指','食指','拇指'];
  const handNodes={};
  let preview=false, held=null, lastKey=null;
  for(const side of ['left','right']){
    const group=node('g',{'data-hand':side});
    const fill=node('path',{class:'gesture-fill'}),outline=node('path',{class:'gesture-outline'});
    group.append(fill,outline);
    const digits=names.map((name,i)=>{
      const path=node('path',{class:'gesture-digit','data-finger':(side==='left'?'左手':'右手')+name});
      const nail=node('path',{class:'gesture-nail'});group.append(path,nail);return{path,nail};
    });svg.append(group);handNodes[side]={group,fill,outline,digits};
  }
  function keyElement(key,side){
    const matches=[...document.querySelectorAll('.key')].filter(el=>el.dataset.key===key);
    return side==='right'?matches.at(-1):matches[0];
  }
  function point(key,side){
    const el=keyElement(key,side),r=$('keyboard').getBoundingClientRect();
    if(!el||!r.width)return null;
    const b=el.getBoundingClientRect();return{x:(b.left+b.width/2-r.left)*590/r.width,y:(b.top+b.height*.43-r.top)*590/r.width};
  }
  function normalize(key){if(!key)return null;const k=String(key).toLowerCase();return physicalKey(({control:'ctrl',contextmenu:'menu',spacebar:' '})[k]||k)}
  function owner(key,side){
    if(side&&['shift','ctrl','alt','meta'].includes(key))return(side==='left'?'左手':'右手')+(key==='alt'?'拇指':'小指');
    return fingers[key]||special[key];
  }
  // Each physical key selects a complete pose: wrist travel, neighboring fingers,
  // fingertip reach, knuckle bend and thumb angle all participate.
  function draw(key,tapping=false,sideHint){
    key=normalize(key);lastKey=key;
    const active=owner(key,sideHint),destination=point(key,sideHint);
    for(const side of ['left','right']){
      const left=side==='left',prefix=left?'左手':'右手',moving=active?.startsWith(prefix)&&destination;
      const homes=left?['a','s','d','f']:[';','l','k','j'];
      const mirror=x=>left?x:550-x;
      const activeIndex=names.findIndex(n=>prefix+n===active);
      const home=activeIndex===4?{x:mirror(259),y:190}:point(homes[Math.min(3,Math.max(0,activeIndex))],side);
      const travel=moving?destination.x-(home?.x||destination.x):0;
      const vertical=moving?destination.y-home.y:0;
      // Move the palm, wrist and every finger as one unit. Only the remaining
      // reach is handled by the active finger in the hand's local coordinates.
      const shiftX=moving?Math.max(-65,Math.min(65,travel*(activeIndex===4?.18:.62))):0;
      const shiftY=moving?Math.max(-70,Math.min(26,vertical*(activeIndex===4?.18:vertical<0?.76:.48))):0;
      handNodes[side].group.setAttribute('transform',`translate(${shiftX} ${shiftY})`);
      const localDestination=moving?{x:destination.x-shiftX,y:destination.y-shiftY}:null;
      const dx=0,dy=0;
      const segments=[],nails=[];
      for(let i=0;i<4;i++){
        let tip=point(homes[i],side)||{x:mirror(90+i*40),y:105};
        tip={...tip};const selected=moving&&activeIndex===i;
        if(selected){tip={...localDestination};tip.y+=tapping?4:-2}
        const bx=mirror([63,105,151,205][i])+dx*.45,by=[213,211,218,216][i]+dy;
        const width=[27,33,35,35][i],sign=left?1:-1;
        const x1=bx-sign*width/2,x2=bx+sign*width/2;
        const t1=tip.x-sign*width*.49,t2=tip.x+sign*width*.49;
        const curl=selected?Math.max(0,tip.y-107)*.55:0;
        const start=`${x1} ${by}`;
        const curve=`C ${x1+dx*.12} ${by-30} ${t1-sign*curl*.2} ${tip.y+55} ${t1} ${tip.y+17} C ${t1} ${tip.y-16} ${t2} ${tip.y-16} ${t2} ${tip.y+17} C ${t2+sign*curl*.35} ${tip.y+54} ${x2} ${by-23} ${x2} ${by}`;
        segments.push({start,curve,end:`${x2} ${by}`});
        nails.push(`M ${tip.x-sign*width*.29} ${tip.y+5} Q ${tip.x} ${tip.y+13} ${tip.x+sign*width*.29} ${tip.y+4}`);
      }
      const thumbActive=moving&&activeIndex===4;
      let tx=mirror(259)+dx*.4,ty=190+dy;
      if(thumbActive){tx=localDestination.x+(left?-19:19);ty=localDestination.y-8+(tapping?4:0)}
      const sign=left?1:-1;
      const thumb=`C ${mirror(234)+dx*.45} 209 ${tx-sign*16} ${ty-22} ${tx+sign*6} ${ty-4} C ${tx+sign*25} ${ty+11} ${tx+sign*6} ${ty+34} ${mirror(261)+dx*.45} 246 C ${mirror(254)+dx*.4} 280 ${mirror(240)+dx*.4} 314 ${mirror(238)+dx*.4} 360`;
      let silhouette=`M ${mirror(34)+dx*.4} 360 C ${mirror(39)+dx*.4} 297 ${mirror(40)+dx*.4} 256 ${segments[0].start} `;
      segments.forEach((seg,i)=>{if(i)silhouette+=`L ${seg.start} `;silhouette+=seg.curve+' '});
      silhouette+=thumb+` L ${mirror(34)+dx*.4} 360 Z`;
      const hand=handNodes[side];hand.fill.setAttribute('d',silhouette);
      // Only the outer palm edges are stroked; no palm oval crosses the fingers.
      hand.outline.setAttribute('d',`M ${mirror(34)+dx*.4} 360 C ${mirror(39)+dx*.4} 297 ${mirror(40)+dx*.4} 256 ${segments[0].start} M ${segments[3].end} ${thumb}`);
      hand.digits.forEach(({path,nail},i)=>{
        path.setAttribute('d',i<4?`M ${segments[i].start} ${segments[i].curve}`:`M ${segments[3].end} ${thumb}`);
        const on=moving&&activeIndex===i;path.classList.toggle('active',!!on);path.classList.toggle('tapping',!!on&&tapping);
        nail.setAttribute('d',i<4?nails[i]:`M ${tx} ${ty+2} Q ${tx+sign*12} ${ty+12} ${tx+sign*4} ${ty+22}`);
      });
    }
    svg.setAttribute('aria-label',active?`${key===' '?'空格':key}：${active}`:'双手放在基准键位，拇指自然靠近空格');
  }
  function light(key,side){document.querySelectorAll('.key').forEach(el=>el.classList.remove('active','pressed'));keyElement(normalize(key),side)?.classList.add('active')}
  updateHandPose=draw;
  strikeKey=(key)=>{clearTimeout(gestureTimer);held=normalize(key);light(held);draw(held,true);gestureTimer=setTimeout(()=>{if(held===normalize(key)){draw(held,false);if(!preview)target()}},145)};
  const button=document.createElement('button');button.className='gesture-demo-button';button.textContent='手势演示';button.type='button';button.setAttribute('aria-pressed','false');$('lessonName').after(button);
  const hint=document.createElement('div');hint.className='gesture-hint';hint.hidden=true;hint.textContent='按键盘或点击屏幕按键查看手势；松开后双手回到基准位。';$('workspace').prepend(hint);
  function rest(){held=null;clearTimeout(gestureTimer);light(null);draw(null)}
  button.onclick=()=>{preview=!preview;button.setAttribute('aria-pressed',String(preview));button.textContent=preview?'返回练习':'手势演示';hint.hidden=!preview;if(preview){clearInterval(timer);paused=true;$('paused').hidden=true;rest()}else{paused=false;if(start)timer=setInterval(update,500);target()} $('workspace').focus()};
  function previewKey(key,side){held=normalize(key);light(held,side);draw(held,true,side);hint.textContent=`${key===' '?'空格':key} · ${owner(held,side)||'基准位'}　松开回到基准位`}
  document.addEventListener('keydown',e=>{
    if(document.body.classList.contains('school-mode')||!preview)return;
    if(e.key==='Escape'){button.click();return}
    if((e.ctrlKey||e.metaKey||e.altKey)&&!['Control','Alt','Meta'].includes(e.key))return;
    if(!owner(normalize(e.key)))return;
    e.preventDefault();e.stopImmediatePropagation();previewKey(e.key,e.code.endsWith('Right')?'right':undefined);
  },true);
  document.addEventListener('keyup',()=>{if(preview&&!document.body.classList.contains('school-mode'))rest()});
  $('keyboard').addEventListener('pointerdown',e=>{
    const el=e.target.closest('.key');if(!el)return;
    if(!preview)button.click();e.preventDefault();
    const duplicates=[...document.querySelectorAll('.key')].filter(k=>k.dataset.key===el.dataset.key);
    previewKey(el.dataset.key,duplicates.length>1&&duplicates.at(-1)===el?'right':undefined);
  });
  window.addEventListener('pointerup',()=>{if(preview)rest()});
  window.addEventListener('blur',()=>{if(preview)rest()});
  window.addEventListener('resize',()=>draw(preview?held:paused?null:sequence[pos]));
  const originalLoad=load;
  load=i=>{preview=false;held=null;hint.hidden=true;button.textContent='手势演示';button.setAttribute('aria-pressed','false');originalLoad(i)};
  requestAnimationFrame(()=>draw(sequence[pos]));
})();
