const {test}=require('node:test');const a=require('node:assert/strict'),fs=require('node:fs');
const v=fs.readFileSync('public/js/vue-app.js','utf8'),h=fs.readFileSync('public/index.html','utf8'),b=fs.readFileSync('public/js/bank.js','utf8');
test('original blue student shell replaces rounded redesign',()=>{a.match(v,/<div v-else class="st-layout st-biz st-rail">/);a.doesNotMatch(h,/href=".\/css\/ui-rounded-student/);a.match(h,/legacy-student-app/)});
test('current request and security behavior survives',()=>{a.match(v,/request !== this._videoRequest/);a.match(v,/stopCourseVideo\(\)/);a.match(v,/wrap.className = 'mask video-mask'/);a.match(v,/vid.removeAttribute\('src'\)/)});
test('original mistake overview retains export and full list',()=>{a.match(b,/class="bk2-buckets"/);a.match(b,/id="bkDocx"/);a.match(b,/id="bkAll"/);a.match(b,/actionIsCurrent/)});
