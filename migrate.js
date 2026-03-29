const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

function hasColumn(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}

db.transaction(() => {
  // employees.manager_user_id
  if (!hasColumn('employees', 'manager_user_id')) {
    db.exec(`ALTER TABLE employees ADD COLUMN manager_user_id INTEGER;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_user_id);`);
    console.log('Migrated: employees.manager_user_id');
  }

  // work_logs table
  db.exec(`
  CREATE TABLE IF NOT EXISTS work_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    dept TEXT,
    work_date TEXT NOT NULL,
    project TEXT,
    content TEXT NOT NULL,
    blockers TEXT,
    hours REAL,
    tags TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(work_date);
  CREATE INDEX IF NOT EXISTS idx_work_logs_user_date ON work_logs(user_id, work_date);
  CREATE INDEX IF NOT EXISTS idx_work_logs_dept_date ON work_logs(dept, work_date);
  `);
  console.log('Ensured: work_logs');
})();

console.log('Migration done.');
