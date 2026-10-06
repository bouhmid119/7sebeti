import { type Db, schema } from '@7sebeti/db';
import type { Currency } from '@7sebeti/domain';
import { categorizeStatus, normalizePhone, type StatusRule, toMinor } from '@7sebeti/domain';
import { converty } from '@7sebeti/integrations';
import { and, eq, sql } from 'drizzle-orm';

const { inboundEvent, order, orderEvent, orderLine, organization, statusMapping } = schema;

/**
 * Turn one stored inbound event into order / order_line / order_event rows.
 * Idempotent: replaying the same event (or an older one) never double-counts.
 */
export async function ingestOrderEvent(db: Db, eventId: string): Promise<'processed' | 'stale' | 'ignored'> {
  const [event] = await db.select().from(inboundEvent).where(eq(inboundEvent.id, eventId)).limit(1);
  if (!event) throw new Error(`inbound_event ${eventId} not found`);
  if (event.status === 'processed') return 'processed';

  try {
    const normalized = converty.convertySource.parseWebhook(event.payload);
    if (!normalized) {
      await markEvent(db, eventId, 'processed', 'not an order payload');
      return 'ignored';
    }

    const [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, event.organizationId))
      .limit(1);
    if (!org) throw new Error(`organization ${event.organizationId} not found`);
    const currency = org.currency as Currency;

    const rules: StatusRule[] = (
      await db
        .select()
        .from(statusMapping)
        .where(and(eq(statusMapping.organizationId, org.id), eq(statusMapping.provider, 'converty')))
    ).map((r) => ({ match: r.match, kind: r.kind, category: r.category }));
    const categorize = (status: string) =>
      (rules.length > 0 ? categorizeStatus(status, rules) : null) ?? categorizeStatus(status);

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: order.id, sourceUpdatedAt: order.sourceUpdatedAt, hadUpsell: order.hadUpsell })
        .from(order)
        .where(
          and(
            eq(order.organizationId, org.id),
            eq(order.provider, 'converty'),
            eq(order.externalId, normalized.externalId),
          ),
        )
        .for('update')
        .limit(1);

      if (existing && existing.sourceUpdatedAt > normalized.sourceUpdatedAt) return 'stale' as const;

      const values = {
        organizationId: org.id,
        connectionId: event.connectionId,
        provider: 'converty' as const,
        externalId: normalized.externalId,
        customerName: normalized.customerName,
        customerPhone: normalizePhone(normalized.customerPhone, org.country as 'TN') || null,
        city: normalized.city,
        sourceStatus: normalized.sourceStatus,
        category: categorize(normalized.sourceStatus),
        total: normalized.total == null ? null : toMinor(normalized.total, currency),
        deliveryFee: normalized.deliveryFee == null ? null : toMinor(normalized.deliveryFee, currency),
        isTest: normalized.isTest,
        // Sticky: an upsell an agent later removed still counts as offered.
        hadUpsell: normalized.lines.some((l) => l.isUpsell) || (existing?.hadUpsell ?? false),
        confirmingAgent: converty.confirmingAgent(normalized),
        sourceCreatedAt: normalized.sourceCreatedAt,
        sourceUpdatedAt: normalized.sourceUpdatedAt,
      };

      const [row] = await tx
        .insert(order)
        .values(values)
        .onConflictDoUpdate({
          target: [order.organizationId, order.provider, order.externalId],
          set: { ...values, updatedAt: sql`now()` },
        })
        .returning({ id: order.id });
      if (!row) throw new Error('order upsert returned nothing');

      // Lines mirror the current cart; history is append-only.
      await tx.delete(orderLine).where(eq(orderLine.orderId, row.id));
      if (normalized.lines.length > 0) {
        await tx.insert(orderLine).values(
          normalized.lines.map((l) => ({
            orderId: row.id,
            externalProductKey: l.externalProductKey,
            productName: l.productName,
            quantity: l.quantity,
            unitPrice: l.unitPrice == null ? null : toMinor(l.unitPrice, currency),
            isUpsell: l.isUpsell,
          })),
        );
      }
      if (normalized.events.length > 0) {
        await tx
          .insert(orderEvent)
          .values(
            normalized.events.map((e) => ({
              orderId: row.id,
              sourceStatus: e.sourceStatus,
              category: categorize(e.sourceStatus),
              attempt: e.attempt,
              actor: e.actor,
              occurredAt: e.occurredAt,
            })),
          )
          .onConflictDoNothing();
      }
      return 'processed' as const;
    });

    await markEvent(db, eventId, 'processed', result === 'stale' ? 'stale' : null);
    return result;
  } catch (err) {
    await markEvent(db, eventId, 'failed', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function markEvent(db: Db, id: string, status: 'processed' | 'failed', error: string | null) {
  await db
    .update(inboundEvent)
    .set({
      status,
      error,
      attempts: sql`${inboundEvent.attempts} + 1`,
      processedAt: status === 'processed' ? new Date() : null,
    })
    .where(eq(inboundEvent.id, id));
}
