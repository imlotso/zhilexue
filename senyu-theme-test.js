'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM,VirtualConsole}=require('jsdom');
const files=['public/css/senyu-tokens.css','public/css/senyu-components.css','public/css/senyu-workspaces.css','public/css/senyu-uploads.css','public/css/senyu-student-navigation.css','public/apps/grades/assets/css/senyu-grades.css','public/apps/care/assets/css/senyu-care.css'];
const css=files.map(p=>fs.readFileSync(p,'utf8'));
test('theme stylesheet CSSOM parses and every shared token reference is defined',()=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM('<html data-ui-theme="senyu"><head>'+css.map(s=>'<style>'+s+'</style>').join('')+'</head><body class="sy-theme"></body></html>',{virtualConsole:vc});
 assert.deepEqual(errors,[]);assert.equal(dom.window.document.styleSheets.length,files.length);for(const sheet of dom.window.document.styleSheets)assert.ok(sheet.cssRules.length>0);
 const defined=new Set([...css[0].matchAll(/(--sy-[\w-]+)\s*:/g)].map(m=>m[1]));for(const s of css)for(const m of s.matchAll(/var\((--sy-[\w-]+)/g))assert.ok(defined.has(m[1]),m[1]+' must be defined');dom.window.close();
});
function luminance(h){const c=h.match(/[a-f\d]{2}/gi).map(s=>parseInt(s,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('approved theme action and reading color pairs meet normal text contrast',()=>{
 const value=name=>{const m=css[0].match(new RegExp('--sy-color-'+name+':(#[A-Fa-f0-9]{6})'));assert.ok(m,name);return m[1];};
 assert.equal(value('canvas'),'#F8F7F2');assert.equal(value('primary'),'#0C594B');assert.equal(value('surface-subtle'),'#E5F1E9');assert.equal(value('accent'),'#F9C957');assert.equal(value('ink'),'#143A33');
 for(const pair of [['#FFFFFF',value('primary')],[value('ink'),value('accent')],[value('muted'),value('canvas')],[value('muted'),'#FFFFFF']])assert.ok(contrast(...pair)>=4.5,pair.join('/'));
});

test('all four shared button variants declare hover feedback and enabled-only pressed feedback',()=>{
 const dom=new JSDOM('<style>'+css[1]+'</style>');
 try{const rules=[...dom.window.document.styleSheets[0].cssRules].filter(rule=>rule.selectorText);
 for(const kind of ['primary','accent','secondary','danger']){const selector='.sy-theme .sy-button--'+kind+':hover:not(:disabled)';const hover=rules.find(rule=>rule.selectorText===selector);assert.ok(hover,kind+' needs its own hover feedback');assert.ok(hover.style.getPropertyValue('background'),kind+' hover must change its surface');}
 const pressed=rules.find(rule=>rule.selectorText==='.sy-theme .sy-button:active:not(:disabled)');assert.ok(pressed,'all enabled variants need pressed feedback');assert.ok(pressed.style.getPropertyValue('transform')||pressed.style.getPropertyValue('box-shadow'));
 const disabled=rules.find(rule=>rule.selectorText==='.sy-theme .sy-button:disabled');assert.equal(disabled.style.getPropertyValue('transform'),'none');assert.equal(disabled.style.getPropertyValue('box-shadow'),'none');
 }finally{dom.window.close();}
});
