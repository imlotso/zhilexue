/* Names and order: user-supplied directory. Exercise strings: locally authored. */
globalThis.showCourseDetails=course=>{
 let dialog=document.getElementById('courseDetails');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='courseDetails';dialog.className='course-details';dialog.innerHTML='<h2></h2><p></p><p>目前已按提供的目录收录名称和编号，原课内容尚未导入。此条目不会计入已完成课程。</p><form method="dialog"><button>返回目录</button></form>';document.body.append(dialog)}
 dialog.querySelector('h2').textContent=`第 ${course.id} 课 · ${course.name}`;
 dialog.querySelector('p').textContent=course.description;
 if(!dialog.open)dialog.showModal();
};
globalThis.COURSE_GROUPS=[['home','基准按键',1,19],['upper','上排字母',20,45],['lower','下排字母',46,67],['numbers','数字按键',68,93],['symbols','特殊符号',94,112],['jump','手指跳跃',113,130],['hands','左右手练习',131,142],['english1','英语基础1',143,194],['english2','英语基础2',195,250]].map(([id,name,start,end])=>({id,name,start,end}));
(() => {
 const sections=[
 '打字视频介绍§f 和 j 指法§练习 f和j§d和k§回顾 d和k§练习: fjdk§游戏: fjkd§s和l§回顾: s和l§练习: fjdksl§a和;§回顾:a 和 ;§练习:8个基准键§游戏:8个基准键§g 和 h§回顾:g 和 h§练习:asdfghjkl;§练习:asdfghjkl;§游戏:asdfghjkl;',
 'r 和 u§回顾:r 和 u§练习:r 和 u§e 和 i§回顾:e 和 i§练习:e 和 i§左手上排字母§右手上排字母§游戏: ruei§正确的坐姿§w 和 o§回顾:w 和 o§练习:w 和 o§游戏:上排字母§q 和 y§回顾:q 和 y§练习:q 和 y§p 和 t§回顾:p 和 t§练习:p 和 t§游戏:上排字母§回顾:基准键和上排字母§左手上排字母§右手上排字母§游戏:上排字母§游戏:上排字母',
 'v 和 m§回顾: v 和 m§练习: v 和 m§c 和 ,§回顾: c 和 ,§练习: c 和 ,§游戏: vmc,§x 和 .§回顾: x 和 .§练习: x 和 .§z 和 /§回顾: z 和 /§练习: z 和 /§游戏: 下排字母§b 和 n§回顾: b 和 n§练习: b 和 n§左手下排字母§右手下排字母§练习: 下排字母§游戏: 下排字母§游戏: 下排字母',
 '4 和 7§回顾: 4 和 7§练习: 4 和 7§3 和 8§练习: 3 和 8§练习: 3 和 8§2 和 9§回顾: 2 和 9§练习: 2 and 9§1 和 0§回顾: 1 和 0§练习: 1 和 0§5 和 6§回顾: 5 和 6§练习: 5 和 6§游戏: 0~9§回顾: 4 和 5§回顾: 3 和 2§回顾: 1 和 5§回顾: 6 和 7§回顾: 8 和 9§回顾: 0 和 6§练习:1 到 5§练习: 6 到 0§回顾: 所有数字§游戏: 数字',
 'Tab 键§Shift 键§# 和 * 键§@ 和 ( 键§! 和 ) 键§% 和 ^ 键§= 和 - 键§【 和 】 键§\\和 | 键§· 键§游戏:特殊符号§大小写组合1§大小写组合2§大小写组合3§大小写组合4§大小写组合5§大小写组合6§大小写组合7§游戏:大小写组合',
 '右手食指跳跃§左手食指跳跃§右手中指跳跃§左手中指跳跃§右手无名指跳跃§左手无名指跳跃§右手小拇指跳跃§左手小拇指跳跃§手指跳跃 $§手指跳跃 #§手指跳跃 @§手指跳跃!§手指跳跃 %§手指跳跃 &§手指跳跃 *§手指跳跃 (§手指跳跃 )§手指跳跃 ^',
 '左手练习-拼音§右手练习-拼音§左手练习-拼音§右手练习-拼音§左手练习-拼音§右手练习-拼音§英文左手-英文§右手练习-英文§英文左手-英文§右手练习-英文§英文左手-英文§右手练习-英文',
 "Cacao Tree§Wooden Churches§Vasco da Gama§Solar System§Play: Words§Dogs§Spaces in English§puppies§Books§Play: Words§Singing Whales§Africa§Polyps§Photosynthesis§Astronauts§Cultural Diversity§Sharks§Biology§Play: Words§Typewriters§Pandas§Biologist§Keyboard Layout§Play: Words§Super Power§Mongolia's Capital§Chinese Art§Pandas, Part 2§Play Games§Dynamic Practice§Lose、Loose、Loss§Scence、Science§Thought、Fought§Hole、Whole§Prepare、Presence§Desert、Dessert§Piece、Peace§Definitely...§Ridiculous...§Scent、Cent§Dynamic Practice§eal§ate§ted§one§ame§tor§ine§ave§ound§age§Dynamic Practice",
 "San Francisco§Spoken Languages§New Mexico§Earthquake§Hurricane§Tectonic Plates§Aphelion§Make Twain Quote§Galaxies§Trains§Lightning Rods§Weather§Silverback§Manhattan§Inside Hurricanes§Play: Words§Native Americans§Astronomy§Speed of Light§Wind Farmes§Play: Words§Spanish New Year§Wild Dogs§Tornadoes§Chicago§Play: Words§Dynamic Practice§Energy formula§Formula§Math§Mention§Play: Bottom Row§Tiger§Natural Diamonds§Canada§Driverless Cars§Play: Words§Scandinavia§Air§France§Tallest Building§Play: Words§Sleeping Beauty§Hashtag§France Crepes§Russia§Play: Words§Ampersand§Coconut§Costa Rica§Jeanne d'Arc§Metabolism§Country Music§Formal Education§Frogs§Dynamic Practice"
 ];
 const sets={};
 function range(a,b,keys){for(let n=a;n<=b;n++)sets[n]=keys}
 [[2,3,'fj'],[4,5,'dk'],[6,7,'fjdk'],[8,9,'sl'],[10,10,'fjdksl'],[11,12,'a;'],[13,14,'asdfjkl;'],[15,16,'gh'],[17,19,'asdfghjkl;'],[20,22,'ru'],[23,25,'ei'],[26,26,'qwert'],[27,27,'yuiop'],[28,28,'ruei'],[30,32,'wo'],[33,33,'qwertyuiop'],[34,36,'qy'],[37,39,'pt'],[40,41,'qwertyuiopasdfghjkl;'],[42,42,'qwert'],[43,43,'yuiop'],[44,45,'qwertyuiop'],[46,48,'vm'],[49,51,'c,'],[52,52,'vmc,'],[53,55,'x.'],[56,58,'z/'],[59,59,'zxcvbnm,./'],[60,62,'bn'],[63,63,'zxcvb'],[64,64,'nm,./'],[65,67,'zxcvbnm,./'],[68,70,'47'],[71,73,'38'],[74,76,'29'],[77,79,'10'],[80,82,'56'],[83,83,'1234567890'],[84,84,'45'],[85,85,'32'],[86,86,'15'],[87,87,'67'],[88,88,'89'],[89,89,'06'],[90,90,'12345'],[91,91,'67890'],[92,93,'1234567890'],[94,94,'\t'],[95,95,'aAbBfFjJ'],[96,96,'#*'],[97,97,'@('],[98,98,'!)'],[99,99,'%^'],[100,100,'=-'],[101,101,'[]'],[102,102,'\\|'],[103,103,'`'],[104,104,'!@#$%^&*()'],[105,111,'aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ'],[112,112,'aAfFjJ'],[113,113,'yuhjnm'],[114,114,'rtfgvb'],[115,115,'ik,'],[116,116,'edc'],[117,117,'ol.'],[118,118,'wsx'],[119,119,"p;/'"],[120,120,'qaz']].forEach(x=>range(...x));
 '$#@!%&*()^'.split('').forEach((k,i)=>sets[121+i]=k);
 function drill(keys,seed){const words=[];for(let w=0;w<16;w++){let word='';for(let c=0;c<2+(w%3);c++){seed=(seed*1664525+1013904223)>>>0;word+=keys[seed%keys.length]}words.push(word)}return words.join(' ')}
 globalThis.COURSE_CATALOG=sections.flatMap((section,g)=>section.split('§').map((name,i)=>{
  const id=COURSE_GROUPS[g].start+i,game=/游戏|^Play/.test(name),available=!!sets[id]&&!game;
  return{id,name,group:COURSE_GROUPS[g].id,kind:available?'practice':'pending',text:available?drill(sets[id],id):'',keys:sets[id]||'',description:available?'本地编写的键位练习，配合动态手势提示':game?'目录已收录 · 游戏内容待制作':id===1?'目录已收录 · 视频待提供':'目录已收录 · 课程正文待补充'};
 }));
 if(localStorage.htCatalogVersion!=='250-v1'){
  const mapping=[1,2,3,4,7,8,10,11,16,22,23,19,20,29,30,null,null,null,null,45,46,48,49,52,53,55,64,null,null,null];
  const oldDone=localStorage.htDone||'[]',oldLesson=localStorage.htLesson;
  localStorage.htLegacyProgress=JSON.stringify({done:oldDone,lesson:oldLesson??null});
  let parsed=[];try{parsed=JSON.parse(oldDone)}catch{}
  // 迁移目标必须是按学生隔离的 htSet（ht:uid:*），写回全局 key 新代码读不到、等于白迁
  const newDone=[...new Set((Array.isArray(parsed)?parsed:[]).filter(n=>Number.isInteger(n)&&mapping[n]!=null).map(n=>mapping[n]))];
  const newLesson=String(mapping[Number(oldLesson??1)]??1);
  if(typeof htSet==='function'){htSet('done',JSON.stringify(newDone));htSet('lesson',newLesson)}
  else{localStorage.htDone=JSON.stringify(newDone);localStorage.htLesson=newLesson}
  localStorage.htCatalogVersion='250-v1';
  if(typeof location!=='undefined'&&/^#lesson-\d+$/.test(location.hash))history.replaceState(null,'',`#lesson-${Number(newLesson)+1}`);
 }
})();
