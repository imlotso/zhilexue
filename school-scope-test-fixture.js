'use strict';
// Only for disposable SQLite test fixtures. Older route fixtures declared just
// the columns their original query needed; keep their rows and assertions intact
// while supplying the production relationship schema used by scope guards.
module.exports = function addSchoolScopeFixture(db) {
  const tables = {
    questions: { id:'INTEGER', stage:'TEXT', grade:'TEXT', chapter_id:'INTEGER', video_id:'INTEGER', section_id:'INTEGER' },
    chapters: { id:'INTEGER', stage:'TEXT', grade:'TEXT' },
    videos: { id:'INTEGER', chapter_id:'INTEGER', section_id:'INTEGER', grade:'TEXT' },
    sections: { id:'INTEGER', chapter_id:'INTEGER' },
    question_nodes: { question_id:'INTEGER', node_id:'INTEGER' },
    video_nodes: { video_id:'INTEGER', node_id:'INTEGER' },
    bank_tree_nodes: { id:'INTEGER', tree_id:'INTEGER' },
    bank_trees: { id:'INTEGER', stage:'TEXT' },
  };
  for (const [table, fields] of Object.entries(tables)) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${Object.entries(fields).map(([name,type])=>name+' '+type).join(',')})`);
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
    for (const [name,type] of Object.entries(fields)) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
};
