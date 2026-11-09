/* ==========================================================
   应用主控：路由 / 校区管理 / 图表管理
   （校区选择已下放到各页筛选区，顶栏不再承载检索与上传）
   ========================================================== */
const App = (() => {
  let route = 'dashboard';
  let param = '';
  const chartMap = new WeakMap();

  /* ---------- 图表 ---------- */
  function chart(canvas, config) {
    if (!canvas || typeof Chart === 'undefined') return;
    const old = chartMap.get(canvas);
    if (old) { try { old.destroy(); } catch (e) { } }
    // 关闭动画：保证导出图片 / PDF 时图表已完整绘制
    config.options = Object.assign({ animation: false, devicePixelRatio: 2 }, config.options || {});
    const inst = new Chart(canvas.getContext('2d'), config);
    chartMap.set(canvas, inst);
    return inst;
  }

  /* ---------- 路由 ---------- */
  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    const seg = h.split('/').filter(Boolean);
    route = seg[0] || 'dashboard';
    param = seg[1] ? decodeURIComponent(seg[1]) : '';
    if (route === 'import') route = 'records';   // 旧链接兼容
  }

  function render() {
    parseHash();
    const el = document.getElementById('mainView');
    document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.nav === route));
    buildSideStat();

    if (route === 'records') ViewRecords.render(el);
    else if (route === 'tracking') ViewTracking.render(el);
    else if (route === 'students') ViewStudents.render(el);
    else if (route === 'student') ViewProfile.render(el, param);
    else ViewDashboard.render(el);

    // 让侧栏高亮与旧链接一致
    if (route === 'student') {
      document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.nav === 'students'));
    }
    U.bindFieldLabels(el);
    document.querySelectorAll('.nav-item').forEach(a => {
      if (a.classList.contains('active')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function refresh() { render(); }

  /* ---------- 校区管理 ---------- */
  function campusModal() {
    const list = Store.campuses();
    U.modal({
      title: '校区管理',
      body: `
        <div class="field"><label>新增校区</label>
          <div style="display:flex;gap:8px">
            <input type="text" id="ncName" placeholder="如：城东校区" />
            <button class="btn btn-primary" id="ncAdd" style="flex:none">添加</button>
          </div>
        </div>
        <div>
          <div class="mini-title">已有校区（${list.length}）</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${list.map(c => `
              <div style="display:flex;gap:8px;align-items:center">
                <input type="text" value="${U.esc(c.name)}" data-cid="${c.id}" class="cpName" />
                <button class="btn btn-sm" data-save="${c.id}" style="flex:none">保存</button>
                <button class="btn btn-sm btn-danger" data-del="${c.id}" style="flex:none">删除</button>
              </div>`).join('') || '<div class="muted small">暂无校区</div>'}
          </div>
          <div class="small muted" style="margin-top:8px">删除校区将同时删除该校区下全部考试、成绩与试卷打点。</div>
        </div>`,
      onMount(box) {
        box.querySelector('#ncAdd').onclick = () => {
          const v = box.querySelector('#ncName').value.trim();
          if (!v) return U.toast('请输入校区名称', 'err');
          const c = Store.addCampus(v);
          if (c) { Store.setCurrent(c.id); U.toast('已添加校区', 'ok'); U.closeModal(); render(); }
        };
        box.querySelectorAll('[data-save]').forEach(b => b.onclick = () => {
          const inp = box.querySelector(`.cpName[data-cid="${b.dataset.save}"]`);
          Store.renameCampus(b.dataset.save, inp.value);
          U.toast('已保存', 'ok'); U.closeModal(); render();
        });
        box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
          const c = Store.campus(b.dataset.del);
          U.confirmBox(`删除校区「<b>${U.esc(c ? c.name : '')}</b>」将同时删除其全部考试与成绩记录，确定继续？`, () => {
            Store.removeCampus(b.dataset.del); U.toast('已删除', 'ok'); U.closeModal(); render();
          }, '删除校区');
        });
      }
    });
  }

  function buildSideStat() {
    const el = document.getElementById('sideStat');
    const cid = Store.currentId();
    const exN = Store.exams(cid).length;
    const recN = Store.records({ campusId: cid }).length;
    const stuN = Store.students(cid).length;
    const pend = Store.pendingUploads(cid).length;
    // 顶栏计数标签（管理端风格：图标 + 标题 + 数量）
    const tag = document.getElementById('brandTag');
    if (tag) tag.textContent = `${Store.campuses().length} 个校区 · ${recN} 条成绩`;
    // 顶栏全局校区切换器
    const tc = document.getElementById('topCampus');
    if (tc) {
      const cur = Store.currentId();
      tc.innerHTML = Store.campuses().map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('');
      tc.hidden = false;                                              // 移除 HTML 预留的 hidden：多校区显示切换器
      tc.style.display = Store.campuses().length > 1 ? '' : 'none';   // 单校区隐藏（分校区账号后端只返回本校区，默认即本校区）
    }
    if (!el) return;
    el.innerHTML = `当前校区：${U.esc(Store.campusName())}<br>考试 ${exN} 次 · 记录 ${recN} 条 · 学生 ${stuN} 人` +
      (pend ? `<br><span style="color:var(--down)">家长上传待审 ${pend} 条</span>` : '');
  }

  /* ---------- 启动 ---------- */
  async function init() {
    Store.load();
    // 校区来自管理后台「分校管理」、学生来自「学生管理」，启动时同步一次
    await Store.syncRoster();
    if (!Store.currentId() && Store.campuses().length) Store.setCurrent(Store.campuses()[0].id);

    const cm = document.getElementById('btnCampusManage');
    if (cm) cm.style.display = 'none';   // 校区在「分校管理」中维护，不再本地增删

    // 顶栏校区切换：切全局当前校区并整页刷新（各视图筛选状态自然重置）
    const tc = document.getElementById('topCampus');
    if (tc) tc.onchange = () => {
      if (tc.value && tc.value !== Store.currentId()) { Store.setCurrent(tc.value); location.reload(); }
    };

    document.getElementById('btnPrintPage').onclick = () => {
      const card = document.querySelector('#mainView .card');
      const target = card || document.getElementById('mainView');
      const titleMap = { dashboard: '总览看板', records: '成绩列表', tracking: '历次追踪', students: '学生档案', student: '学生成绩档案' };
      Exporters.printElement(target, `${Store.campusName()} ${titleMap[route] || '成绩报表'}`,
        `${Store.campusName()}　打印时间：${U.fmtDate(new Date())}`);
    };

    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/dashboard';
    render();
  }

  function seedSample() { Store.seed(true); refresh(); }

  document.addEventListener('DOMContentLoaded', init);

  return { render, refresh, chart, seedSample, get route() { return route; } };
})();
