import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { httpError, parse, requireAdmin } from '../http';
import { listHospitals } from '../repo';
import { syncUnpublished } from '../sync';

const fields = z.object({ name: z.string().trim().min(1).max(80), shortName: z.string().trim().max(12), sort: z.number().int() });

/** The hospitals the group covers (overall admin manages; everyone can read). */
export function hospitalRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/hospitals', async () => listHospitals(db));

  app.post('/api/hospitals', async (req, reply) => {
    requireAdmin(req);
    const h = parse(fields.extend({ shortName: fields.shape.shortName.default(''), sort: fields.shape.sort.default(0) }), req.body);
    if (db.prepare('SELECT 1 FROM hospitals WHERE name = ?').get(h.name)) throw httpError(409, 'A hospital with that name already exists');
    const id = randomUUID();
    db.prepare('INSERT INTO hospitals (id, name, short_name, sort) VALUES (?, ?, ?, ?)').run(id, h.name, h.shortName, h.sort);
    reply.code(201);
    return listHospitals(db).find((x) => x.id === id);
  });

  app.patch<{ Params: { id: string } }>('/api/hospitals/:id', async (req) => {
    requireAdmin(req);
    const h = parse(fields.partial(), req.body);
    if (!listHospitals(db).some((x) => x.id === req.params.id)) throw httpError(404, 'Hospital not found');
    const cols = { name: h.name, short_name: h.shortName, sort: h.sort };
    for (const [col, val] of Object.entries(cols)) {
      if (val !== undefined) db.prepare(`UPDATE hospitals SET ${col} = ? WHERE id = ?`).run(val, req.params.id);
    }
    return listHospitals(db).find((x) => x.id === req.params.id);
  });

  /** Removing a hospital takes it off every service (a service left with none covers all). */
  app.delete<{ Params: { id: string } }>('/api/hospitals/:id', async (req) => {
    requireAdmin(req);
    db.prepare('DELETE FROM hospitals WHERE id = ?').run(req.params.id);
    syncUnpublished(db);
    return { ok: true };
  });
}
