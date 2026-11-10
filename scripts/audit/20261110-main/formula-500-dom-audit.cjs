// DOM adapter audit only. Fake MathLive/keyboard boundaries. NOT a visual/browser test.
const fs=require('fs'),assert=require('assert');const root=process.argv[2]||process.cwd();const {JSDOM}=require(require('module').createRequire(require('path').resolve(root,'package.json')).resolve('jsdom'));
(async()=>{
 const dom=new JSDOM('<!doctype html><body><textarea id="answer">前后</textarea></body>',{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;Object.defineProperty(w,'innerWidth',{value:500});
 class Field extends w.HTMLElement{constructor(){super();this.value='';}connectedCallback(){this.tabIndex=0;}getValue(){return this.value;}}
 w.customElements.define('math-field',Field);w.MathLive={MathfieldElement:Field};w.mathVirtualKeyboard={visible:false,container:w.document.body,show(){this.visible=true;},hide(){this.visible=false;}};
 const api=fs.readFileSync(root+'/public/js/api.js','utf8');w.eval(api.slice(api.indexOf('const DialogUX ='),api.indexOf('/** Element UI 风格弹窗'))+';window.DialogUX=DialogUX;');
 w.eval(fs.readFileSync(root+'/public/js/mlive.js','utf8'));
 let result=null;const handle=w.MLive.dialog({delimit:false,onOk:value=>result=value});await new Promise(r=>setTimeout(r,100));
 assert.equal(w.innerWidth,500);assert(w.document.querySelector('.t8-dlg[role="dialog"][aria-modal="true"]'));
 assert(w.mathVirtualKeyboard.visible);assert.equal(w.mathVirtualKeyboard.container.className,'t8-keyboard-host');
 w.document.querySelector('.t8-ok').click();assert.equal(result,null);assert.equal(w.document.activeElement.tagName,'MATH-FIELD');
 w.document.querySelector('math-field').value='x+1';w.document.querySelector('.t8-ok').click();assert.equal(result,'x+1');assert.equal(w.mathVirtualKeyboard.visible,false);assert.equal(w.mathVirtualKeyboard.container,w.document.body);assert.equal(w.document.querySelector('.t8-mask'),null);
 w.MLive.dialog();await new Promise(r=>setTimeout(r,100));w.document.querySelector('.t8-cancel').click();assert.equal(w.document.querySelector('.t8-mask'),null);assert.equal(w.mathVirtualKeyboard.visible,false);
 console.log('PASS DOM-only 500px metadata: modal ARIA, host assignment, empty-insert focus, nonempty submit, close/cancel cleanup');
 console.log('NOT TESTED: real MathLive rendering/expand-collapse, key hit areas, overlap, visual viewport, 500px screenshot');w.close();
})();
