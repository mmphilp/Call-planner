import { buildApp } from './app';

const secret = process.env.JWT_SECRET;
if (!secret && process.env.NODE_ENV === 'production') {
  throw new Error('Set JWT_SECRET in production');
}

const { app } = await buildApp({
  dbPath: process.env.DATABASE_PATH ?? 'call-planner.db',
  jwtSecret: secret ?? 'dev-only-secret-change-me',
  logger: true,
});

await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
