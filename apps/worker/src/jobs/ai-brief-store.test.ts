/**
 * Brief store against a real database, under row-level security. Runs when DATABASE_URL points
 * at a migrated database (CI does this); skipped otherwise.
 */
import { randomUUID } from 'node:crypto';
import { createDb, schema, sql } from '@7sebeti/db';
import type { Signal } from '@7sebeti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBriefStore } from './ai-brief-store';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('createBriefStore', () => {
  const { db, client } = createDb(url ?? '', { max: 2 });
  const store = createBriefStore(db);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const productId = randomUUID();
  const org = { id: orgA, timezone: 'Africa/Tunis', currency: 'TND' as const };

  async function addOrder(
    externalId: string,
    createdAt: string,
    over: Partial<typeof schema.order.$inferInsert> = {},
    line: Partial<typeof schema.orderLine.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(schema.order)
      .values({
        organizationId: orgA,
        provider: 'converty',
        externalId,
        sourceStatus: 'confirmed',
        category: 'confirmed',
        city: 'Sousse',
        confirmingAgent: 'Yasmine',
        sourceCreatedAt: new Date(createdAt),
        sourceUpdatedAt: new Date(createdAt),
        ...over,
      })
      .returning({ id: schema.order.id });
    await db.insert(schema.orderLine).values({
      organizationId: orgA,
      orderId: row?.id ?? '',
      externalProductKey: 'cv-123',
      quantity: 1,
      ...line,
    });
  }

  beforeAll(async () => {
    await db.insert(schema.organization).values([
      { id: orgA, name: 'A', slug: `a-${orgA}`, dataKeyEncrypted: 'x' },
      { id: orgB, name: 'B', slug: `b-${orgB}`, dataKeyEncrypted: 'x' },
    ]);
    await db.insert(schema.product).values([
      {
        id: productId,
        organizationId: orgA,
        name: 'Brosse lissante',
        sellingPrice: 69_000,
        costPrice: 18_000,
        packagingPerOrder: 1_000,
        packagingPerUnit: 500,
        restockLeadTimeDays: 12,
      },
      { organizationId: orgA, name: 'Ancien produit', sellingPrice: 1, archivedAt: new Date() },
    ]);
    await db.insert(schema.externalProductLink).values({
      organizationId: orgA,
      provider: 'converty',
      externalKey: 'cv-123',
      productId,
      quantity: 2,
    });
    // 23:30 UTC on the 18th is already the 19th in Tunis.
    await addOrder('o1', '2026-10-18T23:30:00Z', { city: 'تونس' });
    await addOrder('o2', '2026-10-15T10:00:00Z', {
      category: 'refused',
      confirmingAgent: null,
      city: 'Paris',
    });
    await addOrder('test', '2026-10-15T10:00:00Z', { isTest: true });
    await addOrder('upsell-only', '2026-10-15T10:00:00Z', {}, { isUpsell: true });
    await addOrder('unlinked', '2026-10-15T10:00:00Z', {}, { externalProductKey: 'inconnu' });
    await addOrder('uncategorized', '2026-10-15T10:00:00Z', { category: null });
    await addOrder('too-old', '2026-08-01T10:00:00Z');
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(sql`id in (${orgA}, ${orgB})`);
    await client.end();
  });

  it('charge produits et commandes utiles, dans le fuseau de l organisation', async () => {
    const input = await store.loadSignalInput(org, '2026-10-20');
    expect(input.products).toEqual([
      {
        id: productId,
        name: 'Brosse lissante',
        sellingPriceMinor: 69_000,
        unitCostMinor: 18_000,
        packagingPerOrderMinor: 1_500,
        deliveryCostMinor: 0,
        returnCostMinor: 0,
        stockQty: null,
        restockLeadTimeDays: 12,
        targetConfirmRatePct: null,
      },
    ]);
    expect([...input.orders].sort((a, b) => b.date.localeCompare(a.date))).toEqual([
      expect.objectContaining({
        date: '2026-10-19',
        quantity: 2,
        status: 'confirmed',
        agent: 'Yasmine',
        governorate: 'Tunis',
      }),
      expect.objectContaining({ date: '2026-10-15', status: 'refused', agent: null, governorate: null }),
    ]);
    expect(input.adDays).toEqual([]);
  });

  it('crée un brief par jour, met à jour selon le statut attendu, et l isole par organisation', async () => {
    const signals = [{ id: 'C1' }] as unknown as Signal[];
    const brief = { organizationId: orgA, briefDate: '2026-10-20', signals, payload: null, pseudonyms: null };
    const first = await store.insertBrief({ ...brief, status: 'pending' });
    const again = await store.insertBrief({ ...brief, status: 'empty' });
    expect(again.id).toBe(first.id);
    expect(again.status).toBe('pending');

    expect(await store.updateBrief(orgA, first.id, ['submitted'], { status: 'ready' })).toBe(false);
    expect(await store.updateBrief(orgA, first.id, ['pending'], { status: 'submitted', batchId: 'b1' })).toBe(
      true,
    );
    expect(await store.findBrief(orgA, '2026-10-20')).toMatchObject({ status: 'submitted', batchId: 'b1' });

    const refs = await store.listBriefRefs(['submitted'], '2026-10-19');
    expect(refs).toContainEqual(
      expect.objectContaining({ id: first.id, organizationId: orgA, batchId: 'b1' }),
    );

    // Under organization B's context the row does not exist, and cannot be changed.
    expect(await store.getBrief(orgB, first.id)).toBeNull();
    expect(await store.updateBrief(orgB, first.id, ['submitted'], { status: 'failed' })).toBe(false);
  });
});
