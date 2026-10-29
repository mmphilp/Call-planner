import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { User } from './repo';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw httpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return r.data;
}

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: User;
  }
}

export function me(req: FastifyRequest): User {
  return req.currentUser;
}

export function requireAdmin(req: FastifyRequest): User {
  if (req.currentUser.role !== 'admin') throw httpError(403, 'Admin access required');
  return req.currentUser;
}
