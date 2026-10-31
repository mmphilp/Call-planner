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
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_services (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, service_id)
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
  locked INTEGER NOT NULL DEFAULT 0
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
