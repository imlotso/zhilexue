const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const s = fs.readFileSync('public/js/vue-app.js','utf8');
test('home retains tasks and practice navigation', () => {
  assert.match(s, /if \(r\.key === 'home'\) \{ this\.page = 'home'/);
  for (const x of ['openHomeTask(task)', 'goHomeTasks', "goSelfPractice('textbook')", "goSelfPractice('knowledge')"]) assert.ok(s.includes('@click="'+x+'"'), x);
});
test('course exposes group practice and node mastery', () => {
  for (const x of ['doSectionPractice(activeGroup)', 'showNodeMastery(n)']) assert.ok(s.includes('@click="'+x+'"'), x);
});
