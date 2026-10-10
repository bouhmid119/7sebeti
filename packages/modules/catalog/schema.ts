/**
 * catalog: products, bundles and links to external products.
 */

import { integrationProvider } from '@7sebeti/modules/connectors';
import { organizationRef } from '@7sebeti/modules/identity';
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
import { createdAt, id, money, updatedAt } from '../shared/columns';

export const catalogSchema = pgSchema('catalog');

export const product = catalogSchema.table(
  'product',
  {
    id: id(),
    organizationId: organizationRef(),
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

export const bundleComponent = catalogSchema.table(
  'bundle_component',
  {
    organizationId: organizationRef(),
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
export const externalProductLink = catalogSchema.table(
  'external_product_link',
  {
    id: id(),
    organizationId: organizationRef(),
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
