/**
 * Converty adapter. Converty exposes no public API docs; this mirrors the payloads the
 * v1 receives from its OAuth partner API and `order.create` / `order.update` webhooks
 * (see the v1 audit in Notion). Every field is read defensively and validated with Zod
 * so a shape change fails loudly in contract tests instead of silently skewing numbers.
 */
import { z } from 'zod';
import type { NormalizedOrder, OrderSource } from '../order-source';

export const API_BASE_URL = 'https://api.converty.shop/api/v1';
export const OAUTH_AUTHORIZE_URL = 'https://partner.converty.shop/oauth2/authorize';
export const OAUTH_TOKEN_URL = 'https://partner.converty.shop/oauth2/token';
export const WEBHOOK_EVENTS = ['order.create', 'order.update'] as const;

const ConvertyOrder = z.object({
  _id: z.string().min(1),
  status: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  isTest: z.boolean().optional(),
  customer: z
    .object({
      name: z.string().nullish(),
      phone: z.string().nullish(),
      city: z.string().nullish(),
    })
    .partial()
    .nullish(),
  cart: z
    .array(
      z.object({
        product: z.object({ _id: z.string(), name: z.string().nullish() }),
        quantity: z.number().int().nonnegative(),
        pricePerUnit: z.number().nullish(),
        isUpsellItem: z.boolean().nullish(),
      }),
    )
    .default([]),
  history: z
    .array(
      z.object({
        status: z.string().nullish(),
        attempt: z.number().nullish(),
        actionTaker: z.string().nullish(),
        timestamp: z.string().nullish(),
        date: z.string().nullish(),
      }),
    )
    .default([]),
  total: z
    .object({
      totalPrice: z.number().nullish(),
      deliveryPrice: z.number().nullish(),
      deliveryCost: z.number().nullish(),
    })
    .partial()
    .nullish(),
});
export type ConvertyOrder = z.infer<typeof ConvertyOrder>;

/** Webhook bodies have been seen wrapped as `{data}`, `{order}`, `{payload}` or bare. */
export function unwrapWebhookBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  return b.data ?? b.order ?? b.payload ?? b;
}

export function normalizeOrder(raw: unknown): NormalizedOrder {
  const o = ConvertyOrder.parse(raw);
  const createdAt = new Date(o.createdAt);
  return {
    externalId: o._id,
    sourceStatus: o.status,
    customerName: o.customer?.name ?? null,
    customerPhone: o.customer?.phone ?? null,
    city: o.customer?.city ?? null,
    total: o.total?.totalPrice ?? null,
    deliveryFee: o.total?.deliveryPrice ?? o.total?.deliveryCost ?? null,
    isTest: o.isTest ?? false,
    lines: o.cart.map((c) => ({
      externalProductKey: c.product._id,
      productName: c.product.name ?? null,
      quantity: c.quantity,
      unitPrice: c.pricePerUnit ?? null,
      isUpsell: c.isUpsellItem === true,
    })),
    events: o.history
      .filter((h) => h.status)
      .map((h) => ({
        sourceStatus: h.status as string,
        attempt: h.attempt ?? null,
        actor: h.actionTaker ?? null,
        occurredAt: new Date(h.timestamp ?? h.date ?? o.createdAt),
      })),
    sourceCreatedAt: createdAt,
    sourceUpdatedAt: o.updatedAt ? new Date(o.updatedAt) : createdAt,
  };
}

/**
 * The agent credited with a confirmation decision: the last actor on a
 * confirm/reject/cancel event, else the first non-customer actor.
 */
export function confirmingAgent(order: NormalizedOrder): string | null {
  const byAgents = order.events
    .filter((e) => e.actor && e.actor !== 'Customer')
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const decisions = new Set(['confirmed', 'rejected', 'cancelled', 'refused']);
  const decision = [...byAgents].reverse().find((e) => decisions.has(e.sourceStatus.toLowerCase().trim()));
  return decision?.actor ?? byAgents[0]?.actor ?? null;
}

export const convertySource: OrderSource = {
  provider: 'converty',
  parseWebhook(body) {
    const candidate = unwrapWebhookBody(body);
    const parsed = ConvertyOrder.safeParse(candidate);
    return parsed.success ? normalizeOrder(parsed.data) : null;
  },
};
