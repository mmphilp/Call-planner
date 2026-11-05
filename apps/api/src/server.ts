import { dirname, join, resolve } from 'node:path';
import { buildApp } from './app';
import { scheduleDailyBackups } from './backup';
import { createUser } from './routes/people';

const env = process.env;
const secret = env.JWT_SECRET;
if (!secret && env.NODE_ENV === 'production') {
  throw new Error('Set JWT_SECRET in production');
}

const dbPath = env.DATABASE_PATH ?? 'call-planner.db';
const { app, db } = await buildApp({
  dbPath,
  jwtSecret: secret ?? 'dev-only-secret-change-me',
  logger: true,
  adminDir: env.ADMIN_DIR,
  appDir: env.APP_DIR,
  trustProxy: env.TRUST_PROXY === 'true',
  supportEmail: env.SUPPORT_EMAIL?.trim(),
  instanceLabel: env.INSTANCE_LABEL?.trim(),
});

// First run: create the admin account from ADMIN_EMAIL / ADMIN_PASSWORD.
const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
if (n === 0 && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
  createUser(db, {
    email: env.ADMIN_EMAIL,
    name: env.ADMIN_NAME ?? 'Call Scheduler',
    role: 'admin',
    takesCall: false,
    password: env.ADMIN_PASSWORD,
  });
  app.log.info(`Created admin account ${env.ADMIN_EMAIL}`);
} else if (n === 0) {
  app.log.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the admin account.');
}

// Daily backups next to the database (in Docker: /data/backups), keeping the
// newest BACKUP_KEEP (default 14; 0 turns them off).
const keep = Number(env.BACKUP_KEEP ?? 14);
if (keep > 0) {
  const dir = env.BACKUP_DIR ?? join(dirname(resolve(dbPath)), 'backups');
  scheduleDailyBackups(db, dir, keep, (msg) => app.log.info(msg));
}

await app.listen({ port: Number(env.PORT ?? 4000), host: '0.0.0.0' });
