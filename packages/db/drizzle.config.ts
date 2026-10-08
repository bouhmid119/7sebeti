import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  casing: 'snake_case',
  // One Postgres schema per module; public holds nothing of ours.
  schemaFilter: ['identity', 'connectors', 'catalog', 'orders', 'assistant'], // = MODULE_SCHEMAS in src/index.ts
});
