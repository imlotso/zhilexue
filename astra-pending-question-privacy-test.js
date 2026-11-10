'use strict';
const assert = require('node:assert/strict'), { test } = require('node:test'), fs = require('node:fs'), vm = require('node:vm');
let open;
try {
  const D = require('better-sqlite3');
  const d = new D(':memory:');
  d.close();
  open = () => new D(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  open = () => new DatabaseSync(':memory:');
}
const branch = {
  id: 10,
  role: 'branch'
}, principal = {
  id: 1,
  role: 'admin'
};

function fixture(t) {
  const db = open();
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE users(id INTEGER,role TEXT,created_by INTEGER);
    INSERT INTO users VALUES(101,'student',10),(201,'student',20);
    CREATE TABLE paper_uploads(id INTEGER,user_id INTEGER,status TEXT,question_id INTEGER);
    INSERT INTO paper_uploads VALUES(1,101,'pending',1),(2,201,'reviewed',2),(3,999,'pending',3),(4,201,'approved',4);
    CREATE TABLE questions(id INTEGER PRIMARY KEY,stem TEXT);
    INSERT INTO questions VALUES(1,'own'),(2,'foreign'),(3,'orphan'),(4,'approved'),(5,'shared');
    CREATE TABLE mistakes(question_id INTEGER);
    CREATE TABLE question_tags(question_id INTEGER,tag TEXT);
    CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER);
    CREATE TABLE mf_paper_questions(question_id INTEGER,paper_id INTEGER,kind TEXT,position INTEGER,score REAL,created_at TEXT);
    CREATE TABLE papers(id INTEGER PRIMARY KEY,q_ids TEXT,title TEXT);
    CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,published INTEGER,status TEXT);
    CREATE TABLE mf_paper_tries(paper_id INTEGER);
    CREATE TABLE mf_recog_runs(drafts TEXT,status TEXT,source_kind TEXT);
    CREATE TABLE chapters(id INTEGER,name TEXT,subject TEXT,grade TEXT,stage TEXT,term TEXT,category TEXT);
    CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);
    CREATE TABLE handouts(id INTEGER,video_id INTEGER,chapter_id INTEGER,section_id INTEGER);
    CREATE TABLE videos(id INTEGER,title TEXT,chapter_id INTEGER,section_id INTEGER);
    CREATE TABLE sections(id INTEGER,chapter_id INTEGER);
    CREATE TABLE bank_trees(id INTEGER,kind TEXT,edition TEXT);
    CREATE TABLE bank_tree_nodes(id INTEGER,tree_id INTEGER,name TEXT,parent_id INTEGER,sort INTEGER);
    ALTER TABLE questions ADD COLUMN chapter_id INTEGER;
    ALTER TABLE questions ADD COLUMN video_id INTEGER;
    ALTER TABLE questions ADD COLUMN section_id INTEGER;
    ALTER TABLE questions ADD COLUMN year TEXT;
    ALTER TABLE questions ADD COLUMN source TEXT;
    UPDATE questions SET year='Y'||id,source='S'||id;
    ALTER TABLE papers ADD COLUMN status TEXT;
    ALTER TABLE papers ADD COLUMN due_at TEXT;
    ALTER TABLE papers ADD COLUMN published_at TEXT;
    ALTER TABLE users ADD COLUMN status INTEGER DEFAULT 1;
    CREATE TABLE paper_assignments(paper_id INTEGER,user_id INTEGER,assigned_by INTEGER,created_at TEXT);
  `);
  const prepare = db.prepare.bind(db);
  db.prepare = sql => prepare(sql.replace(/ FOR UPDATE\b/g, ''));
  db.transaction = fn => (...a) => {
    db.exec('BEGIN');
    try {
      const result = fn(...a);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return db;
}

function handler(file, method, url, db, extras = {}) {
  const text = fs.readFileSync(__dirname + '/src/' + file, 'utf8');
  const a = text.indexOf(`admin.${method}('${url}',`),
    b = text.indexOf(file === 'paper-docx.js' ? '\n  });' : '\n});', a);
  assert.ok(a >= 0 && b > a);
  let fn;
  const context = {
    require: n => require(require('node:path').resolve(__dirname, 'src', n)),
    admin: {
      [method]: (url, f) => fn = f
    },
    db,
    int: (v, d = 0) => parseInt(v, 10) || d,
    qmeta: require('./src/qmeta'),
    accuracy: require('./src/accuracy'),
    csv: v => String(v || '').split(',').filter(Boolean),
    decorate: r => r,
    parseQ: r => r,
    SRC_KINDS: {},
    modes: {
      student: 1
    },
    list: s => JSON.parse(s || '[]'),
    MatchQ: {
      list: () => []
    },
    num: (v, d = 0) => Number(v) || d,
    now: () => '',
    parseIds: s => JSON.parse(s || '[]'),
    ok: (r, data) => r.body = {
      code: 0,
      data
    },
    fail: (r, msg, code = 1) => r.body = {
      code,
      msg
    },
    ...extras
  };
  vm.runInNewContext(text.slice(a, b + (file === 'paper-docx.js' ? 6 : 4)), context);
  return (id, user = branch, body = {}, query = {}) => {
    const res = {
      status() {
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    const result = fn({
      params: {
        id
      },
      user,
      body,
      query
    }, res);
    return result && typeof result.then === 'function' ? result.then(() => res.body) : res.body;
  };
}

for (const file of ['app.js', 'bank.js', 'mfbank.js']) test(file + ' denies foreign and orphan pending deletion before any writes', t => {
  const db = fixture(t),
    call = handler(file, 'delete', '/questions/:id', db);
  for (const id of [2, 3]) {
    assert.equal(call(id).code, 403);
    assert.ok(db.prepare('SELECT * FROM questions WHERE id=?').get(id));
  }
  for (const id of [1, 4, 5]) assert.equal(call(id).code, 0);
  assert.equal(call(2, principal).code, 0);
});

for (const [file, url] of [['bank.js', '/questions/batch-delete'], ['mfbank.js', '/questions/batch']]) test(file + ' batch denies before touching an allowed item', t => {
  const db = fixture(t),
    call = handler(file, 'post', url, db);
  assert.equal(call(0, branch, {
    ids: [1, 2],
    op: 'delete'
  }).code, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, 5);
});

test('scope SQL keeps shared and approved questions, denies orphan and mixed-school linkage', t => {
  const db = fixture(t),
    qmeta = require('./src/qmeta');
  db.exec("INSERT INTO paper_uploads VALUES(5,201,'pending',1)");
  const sql = qmeta.questionScopeSql(branch, 'q');
  assert.deepEqual(db.prepare('SELECT q.id FROM questions q WHERE ' + sql + ' ORDER BY q.id').all().map(x => x.id), [4, 5]);
  assert.equal(qmeta.questionsAllowed(db, principal, [1, 2, 3, 4, 5]), true);
  assert.equal(qmeta.questionsAllowed(db, branch, [4, 2]), false);
});

for (const [file, method, url] of [
  ['app.js', 'put', '/questions/:id'],
  ['bank.js', 'put', '/questions/:id'],
  ['mfbank.js', 'put', '/questions/:id'],
  ['mfbank.js', 'get', '/questions/:id'],
  ['mfbank.js', 'get', '/questions/:id/nodes'],
  ['mfbank.js', 'post', '/questions/:id/nodes'],
  ['mfbank.js', 'get', '/questions/:id/group']
]) test(file + ' ' + method + ' ' + url + ' stops before reading or mutating foreign content', t => {
  const db = fixture(t);
  assert.equal(handler(file, method, url, db)(2).code, 403);
});

for (const url of ['/videos/:id/bind', '/sections/:id/bind']) test(url + ' rejects mixed ids for binding and unbinding before writing', t => {
  const db = fixture(t),
    call = handler('bank.js', 'post', url, db);
  for (const unbind of [0, 1]) assert.equal(call(1, branch, {
    ids: [1, 2],
    unbind
  }).code, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, 5);
});

for (const op of ['tag', 'untag', 'node', 'field']) test('mf batch ' + op + ' rejects mixed ids atomically', t => {
  const db = fixture(t),
    call = handler('mfbank.js', 'post', '/questions/batch', db);
  assert.equal(call(0, branch, {
    ids: [1, 2],
    op,
    tags: ['x'],
    nodes: [1],
    subject: 'test'
  }).code, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM question_tags').get().n, 0);
});

test('mf adding questions to a paper denies mixed ids before transaction', t => {
  const db = fixture(t);
  assert.equal(handler('mfbank.js', 'post', '/papers/:id/questions', db)(1, branch, {
    question_ids: [1, 2]
  }).code, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mf_paper_questions').get().n, 0);
});

for (const url of ['/papers/:id', '/papers/:id/preview', '/papers/:id/export']) test('mf ' + url + ' refuses a pre-existing paper with foreign private questions', t => {
  const db = fixture(t);
  db.exec("INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(2,7,'question')");
  assert.equal(handler('mfbank.js', 'get', url, db)(7).code, 403);
});

test('compose SQL excludes every pending scan, including branch and principal picks', t => {
  const db = fixture(t),
    compose = require('./src/compose');
  for (const [user, ids] of [[undefined, [4, 5]], [branch, [4, 5]], [principal, [4, 5]]]) {
    const {
      where,
      args
    } = compose.scopeSql(db, {
      user
    });
    assert.deepEqual(db.prepare('SELECT q.id FROM questions q' + where + ' ORDER BY q.id').all(...args).map(x => x.id), ids);
  }
});

for (const file of ['app.js', 'bank.js', 'mfbank.js']) test(file + ' list filters rows AND totals before pagination', t => {
  const db = fixture(t),
    call = handler(file, 'get', '/questions', db);
  for (const [user, expected] of [[branch, [1, 4, 5]], [principal, [1, 2, 3, 4, 5]]]) {
    const r = call(0, user);
    assert.equal(r.code, 0);
    assert.equal(r.data.total, expected.length);
    assert.deepEqual(Array.from(r.data.list, x => x.id).sort(), expected);
  }
});

test('mf export and facets do not expose foreign content', t => {
  const db = fixture(t);
  const r = handler('mfbank.js', 'get', '/questions-export', db)(0);
  assert.deepEqual(Array.from(r.data.list, x => x.id).sort(), [1, 4, 5]);
  const facets = handler('mfbank.js', 'get', '/questions-facets', db)(0);
  assert.deepEqual(Array.from(facets.data.years, x => x.v).sort(), ['Y1', 'Y4', 'Y5']);
  assert.deepEqual(Array.from(facets.data.sources, x => x.v).sort(), ['S1', 'S4', 'S5']);
});

for (const method of ['post', 'put', 'get']) test('bank ' + method + ' paper rejects mixed private ids', t => {
  const db = fixture(t);
  db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[1,2]','test')");
  assert.equal(handler('bank.js', method, method === 'post' ? '/papers' : '/papers/:id', db)(7, branch, {
    title: 'test',
    q_ids: [1, 2]
  }).code, 403);
});

test('mf AI clean refuses foreign question without invoking AI', async t => {
  const db = fixture(t);
  assert.equal((await handler('mfbank.js', 'post', '/ai-clean', db)(0, branch, {
    id: 2
  })).code, 403);
});

test('mf archive refuses foreign paper before rendering or storage', async t => {
  const db = fixture(t);
  db.exec("INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(2,7,'question')");
  assert.equal((await handler('mfbank.js', 'post', '/papers/:id/archive', db)(7)).code, 403);
});

for (const url of ['/papers/:id/publish', '/papers/:id/assign']) test('bank ' + url + ' rejects foreign pending paper before publication or assignment', t => {
  const db = fixture(t);
  db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[1,2]','test')");
  assert.equal(handler('bank.js', 'post', url, db)(7, branch, {
    publish: 1,
    user_ids: [101]
  }).code, 403);
});

test('NULL role owner is not treated as a valid campus student', t => {
  const db = fixture(t);
  db.exec("INSERT INTO users(id,role,created_by) VALUES(999,NULL,10)");
  assert.equal(require('./src/qmeta').questionsAllowed(db, branch, [3]), false);
});

test('DOCX export refuses a pre-existing foreign pending question before building document', async t => {
  const db = fixture(t);
  db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[1,2]','test')");
  assert.equal((await handler('paper-docx.js', 'get', '/papers/:id/export-docx', db)(7)).code, 403);
});

test('AI clean rechecks campus before returning asynchronously generated content', async t => {
  const db = fixture(t);
  db.exec("ALTER TABLE questions ADD COLUMN stem_html TEXT");
  const localRequire = n => n === './mfcollect' ? {
    mfAiInvoke: async() => {
      db.exec('UPDATE users SET created_by=20 WHERE id=101');
      return {
        text: '{"text":"synthetic","latex":""}'
      };
    }
  }: require(require('node:path').resolve(__dirname, 'src', n));
  const r = await handler('mfbank.js', 'post', '/ai-clean', db, {
    require: localRequire
  })(0, branch, {
    id: 1
  });
  assert.equal(r.code, 403);
});

for (const user of [branch, principal]) {
  for (const url of ['/papers/:id/publish', '/papers/:id/assign']) test(user.role + ' cannot publish or assign even their own pending scan: ' + url, t => {
    const db = fixture(t);
    db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[1]','test')");
    assert.equal(handler('bank.js', 'post', url, db)(7, user, {
      publish: 1,
      user_ids: [101]
    }).code, 403);
  });
  for (const url of ['/videos/:id/bind', '/sections/:id/bind']) test(user.role + ' cannot publicly bind a pending scan: ' + url, t => {
    const db = fixture(t);
    assert.equal(handler('bank.js', 'post', url, db)(1, user, {
      ids: [1]
    }).code, 403);
  });
  test(user.role + ' cannot add pending scan to shared mf paper', t => {
    const db = fixture(t);
    assert.equal(handler('mfbank.js', 'post', '/papers/:id/questions', db)(7, user, {
      question_ids: [1]
    }).code, 403);
  });
  test(user.role + ' cannot publish an existing mf paper containing pending scan', t => {
    const db = fixture(t);
    db.exec("INSERT INTO mf_papers VALUES(7,0,'done'); INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(1,7,'question')");
    assert.equal(handler('mfbank.js', 'put', '/papers/:id', db)(7, user, {
      published: 1
    }).code, 403);
  });
}

for (const user of [branch, principal]) {
  for (const url of ['/papers/:id/publish', '/papers/:id/assign']) test(user.role + ' retains publication of approved/shared questions: ' + url, t => {
    const db = fixture(t);
    db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[4,5]','test')");
    assert.equal(handler('bank.js', 'post', url, db)(7, user, {
      publish: 1,
      user_ids: [101]
    }).code, 0);
  });
  for (const kind of ['videos', 'sections']) test(user.role + ' may bind approved/shared questions to ' + kind, t => {
    const db = fixture(t);
    db.exec(kind === 'videos' ? "INSERT INTO videos(id,title,chapter_id) VALUES(7,'test',9)" : "INSERT INTO sections VALUES(7,9)");
    assert.equal(handler('bank.js', 'post', '/' + kind + '/:id/bind', db)(7, user, {
      ids: [4, 5]
    }).code, 0);
    assert.equal(db.prepare('SELECT chapter_id FROM questions WHERE id=4').get().chapter_id, 9);
  });
  test(user.role + ' may add approved/shared questions to mf paper', t => {
    const db = fixture(t);
    db.exec("INSERT INTO mf_papers VALUES(7,0,'done')");
    assert.equal(handler('mfbank.js', 'post', '/papers/:id/questions', db)(7, user, {
      question_ids: [4, 5]
    }).code, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mf_paper_questions').get().n, 2);
  });
  test(user.role + ' may publish mf paper after scan is approved', t => {
    const db = fixture(t);
    db.exec("INSERT INTO mf_papers VALUES(7,0,'done'); INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(4,7,'question')");
    assert.equal(handler('mfbank.js', 'put', '/papers/:id', db)(7, user, {
      published: 1
    }).code, 0);
    assert.equal(db.prepare('SELECT published FROM mf_papers WHERE id=7').get().published, 1);
  });
  for (const method of ['post', 'put']) test(user.role + ' cannot insert own pending qid into shared bank paper: ' + method, t => {
    const db = fixture(t);
    db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[1]','test')");
    assert.equal(handler('bank.js', method, method === 'post' ? '/papers' : '/papers/:id', db)(7, user, {
      title: 'test',
      q_ids: [1]
    }).code, 403);
  });
}

for (const kind of ['videos', 'sections']) test('bank ' + kind + ' reader does not return another campus pending questions', t => {
  const db = fixture(t);
  db.exec(kind === 'videos' ? "INSERT INTO videos(id,title,chapter_id) VALUES(7,'test',9); UPDATE questions SET video_id=7" : "INSERT INTO sections VALUES(7,9); UPDATE questions SET section_id=7");
  const call = handler('bank.js', 'get', '/' + kind + '/:id/questions', db);
  assert.deepEqual(Array.from(call(7).data.list, q => q.id), [1, 4, 5]);
  assert.deepEqual(Array.from(call(7, principal).data.list, q => q.id), [1, 2, 3, 4, 5]);
});

test('section reader does not count foreign pending video questions', t => {
  const db = fixture(t);
  db.exec("INSERT INTO sections VALUES(7,9); INSERT INTO videos VALUES(7,'test',9,7); UPDATE questions SET video_id=7 WHERE id=2");
  assert.equal(handler('bank.js', 'get', '/sections/:id/questions', db)(7).data.video_question_count, 0);
});
