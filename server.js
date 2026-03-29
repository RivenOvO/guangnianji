const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const db = new Database(path.join(__dirname, 'data.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','employee')), -- 权限角色
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  emp_no TEXT,
  dept TEXT,
  title TEXT,
  position TEXT, -- 岗位/职务（业务角色）
  phone TEXT,
  manager_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  joined_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(manager_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS work_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  dept TEXT,
  work_date TEXT NOT NULL, -- YYYY-MM-DD
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

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('leave')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  amount REAL,
  created_by INTEGER NOT NULL,
  assignee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decision_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(assignee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

function seedIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const adminPass = bcrypt.hashSync('admin123', 10);
  const managerPass = bcrypt.hashSync('manager123', 10);
  const employeePass = bcrypt.hashSync('employee123', 10);

  const insUser = db.prepare('INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)');
  const adminId = insUser.run('admin@company.local', 'Admin', adminPass, 'admin').lastInsertRowid;
  const managerId = insUser.run('manager@company.local', 'Manager', managerPass, 'manager').lastInsertRowid;
  const employeeId = insUser.run('employee@company.local', 'Employee', employeePass, 'employee').lastInsertRowid;

  const insEmp = db.prepare('INSERT INTO employees (user_id, emp_no, dept, title, phone, manager_user_id, joined_at) VALUES (?,?,?,?,?,?,?)');
  insEmp.run(adminId, 'A0001', 'General', 'Administrator', '13800000000', null, '2025-01-01');
  insEmp.run(managerId, 'M0001', 'Operations', 'Team Lead', '13900000000', null, '2025-02-01');
  insEmp.run(employeeId, 'E0001', 'Operations', 'Staff', '13700000000', managerId, '2025-03-01');

  const insAnn = db.prepare('INSERT INTO announcements (title, content, created_by) VALUES (?,?,?)');
  insAnn.run('欢迎使用公司管理系统（MVP）', '这是默认版本：通讯录、公告、请假/报销审批、操作日志。\n\n下一步可以按你公司的流程定制字段、审批链、导出格式。', adminId);

  const insLog = db.prepare('INSERT INTO audit_logs (user_id, action, meta) VALUES (?,?,?)');
  insLog.run(adminId, 'seed', JSON.stringify({ note: 'initial seed' }));
}
seedIfNeeded();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

function logAction(userId, action, meta) {
  db.prepare('INSERT INTO audit_logs (user_id, action, meta) VALUES (?,?,?)').run(userId || null, action, meta ? JSON.stringify(meta) : null);
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'missing_user' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

function canEditByPosition(userId) {
  const row = db.prepare('SELECT position FROM employees WHERE user_id=?').get(userId);
  return row?.position === '副总';
}

// Auth
app.post('/api/auth/login', (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const user = db.prepare('SELECT id,email,name,password_hash,role FROM users WHERE email=?').get(email);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  logAction(user.id, 'login', { email });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get('/api/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id,email,name,role,created_at FROM users WHERE id=?').get(req.user.sub);
  res.json({ user });
});

// Employees directory
app.get('/api/employees', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.emp_no, e.dept, e.title, e.position, e.phone, e.status, e.joined_at, e.manager_user_id,
           u.id as user_id, u.name, u.email, u.role
    FROM employees e
    LEFT JOIN users u ON u.id = e.user_id
    ORDER BY e.id DESC
  `).all();
  res.json({ employees: rows });
});

app.post('/api/employees', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以新增员工
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    role: z.enum(['admin', 'manager', 'employee']).default('employee'),
    password: z.string().min(6).default('changeme123'),
    emp_no: z.string().optional().nullable(),
    dept: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    manager_user_id: z.number().int().optional().nullable(),
    joined_at: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const d = parsed.data;
  const password_hash = bcrypt.hashSync(d.password, 10);

  const tx = db.transaction(() => {
    const userIns = db.prepare('INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)').run(d.email, d.name, password_hash, d.role);
    const userId = userIns.lastInsertRowid;
    db.prepare('INSERT INTO employees (user_id, emp_no, dept, title, position, phone, manager_user_id, joined_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, d.emp_no || null, d.dept || null, d.title || null, d.position || null, d.phone || null, d.manager_user_id ?? null, d.joined_at || null);
    return userId;
  });

  try {
    const userId = tx();
    logAction(req.user.sub, 'employee_create', { userId, email: d.email });
    res.json({ ok: true, userId });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'email_exists' });
    return res.status(500).json({ error: 'server_error' });
  }
});

// Announcements
app.get('/api/announcements', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.content, a.created_at,
           u.name as created_by_name
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
    ORDER BY a.id DESC
  `).all();
  res.json({ announcements: rows });
});

app.post('/api/announcements', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以发布公告
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const schema = z.object({ title: z.string().min(1), content: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const { title, content } = parsed.data;
  const id = db.prepare('INSERT INTO announcements (title, content, created_by) VALUES (?,?,?)').run(title, content, req.user.sub).lastInsertRowid;
  logAction(req.user.sub, 'announcement_create', { id, title });
  res.json({ ok: true, id });
});

app.delete('/api/announcements/:id', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以删除公告（admin 可删全部；副总仅删自己发布）
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const id = Number(req.params.id);
  const ann = db.prepare('SELECT id, created_by, title FROM announcements WHERE id=?').get(id);
  if (!ann) return res.status(404).json({ error: 'not_found' });

  const isAdmin = req.user.role === 'admin';
  const isOwner = ann.created_by === req.user.sub;
  // admin 可删全部；“副总”仅能删自己发布
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'forbidden' });

  db.prepare('DELETE FROM announcements WHERE id=?').run(id);
  logAction(req.user.sub, 'announcement_delete', { id, title: ann.title });
  res.json({ ok: true });
});

// Approvals
app.get('/api/approvals', authRequired, (req, res) => {
  const mineOnly = req.query.mine === '1';
  const sql = mineOnly
    ? `SELECT ap.*, u1.name as created_by_name, u2.name as assignee_name
       FROM approvals ap
       LEFT JOIN users u1 ON u1.id = ap.created_by
       LEFT JOIN users u2 ON u2.id = ap.assignee_id
       WHERE ap.created_by = ?
       ORDER BY ap.id DESC`
    : `SELECT ap.*, u1.name as created_by_name, u2.name as assignee_name
       FROM approvals ap
       LEFT JOIN users u1 ON u1.id = ap.created_by
       LEFT JOIN users u2 ON u2.id = ap.assignee_id
       WHERE ap.assignee_id = ? OR ap.created_by = ?
       ORDER BY ap.id DESC`;

  const rows = mineOnly
    ? db.prepare(sql).all(req.user.sub)
    : db.prepare(sql).all(req.user.sub, req.user.sub);

  res.json({ approvals: rows });
});

app.post('/api/approvals', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以发起请假
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const schema = z.object({
    type: z.enum(['leave']),
    title: z.string().min(1),
    content: z.string().min(1),
    amount: z.number().optional().nullable(),
    assignee_id: z.number().int()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const d = parsed.data;
  const assignee = db.prepare('SELECT id FROM users WHERE id=?').get(d.assignee_id);
  if (!assignee) return res.status(400).json({ error: 'assignee_not_found' });

  const id = db.prepare('INSERT INTO approvals (type,title,content,amount,created_by,assignee_id) VALUES (?,?,?,?,?,?)')
    .run(d.type, d.title, d.content, d.amount ?? null, req.user.sub, d.assignee_id).lastInsertRowid;

  logAction(req.user.sub, 'approval_create', { id, type: d.type, assignee_id: d.assignee_id });
  res.json({ ok: true, id });
});

app.post('/api/approvals/:id/decision', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().optional().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const ap = db.prepare('SELECT * FROM approvals WHERE id=?').get(id);
  if (!ap) return res.status(404).json({ error: 'not_found' });
  if (ap.assignee_id !== req.user.sub) return res.status(403).json({ error: 'not_assignee' });
  if (ap.status !== 'pending') return res.status(400).json({ error: 'already_decided' });

  db.prepare('UPDATE approvals SET status=?, decision_note=?, decided_at=datetime(\'now\') WHERE id=?')
    .run(parsed.data.decision, parsed.data.note || null, id);

  logAction(req.user.sub, 'approval_decision', { id, decision: parsed.data.decision });
  res.json({ ok: true });
});

// Work logs ("cloud spreadsheet"-like)
function myDept(userId) {
  const row = db.prepare('SELECT dept FROM employees WHERE user_id=?').get(userId);
  return row?.dept || null;
}

app.get('/api/worklogs', authRequired, (req, res) => {
  const dept = myDept(req.user.sub);
  // admin: all; manager/employee: only own dept
  const isAdmin = req.user.role === 'admin';
  const dateFrom = String(req.query.from || '');
  const dateTo = String(req.query.to || '');

  let where = [];
  let params = [];
  if (!isAdmin) {
    where.push('wl.dept = ?');
    params.push(dept);
  }
  if (dateFrom) { where.push('wl.work_date >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('wl.work_date <= ?'); params.push(dateTo); }
  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
    SELECT wl.*, u.name as user_name, u.email as user_email
    FROM work_logs wl
    LEFT JOIN users u ON u.id = wl.user_id
    ${whereSql}
    ORDER BY wl.work_date DESC, wl.id DESC
    LIMIT 2000
  `).all(...params);

  res.json({ worklogs: rows });
});

app.post('/api/worklogs', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以新增日报
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const schema = z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    project: z.string().optional().nullable(),
    content: z.string().min(1),
    blockers: z.string().optional().nullable(),
    hours: z.number().optional().nullable(),
    tags: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const dept = myDept(req.user.sub);
  const d = parsed.data;
  const id = db.prepare(`
    INSERT INTO work_logs (user_id, dept, work_date, project, content, blockers, hours, tags)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(req.user.sub, dept, d.work_date, d.project ?? null, d.content, d.blockers ?? null, d.hours ?? null, d.tags ?? null).lastInsertRowid;

  logAction(req.user.sub, 'worklog_create', { id, work_date: d.work_date });
  res.json({ ok: true, id });
});

app.put('/api/worklogs/:id', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以修改日报
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const id = Number(req.params.id);
  const schema = z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    project: z.string().optional().nullable(),
    content: z.string().min(1),
    blockers: z.string().optional().nullable(),
    hours: z.number().optional().nullable(),
    tags: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const wl = db.prepare('SELECT * FROM work_logs WHERE id=?').get(id);
  if (!wl) return res.status(404).json({ error: 'not_found' });

  const dept = myDept(req.user.sub);
  const isAdmin = req.user.role === 'admin';
  const sameDept = wl.dept && dept && wl.dept === dept;
  const canEdit = isAdmin || (sameDept && wl.user_id === req.user.sub);
  if (!canEdit) return res.status(403).json({ error: 'forbidden' });

  const d = parsed.data;
  db.prepare(`
    UPDATE work_logs
    SET work_date=?, project=?, content=?, blockers=?, hours=?, tags=?, updated_at=datetime('now')
    WHERE id=?
  `).run(d.work_date, d.project ?? null, d.content, d.blockers ?? null, d.hours ?? null, d.tags ?? null, id);

  logAction(req.user.sub, 'worklog_update', { id });
  res.json({ ok: true });
});

app.delete('/api/worklogs/:id', authRequired, (req, res) => {
  // 只有 admin 或“副总”岗位可以删除日报
  if (!(req.user.role === 'admin' || canEditByPosition(req.user.sub))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const id = Number(req.params.id);
  const wl = db.prepare('SELECT * FROM work_logs WHERE id=?').get(id);
  if (!wl) return res.status(404).json({ error: 'not_found' });

  const dept = myDept(req.user.sub);
  const isAdmin = req.user.role === 'admin';
  const sameDept = wl.dept && dept && wl.dept === dept;
  const canDelete = isAdmin || (sameDept && wl.user_id === req.user.sub);
  if (!canDelete) return res.status(403).json({ error: 'forbidden' });

  db.prepare('DELETE FROM work_logs WHERE id=?').run(id);
  logAction(req.user.sub, 'worklog_delete', { id });
  res.json({ ok: true });
});

// Audit logs
app.get('/api/audit', authRequired, requireRole(['admin']), (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.action, l.meta, l.created_at, u.email, u.name
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.id DESC
    LIMIT 200
  `).all();
  res.json({ logs: rows.map(r => ({ ...r, meta: r.meta ? safeJson(r.meta) : null })) });
});

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

// Static frontend
app.use('/', express.static(path.join(__dirname, 'public')));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Company Admin MVP running on http://localhost:${PORT}`);
  console.log('Default accounts:');
  console.log('  admin@company.local / admin123');
  console.log('  manager@company.local / manager123');
  console.log('  employee@company.local / employee123');
});
