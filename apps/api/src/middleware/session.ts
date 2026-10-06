import { and, type Db, eq, schema, withUser } from '@7sebeti/db';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import type { Auth } from '../lib/auth';

/** Requires a valid session cookie; exposes `userId`. */
export function requireSession(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await auth.getSession(c.req.raw.headers);
    if (!session) return c.json({ error: 'Non authentifié' }, 401);
    c.set('userId', session.userId);
    await next();
  };
}

/**
 * Requires `x-organization-id` naming an organization the user belongs to; exposes
 * `organizationId`. Routes then run their queries through withTenant(db, organizationId).
 */
export function requireOrganization(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const organizationId = c.req.header('x-organization-id');
    if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
      return c.json({ error: 'En-tête x-organization-id manquant' }, 400);
    }
    const userId = c.get('userId');
    const [member] = await withUser(db, userId, (tx) =>
      tx
        .select({ role: schema.membership.role })
        .from(schema.membership)
        .where(
          and(eq(schema.membership.userId, userId), eq(schema.membership.organizationId, organizationId)),
        )
        .limit(1),
    );
    if (!member) return c.json({ error: 'Organisation inaccessible' }, 403);
    c.set('organizationId', organizationId);
    await next();
  };
}
