import { createHash, timingSafeEqual } from 'node:crypto';
import { QUEUES, type WebhookAck } from '@7sebeti/contracts';
import { schema } from '@7sebeti/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app';

/**
 * Converty order webhooks: POST /webhooks/converty/:connectionId/:secret
 *
 * The payload is stored verbatim in inbound_event and its job is enqueued in the same
 * transaction. We only answer 200 once both are committed; any failure returns 500 so
 * Converty retries.
 */
export function webhookRoutes({ db, withTransaction }: AppDeps) {
  return new Hono().post('/converty/:connectionId/:secret', async (c) => {
    const { connectionId, secret } = c.req.param();
    const [connection] = await db
      .select()
      .from(schema.integrationConnection)
      .where(
        and(
          eq(schema.integrationConnection.id, connectionId),
          eq(schema.integrationConnection.provider, 'converty'),
        ),
      )
      .limit(1)
      .catch(() => []);

    if (!connection?.webhookSecretHash || !matchesSecret(secret, connection.webhookSecretHash)) {
      return c.json<WebhookAck>({ ok: false }, 404);
    }

    const payload = await c.req.json().catch(() => null);
    if (payload === null) return c.json<WebhookAck>({ ok: false }, 400);

    const eventId = await withTransaction(async (tx) => {
      const [event] = await tx.db
        .insert(schema.inboundEvent)
        .values({
          organizationId: connection.organizationId,
          connectionId: connection.id,
          provider: 'converty',
          eventType: c.req.header('x-converty-event') ?? 'order.upsert',
          payload,
        })
        .returning({ id: schema.inboundEvent.id });
      if (!event) throw new Error('inbound_event insert returned nothing');
      await tx.enqueue(QUEUES.inboundEvent, { eventId: event.id });
      return event.id;
    });

    return c.json<WebhookAck>({ ok: true, eventId });
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
