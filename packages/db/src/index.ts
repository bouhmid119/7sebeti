import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
export { schema };

/**
 * TLS settings for managed PostgreSQL. OVHcloud signs its database certificates with its own
 * CA: download it from the console and point DATABASE_CA_CERT_FILE at it, and leave sslmode
 * out of DATABASE_URL (the pg driver used by pg-boss would let the URL override this).
 * Unset (local, CI): no TLS options.
 */
export function databaseSsl(
  env: NodeJS.ProcessEnv = process.env,
): { ca: string; rejectUnauthorized: true } | undefined {
  const file = env.DATABASE_CA_CERT_FILE;
  return file ? { ca: readFileSync(file, 'utf8'), rejectUnauthorized: true } : undefined;
}

export function createDb(url: string, options: { max?: number } = {}) {
  const ssl = databaseSsl();
  const client = postgres(url, { max: options.max ?? 10, ...(ssl ? { ssl } : {}) });
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type ExecuteSql = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * Raw SQL executor bound to a Drizzle transaction, for libraries that take their own SQL
 * (pg-boss). Enqueuing through it commits the job atomically with the rows that justify it.
 */
export function rawExecutor(tx: Tx): ExecuteSql {
  // Drizzle's postgres-js session holds the transaction-scoped client.
  const client = (tx as unknown as { session?: { client?: postgres.TransactionSql } }).session?.client;
  if (!client?.unsafe) throw new Error('rawExecutor: postgres-js transaction client not found');
  return async (text, values = []) => ({ rows: await client.unsafe(text, values as never[]) });
}

/** Tables deliberately outside row-level security (auth is per user, not per organization). */
export const RLS_EXEMPT_TABLES = ['user', 'session', 'account', 'verification', 'two_factor'] as const;

/**
 * Run `fn` as the restricted `app_rw` role with `app.org_id` set for this transaction only.
 * Every query inside only sees, and can only write, that organization's rows.
 */
export function withTenant<T>(db: Db, organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_rw`);
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    return fn(tx);
  });
}

/** Like withTenant, before an organization is chosen: only the user's own memberships are visible. */
export function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_rw`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
