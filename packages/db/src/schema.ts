/**
 * v2 core schema. Every business table carries `organizationId` (the merchant).
 * Money columns are integers in minor units of the organization's currency
 * (millimes for TND); see @7sebeti/domain/money.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = () => bigint({ mode: 'number' });
const orgRef = () =>
  uuid()
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

// ─── Tenancy ────────────────────────────────────────────────────────────────

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'agent', 'viewer']);

export const organization = pgTable('organization', {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  country: text().notNull().default('TN'),
  currency: text().notNull().default('TND'),
  timezone: text().notNull().default('Africa/Tunis'),
  /** Modules the merchant is subscribed to (dashboard, funnel, cashflow…). */
  enabledModules: text().array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const user = pgTable('user', {
  id: id(),
  email: text().notNull().unique(),
  name: text(),
  isPlatformAdmin: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const membership = pgTable(
  'membership',
  {
    organizationId: orgRef(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRole().notNull(),
    /** Module keys an agent may open; ignored for owner/admin. */
    permissions: text().array().notNull().default(sql`'{}'::text[]`),
    /** Name this person appears under in the order source history (agent attribution). */
    sourceAgentName: text(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

// ─── Integrations ───────────────────────────────────────────────────────────

export const integrationProvider = pgEnum('integration_provider', [
  'converty',
  'converty_sheets',
  'dropo',
  'cosmos',
  'meta',
]);

export const integrationConnection = pgTable(
  'integration_connection',
  {
    id: id(),
    organizationId: orgRef(),
    provider: integrationProvider().notNull(),
    label: text().notNull(),
    /** Store / account id on the provider side. */
    externalAccountId: text(),
    /** AES-GCM ciphertext of the provider credentials (tokens). Never sent to the client. */
    credentialsEncrypted: text(),
    credentialsExpireAt: timestamp({ withTimezone: true }),
    /** SHA-256 of the random secret embedded in the webhook URL (Converty does not sign payloads). */
    webhookSecretHash: text(),
    isActive: boolean().notNull().default(true),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastSyncError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId), uniqueIndex().on(t.organizationId, t.provider, t.externalAccountId)],
);

export const inboundEventStatus = pgEnum('inbound_event_status', ['received', 'processed', 'failed']);

/** Every webhook / pulled payload, stored verbatim before any processing so it can be replayed. */
export const inboundEvent = pgTable(
  'inbound_event',
  {
    id: id(),
    organizationId: orgRef(),
    connectionId: uuid().references(() => integrationConnection.id, { onDelete: 'set null' }),
    provider: integrationProvider().notNull(),
    eventType: text().notNull(),
    externalId: text(),
    payload: jsonb().notNull(),
    status: inboundEventStatus().notNull().default('received'),
    attempts: integer().notNull().default(0),
    error: text(),
    receivedAt: createdAt(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.organizationId, t.receivedAt), index().on(t.status)],
);

// ─── Catalog ────────────────────────────────────────────────────────────────

export const product = pgTable(
  'product',
  {
    id: id(),
    organizationId: orgRef(),
    name: text().notNull(),
    sku: text(),
    isBundle: boolean().notNull().default(false),
    sellingPrice: money().notNull(),
    upsellPrice: money(),
    costPrice: money(),
    packagingPerUnit: money().notNull().default(0),
    packagingPerOrder: money().notNull().default(0),
    /** Supplier lead time in days, used for stock-out alerts. */
    restockLeadTimeDays: integer(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId)],
);

export const bundleComponent = pgTable(
  'bundle_component',
  {
    organizationId: orgRef(),
    bundleId: uuid()
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    componentId: uuid()
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantity: integer().notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.bundleId, t.componentId] })],
);

/** Links a source product (Converty product id, carrier content label, Meta campaign) to a 7sebeti product. */
export const externalProductLink = pgTable(
  'external_product_link',
  {
    id: id(),
    organizationId: orgRef(),
    provider: integrationProvider().notNull(),
    externalKey: text().notNull(),
    displayName: text(),
    productId: uuid().references(() => product.id, { onDelete: 'cascade' }),
    /** Units of `productId` one external unit represents (e.g. a "2 boxes" offer). */
    quantity: integer().notNull().default(1),
    lastSeenAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.provider, t.externalKey)],
);

// ─── Orders ─────────────────────────────────────────────────────────────────

export const orderStatusCategory = pgEnum('order_status_category', [
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
export const statusMapping = pgTable(
  'status_mapping',
  {
    id: id(),
    organizationId: orgRef(),
    provider: integrationProvider().notNull(),
    match: text().notNull(),
    kind: text({ enum: ['exact', 'prefix'] }).notNull(),
    category: orderStatusCategory().notNull(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.provider, t.match, t.kind)],
);

export const order = pgTable(
  'order',
  {
    id: id(),
    organizationId: orgRef(),
    connectionId: uuid().references(() => integrationConnection.id, { onDelete: 'set null' }),
    provider: integrationProvider().notNull(),
    externalId: text().notNull(),
    customerName: text(),
    customerPhone: text(),
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
    index().on(t.organizationId, t.customerPhone),
  ],
);

export const orderLine = pgTable(
  'order_line',
  {
    id: id(),
    organizationId: orgRef(),
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
export const orderEvent = pgTable(
  'order_event',
  {
    id: id(),
    organizationId: orgRef(),
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
