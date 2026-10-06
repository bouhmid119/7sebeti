import { timingSafeEqual } from 'node:crypto';
import { QUEUES, type WebhookAck } from '@7sebeti/contracts';
import { schema } from '@7sebeti/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app';

export const INBOUND_EVENT_QUEUE = QUEUES.inboundEvent;

/**
 * Converty order webhooks: POST /webhooks/converty/:connectionId/:secret
 *
 * The payload is stored verbatim in inbound_event, then handed to the worker. We only
 * answer 200 once it is durably stored; any failure returns 500 so Converty retries
 * (v1 answered 200 on failure and lost the event).
 */
export function webhookRoutes({ db, enqueue }: AppDeps) {
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

    if (!connection?.webhookSecret || !safeEqual(secret, connection.webhookSecret)) {
      return c.json<WebhookAck>({ ok: false }, 404);
    }

    const payload = await c.req.json().catch(() => null);
    if (payload === null) return c.json<WebhookAck>({ ok: false }, 400);

    const [event] = await db
      .insert(schema.inboundEvent)
      .values({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        provider: 'converty',
        eventType: c.req.header('x-converty-event') ?? 'order.upsert',
        payload,
      })
      .returning({ id: schema.inboundEvent.id });

    if (!event) return c.json<WebhookAck>({ ok: false }, 500);
    await enqueue(INBOUND_EVENT_QUEUE, { eventId: event.id });
    return c.json<WebhookAck>({ ok: true, eventId: event.id });
  });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
