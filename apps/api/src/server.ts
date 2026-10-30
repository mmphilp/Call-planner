import { buildApp } from './app';
import { createUser } from './routes/people';

const env = process.env;
const secret = env.JWT_SECRET;
if (!secret && env.NODE_ENV === 'production') {
  throw new Error('Set JWT_SECRET in production');
}

const { app, db } = await buildApp({
  dbPath: env.DATABASE_PATH ?? 'call-planner.db',
  jwtSecret: secret ?? 'dev-only-secret-change-me',
  logger: true,
  adminDir: env.ADMIN_DIR,
  appDir: env.APP_DIR,
  trustProxy: env.TRUST_PROXY === 'true',
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

await app.listen({ port: Number(env.PORT ?? 4000), host: '0.0.0.0' });
