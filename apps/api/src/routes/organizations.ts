import { eq, schema, withTenant, withUser } from '@7sebeti/db';
import { generateWrappedDataKey } from '@7sebeti/integrations';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../app';
import { requireOrganization, requireSession } from '../middleware/session';

const CreateOrganization = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,40}$/),
});

export function organizationRoutes({ db, auth, dataMasterKeyring }: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('/me', requireSession(auth));
  app.use('/organizations', requireSession(auth));
  app.use('/integrations', requireSession(auth), requireOrganization(db));

  /** Current user and the organizations they belong to. */
  app.get('/me', async (c) => {
    const userId = c.get('userId');
    const organizations = await withUser(db, userId, (tx) =>
      tx
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          role: schema.membership.role,
        })
        .from(schema.membership)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.membership.organizationId))
        .where(eq(schema.membership.userId, userId)),
    );
    return c.json({ userId, organizations });
  });

  /** Create an organization; the caller becomes its owner. */
  app.post('/organizations', async (c) => {
    const parsed = CreateOrganization.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Nom ou identifiant invalide' }, 400);
    const userId = c.get('userId');
    try {
      // Platform operation (no tenant yet): runs as the owner role, in one transaction.
      const org = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.organization)
          .values({ ...parsed.data, dataKeyEncrypted: generateWrappedDataKey(dataMasterKeyring) })
          .returning({
            id: schema.organization.id,
            name: schema.organization.name,
            slug: schema.organization.slug,
          });
        if (!created) throw new Error('organization insert returned nothing');
        await tx.insert(schema.membership).values({ organizationId: created.id, userId, role: 'owner' });
        return created;
      });
      return c.json(org, 201);
    } catch (err) {
      if (
        String((err as { code?: string }).code ?? (err as Error).cause) === '23505' ||
        /unique/i.test(String(err))
      ) {
        return c.json({ error: 'Cet identifiant est déjà pris' }, 409);
      }
      throw err;
    }
  });

  /** Integrations of the current organization, without any secret. */
  app.get('/integrations', async (c) => {
    const rows = await withTenant(db, c.get('organizationId'), (tx) =>
      tx
        .select({
          id: schema.integrationConnection.id,
          provider: schema.integrationConnection.provider,
          label: schema.integrationConnection.label,
          isActive: schema.integrationConnection.isActive,
          lastSyncAt: schema.integrationConnection.lastSyncAt,
          lastSyncError: schema.integrationConnection.lastSyncError,
        })
        .from(schema.integrationConnection),
    );
    return c.json(rows);
  });

  return app;
}
