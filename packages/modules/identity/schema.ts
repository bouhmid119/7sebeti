/**
 * identity: organizations, users, memberships and Better Auth tables (session, account, verification, two_factor).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../shared/columns';

export const identitySchema = pgSchema('identity');

export const memberRole = identitySchema.enum('member_role', ['owner', 'admin', 'agent', 'viewer']);

export const organization = identitySchema.table('organization', {
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

/** Foreign key to the owning organization, for every organization-scoped table in any module. */
export const organizationRef = () =>
  uuid()
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

// Auth tables follow the Better Auth model (user, session, account, verification, two_factor).
// They are not organization-scoped and stay outside row-level security.

export const user = identitySchema.table('user', {
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

export const userRef = () =>
  uuid()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const session = identitySchema.table(
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

export const account = identitySchema.table(
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

export const verification = identitySchema.table(
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

export const twoFactor = identitySchema.table(
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

export const membership = identitySchema.table(
  'membership',
  {
    organizationId: organizationRef(),
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
