const fs=require('fs'),vm=require('vm'),assert=require('assert');const repo=process.argv[2]||process.cwd();const {JSDOM}=require(process.env.AUDIT_JSDOM_PATH || repo+'/node_modules/jsdom');
(async()=>{
const initial={campuses:[{id:'br1',name:'Synthetic campus A'}],exams:[],records:[{id:'r1',campusId:'br1',studentName:'Synthetic A',score:77,date:'2026-01'}],students:[],papers:[],parentUploads:[]};
const saved=new Map([['campus_grade_db_v1',JSON.stringify(initial)]]);const notices=[];let quota=false;
const box={localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>{if(quota)throw Error('QuotaExceededError');saved.set(k,v)}},U:{uid:()=> 'newid',today:()=> '2026-11-10',toast:(...x)=>notices.push(x)},fetch:async()=>({status:401,json:async()=>({code:401,msg:'Unauthorized'})}),console};vm.createContext(box);vm.runInContext(fs.readFileSync(repo+'/public/apps/grades/assets/js/store.js','utf8'),box);
vm.runInContext('Store.load()',box);const success=await vm.runInContext('Store.syncRoster()',box);assert.equal(success,false);assert.equal(vm.runInContext('Store.records()[0].score',box),77);
console.log('REPRO: no token, roster 401, previous-account local grade still returned');
quota=true;vm.runInContext("Store.updateRecord('r1',{score:88})",box);assert.equal(vm.runInContext('Store.records()[0].score',box),88);assert.equal(JSON.parse(saved.get('campus_grade_db_v1')).records[0].score,77);assert.equal(notices.length,0);
console.log('REPRO: quota failure silently accepted; memory score 88, persisted score 77, no error');
const html=fs.readFileSync(repo+'/public/apps/grades/parent-upload.html','utf8');const dom=new JSDOM(html,{url:'http://localhost/apps/grades/parent-upload.html?c=br1',runScripts:'outside-only'});let network=0;dom.window.fetch=()=>{network++;throw Error('unexpected network')};
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];dom.window.eval(script);
for(const [id,val]of Object.entries({pName:'Synthetic Parent',pExam:'Audit exam',pSubject:'数学',pFull:'100',pScore:'80'}))dom.window.document.getElementById(id).value=val;
dom.window.document.getElementById('pSubmit').click();assert(dom.window.document.getElementById('puCard').textContent.includes('提交成功'));assert.equal(network,0);assert.equal(JSON.parse(dom.window.localStorage.getItem('campus_grade_db_v1')).parentUploads.length,1);assert.equal(JSON.parse(saved.get('campus_grade_db_v1')).parentUploads.length,0);
console.log('REPRO: parent success only saved in parent browser; teacher store has zero submissions; no network call');
const kb={};vm.createContext(kb);vm.runInContext(fs.readFileSync(repo+'/public/apps/grades/assets/js/knowledge.js','utf8'),kb);
const generated=vm.runInContext("Knowledge.autoQuestions('数学',0.72,12)",kb);assert.equal(generated.length,12);assert(new Set(generated.map(q=>q.avgScore)).size>1);
console.log('REPRO: auto diagnosis creates '+generated.length+' varying knowledge-point scores from subject + aggregate rate only, without image/question evidence');
})();
