/**
 * Row-level security checks against a real database. Runs when DATABASE_URL points at a
 * migrated database (CI does this); skipped otherwise.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, RLS_EXEMPT_TABLES, schema, withTenant, withUser } from './index';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('row-level security', () => {
  const { db, client } = createDb(url ?? '', { max: 2 });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();

  beforeAll(async () => {
    // As the table owner (cross-tenant), seed two organizations.
    await db.insert(schema.organization).values([
      { id: orgA, name: 'A', slug: `a-${orgA}`, dataKeyEncrypted: 'x' },
      { id: orgB, name: 'B', slug: `b-${orgB}`, dataKeyEncrypted: 'x' },
    ]);
    await db.insert(schema.user).values({ id: userA, email: `${userA}@test.local` });
    await db.insert(schema.membership).values({ organizationId: orgA, userId: userA, role: 'owner' });
    await db.insert(schema.product).values([
      { organizationId: orgA, name: 'Sérum A', sellingPrice: 69000 },
      { organizationId: orgB, name: 'Sérum B', sellingPrice: 59000 },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(sql`id in (${orgA}, ${orgB})`);
    await db.delete(schema.user).where(sql`id = ${userA}`);
    await client.end();
  });

  it('puts every public table under RLS unless explicitly exempt', async () => {
    const rows = await db.execute<{ relname: string }>(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    const unprotected = rows
      .map((r) => r.relname)
      .filter((t) => !(RLS_EXEMPT_TABLES as readonly string[]).includes(t));
    expect(unprotected).toEqual([]);
  });

  it('shows an organization only its own rows', async () => {
    const names = await withTenant(db, orgA, (tx) =>
      tx.select({ name: schema.product.name, org: schema.product.organizationId }).from(schema.product),
    );
    expect(names.every((p) => p.org === orgA)).toBe(true);
    expect(names.map((p) => p.name)).toContain('Sérum A');
  });

  it('returns nothing without an organization context', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_rw`);
      return tx.select().from(schema.product);
    });
    expect(rows).toEqual([]);
  });

  it('refuses writes into another organization', async () => {
    await expect(
      withTenant(db, orgA, (tx) =>
        tx.insert(schema.product).values({ organizationId: orgB, name: 'intrus', sellingPrice: 1 }),
      ),
    ).rejects.toThrow();
  });

  it('lets a user list only their organizations before choosing one', async () => {
    const orgs = await withUser(db, userA, (tx) =>
      tx.select({ id: schema.organization.id }).from(schema.organization),
    );
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
  });
});
