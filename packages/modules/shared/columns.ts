/** Column helpers shared by every module schema (technical code, no business rule). */
import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid().primaryKey().defaultRandom();
export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Integer amount in minor units of the organization's currency (millimes for TND). */
export const money = () => bigint({ mode: 'number' });
