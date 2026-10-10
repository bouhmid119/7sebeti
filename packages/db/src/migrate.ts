/**
 * Production migration runner (no drizzle-kit needed at runtime).
 * Usage: node migrate.js — reads DATABASE_URL and MIGRATIONS_DIR (default ./migrations).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { databaseSsl } from './index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const ssl = databaseSsl();
const client = postgres(url, { max: 1, onnotice: () => {}, ...(ssl ? { ssl } : {}) });
try {
  await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_DIR ?? './migrations' });
  console.log('migrations applied');
} finally {
  await client.end();
}
