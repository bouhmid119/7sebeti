import { z } from 'zod';

/** Schemas shared by apps/api (validation, OpenAPI) and apps/web (typed client). */

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.enum(['ok', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const WebhookAck = z.object({
  ok: z.boolean(),
  eventId: z.string().uuid().optional(),
  /** True when the payload was identical to the last one seen for this object. */
  duplicate: z.boolean().optional(),
});
export type WebhookAck = z.infer<typeof WebhookAck>;

/** pg-boss queue names shared by apps/api (producer) and apps/worker (consumer). */
export const QUEUES = {
  inboundEvent: 'inbound-event',
} as const;
