import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { openDb, type Db } from './db';
import { HttpError } from './http';
import { getUser } from './repo';
import { calendarRoutes } from './routes/calendar';
import { peopleRoutes } from './routes/people';
import { periodRoutes } from './routes/periods';
import { requestRoutes } from './routes/requests';

declare module 'fastify' {
  interface FastifyContextConfig {
    public?: boolean;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
  }
}

export interface AppOptions {
  db?: Db;
  dbPath?: string;
  jwtSecret: string;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions) {
  const db = opts.db ?? openDb(opts.dbPath ?? ':memory:');
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret });

  app.addHook('onRequest', async (req) => {
    if (req.routeOptions.config.public || req.method === 'OPTIONS') return;
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Please sign in');
    }
    const user = getUser(db, req.user.sub);
    if (!user || !user.active) throw new HttpError(401, 'Please sign in');
    req.currentUser = user;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  app.get('/health', { config: { public: true } }, async () => ({ ok: true }));
  peopleRoutes(app, db);
  periodRoutes(app, db);
  requestRoutes(app, db);
  calendarRoutes(app, db);

  return { app, db };
}
