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

/** Overall admin, or a team admin for at least one service. */
export function isScheduler(user: User): boolean {
  return user.role === 'admin' || user.adminServiceIds.length > 0;
}

export function requireScheduler(req: FastifyRequest): User {
  if (!isScheduler(req.currentUser)) throw httpError(403, 'Admin access required');
  return req.currentUser;
}

/** Team admins manage weekday call for their own services; weekends stay with the overall admin. */
export function canEditShift(user: User, shift: { serviceId: string; kind: string }): boolean {
  return user.role === 'admin' || (shift.kind !== 'weekend' && user.adminServiceIds.includes(shift.serviceId));
}

export function canEditService(user: User, serviceId: string): boolean {
  return user.role === 'admin' || user.adminServiceIds.includes(serviceId);
}

/** Anyone who can see everything read-only: admins, team admins and viewers (e.g. an assistant). */
export function canView(user: User): boolean {
  return isScheduler(user) || user.role === 'viewer';
}

export function requireViewer(req: FastifyRequest): User {
  if (!canView(req.currentUser)) throw httpError(403, 'Not allowed');
  return req.currentUser;
}
