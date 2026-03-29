const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

// If old data contains expense, convert to leave or delete. Here: convert to leave with a note.
const hasType = db.prepare("SELECT COUNT(*) as c FROM approvals WHERE type='expense'").get().c;
if (hasType > 0) {
  const rows = db.prepare("SELECT id, title FROM approvals WHERE type='expense'").all();
  db.transaction(() => {
    for (const r of rows) {
      db.prepare("UPDATE approvals SET type='leave', title = '[原报销] ' || title WHERE id=?").run(r.id);
    }
  })();
  console.log(`Converted ${rows.length} expense approvals to leave.`);
} else {
  console.log('No expense approvals found.');
}

console.log('Done.');
