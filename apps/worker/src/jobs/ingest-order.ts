import { and, type Db, eq, schema, sql, withTenant } from '@7sebeti/db';
import type { Currency, StatusRule } from '@7sebeti/domain';
import { categorizeStatus, normalizePhone, toMinor } from '@7sebeti/domain';
import { converty, encryptField, hashPhone, openPayload } from '@7sebeti/integrations';

const { inboundEvent, order, orderEvent, orderLine, organization, statusMapping } = schema;

export interface IngestDeps {
  db: Db;
  dataKeyFor: (organizationId: string) => Promise<Buffer>;
}

/**
 * Turn one stored inbound event into order / order_line / order_event rows, under the
 * organization's RLS context. Idempotent: replaying the same event (or an older one)
 * never double-counts. Personal data is written encrypted (name) or keyed-hashed (phone).
 */
export async function ingestOrderEvent(
  { db, dataKeyFor }: IngestDeps,
  eventId: string,
): Promise<'processed' | 'stale' | 'ignored'> {
  // Routing read as the owner role: the job only carries the event id.
  const [meta] = await db
    .select({ organizationId: inboundEvent.organizationId, status: inboundEvent.status })
    .from(inboundEvent)
    .where(eq(inboundEvent.id, eventId))
    .limit(1);
  if (!meta) throw new Error(`inbound_event ${eventId} not found`);
  if (meta.status === 'processed') return 'processed';
  const orgId = meta.organizationId;

  try {
    const dataKey = await dataKeyFor(orgId);
    const result = await withTenant(db, orgId, async (tx) => {
      const [event] = await tx.select().from(inboundEvent).where(eq(inboundEvent.id, eventId)).limit(1);
      const [org] = await tx.select().from(organization).where(eq(organization.id, orgId)).limit(1);
      if (!event || !org) throw new Error(`event or organization not visible for ${orgId}`);

      const normalized = converty.convertySource.parseWebhook(openPayload(event.payloadEncrypted, dataKey));
      if (!normalized) return 'ignored' as const;
      const currency = org.currency as Currency;

      const rules: StatusRule[] = (
        await tx.select().from(statusMapping).where(eq(statusMapping.provider, 'converty'))
      ).map((r) => ({ match: r.match, kind: r.kind, category: r.category }));
      const categorize = (status: string) =>
        (rules.length > 0 ? categorizeStatus(status, rules) : null) ?? categorizeStatus(status);

      const [existing] = await tx
        .select({ id: order.id, sourceUpdatedAt: order.sourceUpdatedAt, hadUpsell: order.hadUpsell })
        .from(order)
        .where(and(eq(order.provider, 'converty'), eq(order.externalId, normalized.externalId)))
        .for('update')
        .limit(1);
      if (existing && existing.sourceUpdatedAt > normalized.sourceUpdatedAt) return 'stale' as const;

      const phone = normalizePhone(normalized.customerPhone, org.country as 'TN');
      const values = {
        organizationId: orgId,
        connectionId: event.connectionId,
        provider: 'converty' as const,
        externalId: normalized.externalId,
        customerNameEncrypted: normalized.customerName
          ? encryptField(normalized.customerName, dataKey)
          : null,
        customerPhoneHash: phone ? hashPhone(phone, dataKey) : null,
        customerPhoneLast3: phone ? phone.slice(-3) : null,
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
            organizationId: orgId,
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
              organizationId: orgId,
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

    await markEvent(db, eventId, 'processed', result === 'processed' ? null : result);
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
