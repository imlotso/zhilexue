'use strict';
// Every CI process which imports storage/AI must inherit safe test settings.
const assert=require('node:assert/strict'),fs=require('node:fs');
const workflow=fs.readFileSync('.github/workflows/ci.yml','utf8');
const globalEnv=(workflow.match(/^env:\n((?:[ \t]+[^\n]*\n)+)/m)||[])[1]||'';
for(const [name,value] of [['STORAGE_DRIVER','local'],['AI_MOCK','1'],['TTS_MOCK','1']]){
  assert.match(globalEnv,new RegExp('^  '+name+': [\'\"]?'+value+'[\'\"]?\\s*$','m'),name+' must cover all test processes, not only npm start');
}
console.log('CI: local storage and mock AI/TTS inherited by every test process');
