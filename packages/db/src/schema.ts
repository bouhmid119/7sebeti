/**
 * v2 core schema. Every business table carries `organizationId` (the merchant).
 * Money columns are integers in minor units of the organization's currency
 * (millimes for TND); see @7sebeti/domain/money.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
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
  /** Per-organization data key (AES-256), wrapped with DATA_MASTER_KEY. Deleting it crypto-shreds the org. */
  dataKeyEncrypted: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Auth tables follow the Better Auth model (user, session, account, verification, two_factor).
// They are not organization-scoped and stay outside row-level security.

export const user = pgTable('user', {
  id: id(),
  email: text().notNull().unique(),
  name: text().notNull().default(''),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  twoFactorEnabled: boolean().notNull().default(false),
  isPlatformAdmin: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const userRef = () =>
  uuid()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const session = pgTable(
  'session',
  {
    id: id(),
    userId: userRef(),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: id(),
    userId: userRef(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    /** Password hash for the email/password provider. */
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.identifier)],
);

export const twoFactor = pgTable(
  'two_factor',
  {
    id: id(),
    userId: userRef(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.userId), index().on(t.secret)],
);

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
    /** SHA-256 of the canonical JSON payload. */
    payloadHash: text().notNull(),
    /** Payload gzip-compressed then encrypted with the organization data key. */
    payloadEncrypted: text().notNull(),
    status: inboundEventStatus().notNull().default('received'),
    attempts: integer().notNull().default(0),
    error: text(),
    receivedAt: createdAt(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.organizationId, t.receivedAt),
    index('inbound_event_pending_idx').on(t.receivedAt).where(sql`status <> 'processed'`),
  ],
);

/**
 * Last known fingerprint of each external object (order, shipment…). A webhook whose
 * canonical payload hash matches costs no write, no job and no recompute; only the
 * counter moves. Kept 13 months as the idempotency trail.
 */
export const externalObjectState = pgTable(
  'external_object_state',
  {
    organizationId: orgRef(),
    provider: integrationProvider().notNull(),
    objectType: text().notNull(),
    externalId: text().notNull(),
    payloadHash: text().notNull(),
    duplicateCount: integer().notNull().default(0),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.provider, t.objectType, t.externalId] })],
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

// ─── AI brief ───────────────────────────────────────────────────────────────

/**
 * empty: no signal that day, no model call. signals_only: AI off or no API key, the screen shows
 * the fixed-sentence brief (briefFromRules). pending → submitted (in a Batch API job) → ready, or
 * failed after the morning retry.
 */
export const aiBriefStatus = pgEnum('ai_brief_status', [
  'empty',
  'signals_only',
  'pending',
  'submitted',
  'ready',
  'failed',
]);

/** Daily « Actions à prendre » brief: signals computed by code, wording by Claude. One row per org and day. */
export const aiBrief = pgTable(
  'ai_brief',
  {
    id: id(),
    organizationId: orgRef(),
    /** Day of the brief in the organization's timezone. */
    briefDate: date({ mode: 'string' }).notNull(),
    status: aiBriefStatus().notNull(),
    /** Full signals (real agent names, links): what the screen shows when the AI text is missing. */
    signals: jsonb().notNull(),
    /** What is sent to the model: whitelisted, pseudonymised, formatted. Null when nothing is sent. */
    payload: jsonb(),
    /** Pseudonym → real agent name, to restore names in the answer. Never sent to the model. */
    pseudonyms: jsonb(),
    /** Validated brief with real names restored (BriefContent in @7sebeti/domain). */
    content: jsonb(),
    model: text(),
    batchId: text(),
    attempts: integer().notNull().default(0),
    /** Usage of the answer that was kept, for cost tracking (uncached input, output, cache reads and writes). */
    inputTokens: integer(),
    outputTokens: integer(),
    cacheReadTokens: integer(),
    cacheWriteTokens: integer(),
    /** Non-blocking checks on the answer (figure not found in the data, unknown pseudonym…). */
    warnings: text().array().notNull().default(sql`'{}'::text[]`),
    error: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.briefDate), index().on(t.status, t.briefDate)],
);

/** Who wrote what the merchant read: Claude, or the fixed sentences used without the model. */
export const aiBriefSource = pgEnum('ai_brief_source', ['ai', 'rules']);

/** done: the merchant did it. not_relevant: the signal did not apply to their shop. */
export const aiBriefVerdict = pgEnum('ai_brief_verdict', ['done', 'not_relevant']);

/**
 * The merchant's answer to one signal of a brief, to measure during the beta which signals
 * lead to action. One row per brief and signal: the last answer wins, removing it deletes the row.
 */
export const aiBriefFeedback = pgTable(
  'ai_brief_feedback',
  {
    id: id(),
    organizationId: orgRef(),
    briefId: uuid()
      .notNull()
      .references(() => aiBrief.id, { onDelete: 'cascade' }),
    /** Signal reference within the brief (s1, s2…). */
    signalRef: text().notNull(),
    /** Signal code (C1…R1), for statistics without opening the brief. */
    code: text().notNull(),
    verdict: aiBriefVerdict().notNull(),
    source: aiBriefSource().notNull(),
    userId: uuid().references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.briefId, t.signalRef), index().on(t.organizationId, t.code)],
);
