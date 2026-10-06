import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10 });
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type ExecuteSql = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * Run `fn` in one Drizzle transaction and also expose a raw executor bound to that same
 * transaction, so pg-boss can enqueue a job atomically with the rows that justify it
 * (no "row stored but job lost" window).
 */
export function inTransaction<T>(
  db: Db,
  fn: (tx: { db: Tx; executeSql: ExecuteSql }) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Drizzle's postgres-js session holds the transaction-scoped client.
    const client = (tx as unknown as { session?: { client?: postgres.TransactionSql } }).session?.client;
    if (!client?.unsafe) throw new Error('inTransaction: postgres-js transaction client not found');
    const executeSql: ExecuteSql = async (text, values = []) => ({
      rows: await client.unsafe(text, values as never[]),
    });
    return fn({ db: tx, executeSql });
  });
}
