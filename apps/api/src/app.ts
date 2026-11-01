import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { openDb, type Db } from './db';
import { HttpError } from './http';
import { getUser } from './repo';
import { calendarRoutes } from './routes/calendar';
import { peopleRoutes } from './routes/people';
import { flagRoutes } from './routes/flags';
import { periodRoutes } from './routes/periods';
import { signoffRoutes } from './routes/signoff';
import { requestRoutes } from './routes/requests';
import { routineRoutes } from './routes/routine';
import { tradeRoutes } from './routes/trades';

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

/** The 403 message when a password change is required; the apps watch for it. */
export const PASSWORD_CHANGE_REQUIRED = 'Please choose a new password first';

/** The release version, from the root package.json. */
const VERSION: string = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;

export interface AppOptions {
  db?: Db;
  dbPath?: string;
  jwtSecret: string;
  logger?: boolean;
  /** Built admin console (apps/admin/dist) to serve from the same origin. */
  adminDir?: string;
  /** Web build of the app (apps/mobile web export), served at the site root. */
  appDir?: string;
  /** Set when running behind a reverse proxy or tunnel, so client IPs are real. */
  trustProxy?: boolean;
  /** Who to contact about sign-in problems, shown on the sign-in pages. */
  supportEmail?: string;
}

export async function buildApp(opts: AppOptions) {
  const db = opts.db ?? openDb(opts.dbPath ?? ':memory:');
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret });

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || req.routeOptions.config.public || req.method === 'OPTIONS') return;
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Please sign in');
    }
    const user = getUser(db, req.user.sub);
    if (!user || !user.active) throw new HttpError(401, 'Please sign in');
    // Until a required password change is done, only allow who-am-I and changing it.
    if (user.mustChangePassword && !(req.url === '/api/me' || req.url.startsWith('/api/me/password'))) {
      throw new HttpError(403, PASSWORD_CHANGE_REQUIRED);
    }
    req.currentUser = user;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  app.get('/health', { config: { public: true } }, async () => ({ ok: true, version: VERSION }));
  // Public details for the sign-in pages.
  app.get('/api/info', { config: { public: true } }, async () => ({ supportEmail: opts.supportEmail || null }));
  peopleRoutes(app, db);
  periodRoutes(app, db);
  requestRoutes(app, db);
  routineRoutes(app, db);
  tradeRoutes(app, db);
  flagRoutes(app, db);
  signoffRoutes(app, db);
  calendarRoutes(app, db);

  const hasBuild = (dir?: string): dir is string => !!dir && existsSync(resolve(dir, 'index.html'));
  const appDir = hasBuild(opts.appDir) ? resolve(opts.appDir) : null;
  const adminDir = hasBuild(opts.adminDir) ? resolve(opts.adminDir) : null;
  // One address for everyone: the app at /, the admin tools under /admin/.
  if (adminDir) {
    await app.register(fastifyStatic, { root: adminDir, prefix: '/admin/' });
    app.get('/admin', { config: { public: true } }, (_req, reply) => reply.redirect('/admin/'));
  }
  if (appDir) {
    await app.register(fastifyStatic, { root: appDir, prefix: '/', decorateReply: !adminDir, wildcard: true });
    // Old links and home-screen icons pointed at /app.
    app.get('/app', { config: { public: true } }, (_req, reply) => reply.redirect('/'));
    app.get('/app/*', { config: { public: true } }, (_req, reply) => reply.redirect('/'));
  }
  if (appDir || adminDir) {
    // Client-side routes (/admin/periods/…, /requests) load their page's index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/cal/')) {
        if (adminDir && req.url.startsWith('/admin')) return reply.sendFile('index.html', adminDir);
        if (appDir) return reply.sendFile('index.html', appDir);
      }
      reply.code(404).send({ error: 'Not found' });
    });
  }

  return { app, db };
}
