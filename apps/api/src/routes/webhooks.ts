import { createHash, timingSafeEqual } from 'node:crypto';
import { QUEUES, type WebhookAck } from '@7sebeti/contracts';
import { and, eq, schema, sql, withTenant } from '@7sebeti/db';
import { converty, payloadHash, sealPayload } from '@7sebeti/integrations';
import { Hono } from 'hono';
import type { AppDeps } from '../app';

/**
 * Converty order webhooks: POST /webhooks/converty/:connectionId/:secret
 *
 * 1. Route to the organization (owner role: no tenant context yet) and check the hashed secret.
 * 2. Fingerprint the canonical payload. If this order's last known fingerprint is the same,
 *    only a counter moves: no stored payload, no job, no recompute.
 * 3. Otherwise, under the organization's RLS context: record the new fingerprint, store the
 *    payload compressed and encrypted with the organization data key, and enqueue the job,
 *    all in one transaction. 200 only once committed; 500 on failure so Converty retries.
 */
export function webhookRoutes({ db, dataKeyFor, enqueueInTx }: AppDeps) {
  return new Hono().post('/converty/:connectionId/:secret', async (c) => {
    const { connectionId, secret } = c.req.param();
    const [connection] = await db
      .select({
        id: schema.integrationConnection.id,
        organizationId: schema.integrationConnection.organizationId,
        webhookSecretHash: schema.integrationConnection.webhookSecretHash,
      })
      .from(schema.integrationConnection)
      .where(
        and(
          eq(schema.integrationConnection.id, connectionId),
          eq(schema.integrationConnection.provider, 'converty'),
          eq(schema.integrationConnection.isActive, true),
        ),
      )
      .limit(1)
      .catch(() => []);

    if (!connection?.webhookSecretHash || !matchesSecret(secret, connection.webhookSecretHash)) {
      return c.json<WebhookAck>({ ok: false }, 404);
    }

    const payload = await c.req.json().catch(() => null);
    if (payload === null) return c.json<WebhookAck>({ ok: false }, 400);
    const order = converty.convertySource.parseWebhook(payload);
    if (!order) return c.json<WebhookAck>({ ok: true }, 202);

    const hash = payloadHash(converty.unwrapWebhookBody(payload));
    const dataKey = await dataKeyFor(connection.organizationId);

    const result = await withTenant(db, connection.organizationId, async (tx) => {
      const stateKey = and(
        eq(schema.externalObjectState.organizationId, connection.organizationId),
        eq(schema.externalObjectState.provider, 'converty'),
        eq(schema.externalObjectState.objectType, 'order'),
        eq(schema.externalObjectState.externalId, order.externalId),
      );
      const [state] = await tx
        .select({ payloadHash: schema.externalObjectState.payloadHash })
        .from(schema.externalObjectState)
        .where(stateKey)
        .for('update')
        .limit(1);

      if (state?.payloadHash === hash) {
        await tx
          .update(schema.externalObjectState)
          .set({
            duplicateCount: sql`${schema.externalObjectState.duplicateCount} + 1`,
            lastSeenAt: new Date(),
          })
          .where(stateKey);
        return { duplicate: true as const };
      }

      await tx
        .insert(schema.externalObjectState)
        .values({
          organizationId: connection.organizationId,
          provider: 'converty',
          objectType: 'order',
          externalId: order.externalId,
          payloadHash: hash,
        })
        .onConflictDoUpdate({
          target: [
            schema.externalObjectState.organizationId,
            schema.externalObjectState.provider,
            schema.externalObjectState.objectType,
            schema.externalObjectState.externalId,
          ],
          set: { payloadHash: hash, lastSeenAt: new Date() },
        });

      const [event] = await tx
        .insert(schema.inboundEvent)
        .values({
          organizationId: connection.organizationId,
          connectionId: connection.id,
          provider: 'converty',
          eventType: c.req.header('x-converty-event') ?? 'order.upsert',
          externalId: order.externalId,
          payloadHash: hash,
          payloadEncrypted: sealPayload(payload, dataKey),
        })
        .returning({ id: schema.inboundEvent.id });
      if (!event) throw new Error('inbound_event insert returned nothing');
      await enqueueInTx(tx, QUEUES.inboundEvent, { eventId: event.id });
      return { duplicate: false as const, eventId: event.id };
    });

    return c.json<WebhookAck>(
      result.duplicate ? { ok: true, duplicate: true } : { ok: true, eventId: result.eventId },
    );
  });
}

/** Webhook secrets are stored as SHA-256 hex; compare in constant time. */
export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function matchesSecret(secret: string, expectedHash: string): boolean {
  const a = Buffer.from(hashWebhookSecret(secret), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
