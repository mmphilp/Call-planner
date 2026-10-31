import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'surgeon')),
  fte REAL NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  takes_call INTEGER NOT NULL DEFAULT 1,
  phone TEXT,
  calendar_token TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  covers_day INTEGER NOT NULL DEFAULT 1,
  covers_night INTEGER NOT NULL DEFAULT 1,
  covers_weekend INTEGER NOT NULL DEFAULT 1,
  -- 'shift': fill each weekday day/night separately; 'week': one surgeon per week.
  weekday_mode TEXT NOT NULL DEFAULT 'shift' CHECK (weekday_mode IN ('shift', 'week')),
  -- Apply rest / nights-per-week limits to this team's weekday call.
  weekday_rules INTEGER NOT NULL DEFAULT 1,
  -- When the team can't cover a weekday shift, this service's on-call surgeon does.
  backup_service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_services (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, service_id)
);

-- Surgeons who manage weekday call for a service (their team).
CREATE TABLE IF NOT EXISTS service_admins (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, service_id)
);

-- Standing weekday assignments, e.g. one surgeon always takes Monday day call.
CREATE TABLE IF NOT EXISTS routine_days (
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('day', 'night')),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, kind, weekday)
);

CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  half INTEGER NOT NULL CHECK (half IN (1, 2)),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'published')),
  request_deadline TEXT,
  holidays_json TEXT NOT NULL DEFAULT '[]',
  rules_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  UNIQUE (year, half)
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id),
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  holiday INTEGER NOT NULL DEFAULT 0,
  -- Set when someone outside the call pool (e.g. a locum) covers this shift.
  covered_by TEXT
);
CREATE INDEX IF NOT EXISTS shifts_period ON shifts(period_id, start);

CREATE TABLE IF NOT EXISTS assignments (
  shift_id TEXT PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  locked INTEGER NOT NULL DEFAULT 0,
  -- 'backup': filled automatically by a covering service (recomputed on changes).
  source TEXT
);
CREATE INDEX IF NOT EXISTS assignments_user ON assignments(user_id);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('unavailable', 'prefer_off', 'prefer_on')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  shift_kinds TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS requests_period ON requests(period_id, user_id);
`;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Bring databases created by older versions up to the current schema. */
function migrate(db: Db) {
  const shiftCols = (db.prepare('PRAGMA table_info(shifts)').all() as { name: string }[]).map((c) => c.name);
  if (!shiftCols.includes('covered_by')) db.exec('ALTER TABLE shifts ADD COLUMN covered_by TEXT');
  const serviceCols = (db.prepare('PRAGMA table_info(services)').all() as { name: string }[]).map((c) => c.name);
  if (!serviceCols.includes('weekday_mode')) {
    db.exec(`ALTER TABLE services ADD COLUMN weekday_mode TEXT NOT NULL DEFAULT 'shift' CHECK (weekday_mode IN ('shift', 'week'))`);
  }
  if (!serviceCols.includes('weekday_rules')) db.exec('ALTER TABLE services ADD COLUMN weekday_rules INTEGER NOT NULL DEFAULT 1');
  if (!serviceCols.includes('backup_service_id')) db.exec('ALTER TABLE services ADD COLUMN backup_service_id TEXT');
  const assignmentCols = (db.prepare('PRAGMA table_info(assignments)').all() as { name: string }[]).map((c) => c.name);
  if (!assignmentCols.includes('source')) db.exec('ALTER TABLE assignments ADD COLUMN source TEXT');
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
