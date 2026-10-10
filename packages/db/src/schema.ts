/**
 * Aggregated schema for the Drizzle client and migrations. Each table belongs to exactly one
 * module and lives in that module's Postgres schema (identity, connectors, catalog, orders,
 * assistant). Money columns are integers in minor units of the organization's currency.
 */
export * from '@7sebeti/modules/assistant/schema';
export * from '@7sebeti/modules/catalog/schema';
export * from '@7sebeti/modules/connectors/schema';
export * from '@7sebeti/modules/identity/schema';
export * from '@7sebeti/modules/orders/schema';
