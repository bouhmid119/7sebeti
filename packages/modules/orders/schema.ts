/**
 * orders: order lifecycle, append-only status history, status mapping per organization.
 */

import { integrationConnection, integrationProvider } from '@7sebeti/modules/connectors';
import { organizationRef } from '@7sebeti/modules/identity';
import { boolean, index, integer, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, updatedAt } from '../shared/columns';

export const ordersSchema = pgSchema('orders');

export const orderStatusCategory = ordersSchema.enum('order_status_category', [
  'pending',
  'no_answer',
  'callback',
  'confirmed',
  'refused',
  'shipped',
  'delivered',
  'returned',
  'ignored',
]);

/** Per-organization override of how a source status maps to a canonical category. */
export const statusMapping = ordersSchema.table(
  'status_mapping',
  {
    id: id(),
    organizationId: organizationRef(),
    provider: integrationProvider().notNull(),
    match: text().notNull(),
    kind: text({ enum: ['exact', 'prefix'] }).notNull(),
    category: orderStatusCategory().notNull(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.provider, t.match, t.kind)],
);

export const order = ordersSchema.table(
  'order',
  {
    id: id(),
    organizationId: organizationRef(),
    connectionId: uuid().references(() => integrationConnection.id, { onDelete: 'set null' }),
    provider: integrationProvider().notNull(),
    externalId: text().notNull(),
    /** Customer name encrypted with the organization data key. */
    customerNameEncrypted: text(),
    /** HMAC of the normalized phone with an organization-derived key: matches repeat customers without storing the number. */
    customerPhoneHash: text(),
    customerPhoneLast3: text(),
    city: text(),
    sourceStatus: text().notNull(),
    category: orderStatusCategory(),
    total: money(),
    deliveryFee: money(),
    isTest: boolean().notNull().default(false),
    hadUpsell: boolean().notNull().default(false),
    confirmingAgent: text(),
    sourceCreatedAt: timestamp({ withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.organizationId, t.provider, t.externalId),
    index().on(t.organizationId, t.sourceCreatedAt),
    index().on(t.organizationId, t.customerPhoneHash),
  ],
);

export const orderLine = ordersSchema.table(
  'order_line',
  {
    id: id(),
    organizationId: organizationRef(),
    orderId: uuid()
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),
    externalProductKey: text().notNull(),
    productName: text(),
    quantity: integer().notNull(),
    unitPrice: money(),
    isUpsell: boolean().notNull().default(false),
  },
  (t) => [index().on(t.orderId)],
);

/** Status history, append-only: never overwritten, so confirmation and delivery delays stay computable. */
export const orderEvent = ordersSchema.table(
  'order_event',
  {
    id: id(),
    organizationId: organizationRef(),
    orderId: uuid()
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),
    sourceStatus: text().notNull(),
    category: orderStatusCategory(),
    attempt: integer(),
    actor: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex().on(t.orderId, t.occurredAt, t.sourceStatus)],
);
