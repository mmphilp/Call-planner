// Demo data: `npm run seed` (add `-- --reset` to wipe an existing database).
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { generateShifts, halfYearRange } from '@call-planner/core';
import { openDb } from './db';
import { listServices } from './repo';
import { createUser } from './routes/people';

const path = process.env.DATABASE_PATH ?? 'call-planner.db';
if (process.argv.includes('--reset')) for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
else if (existsSync(path)) {
  console.log(`${path} already exists; run with --reset to recreate it.`);
  process.exit(0);
}

const db = openDb(path);

const services = [
  ['general', 'General Surgery', '#2563eb', 1, 1, 1, 0],
  ['trauma', 'Trauma', '#dc2626', 1, 1, 1, 1],
  ['vascular', 'Vascular', '#059669', 1, 0, 0, 2],
] as const;
const insService = db.prepare(
  'INSERT INTO services (id, name, color, covers_day, covers_night, covers_weekend, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
);
for (const s of services) insService.run(...s);

createUser(db, {
  email: 'admin@example.com',
  name: 'Call Scheduler',
  role: 'admin',
  takesCall: false,
  password: 'password123',
});

const names = [
  'Dr. Avery Chen', 'Dr. Jordan Patel', 'Dr. Riley Okafor', 'Dr. Morgan Silva', 'Dr. Casey Novak',
  'Dr. Taylor Brooks', 'Dr. Quinn Ramirez', 'Dr. Drew Kim', 'Dr. Sam Whitaker', 'Dr. Jamie Lindqvist',
  'Dr. Reese Adeyemi', 'Dr. Parker Haddad',
];
const surgeons = names.map((name, i) =>
  createUser(db, {
    email: `surgeon${i + 1}@example.com`,
    name,
    role: 'surgeon',
    fte: i === 11 ? 0.5 : 1,
    serviceIds: i < 4 ? ['general', 'trauma', 'vascular'] : i < 8 ? ['general', 'trauma'] : ['general', 'vascular'],
    password: 'password123',
  }),
);

const year = 2027;
const { start, end } = halfYearRange(year, 1);
const holidays = ['2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18'];
const periodId = randomUUID();
db.prepare(
  `INSERT INTO periods (id, year, half, start_date, end_date, status, request_deadline, holidays_json)
   VALUES (?, ?, 1, ?, ?, 'open', ?, ?)`,
).run(periodId, year, start, end, '2026-11-30', JSON.stringify(holidays));

const insShift = db.prepare(
  'INSERT INTO shifts (id, period_id, service_id, kind, date, start, end, holiday) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);
for (const s of generateShifts({ start, end, services: listServices(db), holidays })) {
  insShift.run(s.id, periodId, s.serviceId, s.kind, s.date, s.start, s.end, s.holiday ? 1 : 0);
}

const requests = [
  [0, 'unavailable', '2027-03-08', '2027-03-19', '', 'Spring break with family', 'approved'],
  [1, 'prefer_off', '2027-02-12', '2027-02-15', 'weekend', 'Anniversary', 'pending'],
  [2, 'unavailable', '2027-04-19', '2027-04-23', '', 'Conference', 'pending'],
  [3, 'prefer_on', '2027-05-28', '2027-05-31', 'weekend', 'Happy to take Memorial Day', 'pending'],
  [5, 'unavailable', '2027-06-14', '2027-06-25', '', 'Vacation', 'approved'],
  [7, 'prefer_off', '2027-01-01', '2027-01-04', '', 'New Year', 'pending'],
] as const;
const insReq = db.prepare(
  `INSERT INTO requests (id, period_id, user_id, type, start_date, end_date, shift_kinds, note, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const [i, type, from, to, kinds, note, status] of requests) {
  insReq.run(randomUUID(), periodId, surgeons[i].id, type, from, to, kinds, note, status, new Date().toISOString());
}

console.log(`Seeded ${path}`);
console.log('Admin:   admin@example.com / password123');
console.log('Surgeon: surgeon1@example.com … surgeon12@example.com / password123');
