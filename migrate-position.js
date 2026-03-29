const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

function hasColumn(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}

if (!hasColumn('employees', 'position')) {
  db.exec(`ALTER TABLE employees ADD COLUMN position TEXT;`);
  console.log('Migrated: employees.position');
} else {
  console.log('employees.position already exists');
}

console.log('Done.');
