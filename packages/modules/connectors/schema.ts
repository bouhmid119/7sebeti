/**
 * connectors: anti-corruption layer. Connections and their encrypted secrets, raw inbound events, fingerprints of external objects.
 */

import { organizationRef } from '@7sebeti/modules/identity';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../shared/columns';

export const connectorsSchema = pgSchema('connectors');

export const integrationProvider = connectorsSchema.enum('integration_provider', [
  'converty',
  'converty_sheets',
  'dropo',
  'cosmos',
  'meta',
]);

export const integrationConnection = connectorsSchema.table(
  'integration_connection',
  {
    id: id(),
    organizationId: organizationRef(),
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

export const inboundEventStatus = connectorsSchema.enum('inbound_event_status', [
  'received',
  'processed',
  'failed',
]);

/** Every webhook / pulled payload, stored verbatim before any processing so it can be replayed. */
export const inboundEvent = connectorsSchema.table(
  'inbound_event',
  {
    id: id(),
    organizationId: organizationRef(),
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
export const externalObjectState = connectorsSchema.table(
  'external_object_state',
  {
    organizationId: organizationRef(),
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
