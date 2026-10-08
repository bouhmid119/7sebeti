import { and, type Db, eq, inArray, isNull, schema, sql, withTenant } from '@7sebeti/db';
import {
  addDays,
  type BriefPayload,
  type Currency,
  dayInTimeZone,
  type OrderStatusCategory,
  type Signal,
  type SignalInput,
  toGovernorate,
} from '@7sebeti/domain';
import type { BriefRow, BriefStatus, BriefStore } from './ai-brief';

const { aiBrief, externalProductLink, order, orderLine, organization, product } = schema;

/** Orders older than this cannot move any signal (the longest window is a month). */
const HISTORY_DAYS = 45;

type AiBriefRecord = typeof aiBrief.$inferSelect;

function toRow(r: AiBriefRecord): BriefRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    briefDate: r.briefDate,
    status: r.status,
    batchId: r.batchId,
    attempts: r.attempts,
    signals: r.signals as Signal[],
    payload: r.payload as BriefPayload | null,
    pseudonyms: r.pseudonyms as Record<string, string> | null,
  };
}

export function createBriefStore(db: Db): BriefStore {
  return {
    async listOrganizations() {
      const rows = await db
        .select({ id: organization.id, timezone: organization.timezone, currency: organization.currency })
        .from(organization);
      return rows.map((r) => ({ ...r, currency: r.currency as Currency }));
    },

    async listBriefRefs(statuses, sinceDay) {
      return db
        .select({
          id: aiBrief.id,
          organizationId: aiBrief.organizationId,
          briefDate: aiBrief.briefDate,
          status: aiBrief.status,
          batchId: aiBrief.batchId,
          attempts: aiBrief.attempts,
        })
        .from(aiBrief)
        .where(and(inArray(aiBrief.status, [...statuses]), sql`${aiBrief.briefDate} >= ${sinceDay}`));
    },

    loadSignalInput(org, asOf) {
      return withTenant(db, org.id, async (tx): Promise<SignalInput> => {
        const products = await tx
          .select({
            id: product.id,
            name: product.name,
            sellingPrice: product.sellingPrice,
            costPrice: product.costPrice,
            packagingPerUnit: product.packagingPerUnit,
            packagingPerOrder: product.packagingPerOrder,
            restockLeadTimeDays: product.restockLeadTimeDays,
          })
          .from(product)
          .where(isNull(product.archivedAt));

        // One extra day so the cut-off in the organization's timezone is never short.
        const since = new Date(`${addDays(asOf, -HISTORY_DAYS - 1)}T00:00:00Z`).toISOString();
        const fromDay = addDays(asOf, -HISTORY_DAYS);
        const lines = await tx
          .select({
            createdAt: order.sourceCreatedAt,
            category: order.category,
            agent: order.confirmingAgent,
            city: order.city,
            quantity: orderLine.quantity,
            productId: externalProductLink.productId,
            unitsPerLine: externalProductLink.quantity,
          })
          .from(order)
          .innerJoin(orderLine, and(eq(orderLine.orderId, order.id), eq(orderLine.isUpsell, false)))
          .innerJoin(
            externalProductLink,
            and(
              eq(externalProductLink.organizationId, order.organizationId),
              eq(externalProductLink.provider, order.provider),
              eq(externalProductLink.externalKey, orderLine.externalProductKey),
            ),
          )
          .where(
            and(
              eq(order.organizationId, org.id),
              eq(order.isTest, false),
              sql`${order.category} is not null`,
              sql`${externalProductLink.productId} is not null`,
              sql`${order.sourceCreatedAt} >= ${since}`,
            ),
          );

        return {
          asOf,
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            sellingPriceMinor: p.sellingPrice,
            unitCostMinor: p.costPrice,
            // Contribution is per order of one unit, like the selling price.
            packagingPerOrderMinor: p.packagingPerOrder + p.packagingPerUnit,
            // Not stored by the core yet: carrier fees, stock and per-product targets.
            deliveryCostMinor: 0,
            returnCostMinor: 0,
            stockQty: null,
            restockLeadTimeDays: p.restockLeadTimeDays,
            targetConfirmRatePct: null,
          })),
          orders: lines
            .map((l) => ({
              date: dayInTimeZone(l.createdAt, org.timezone),
              productId: l.productId as string,
              quantity: l.quantity * l.unitsPerLine,
              status: l.category as OrderStatusCategory,
              agent: l.agent,
              governorate: toGovernorate(l.city),
              carrier: null,
            }))
            .filter((o) => o.date >= fromDay),
          // Meta Ads is not ingested yet: the ad signals (P1 to P5) stay silent.
          adDays: [],
        };
      });
    },

    findBrief(organizationId, briefDate) {
      return withTenant(db, organizationId, async (tx) => {
        const [r] = await tx.select().from(aiBrief).where(eq(aiBrief.briefDate, briefDate)).limit(1);
        return r ? toRow(r) : null;
      });
    },

    getBrief(organizationId, id) {
      return withTenant(db, organizationId, async (tx) => {
        const [r] = await tx.select().from(aiBrief).where(eq(aiBrief.id, id)).limit(1);
        return r ? toRow(r) : null;
      });
    },

    insertBrief(brief) {
      return withTenant(db, brief.organizationId, async (tx) => {
        const [created] = await tx.insert(aiBrief).values(brief).onConflictDoNothing().returning();
        if (created) return toRow(created);
        const [existing] = await tx
          .select()
          .from(aiBrief)
          .where(
            and(eq(aiBrief.organizationId, brief.organizationId), eq(aiBrief.briefDate, brief.briefDate)),
          )
          .limit(1);
        if (!existing) throw new Error(`ai_brief ${brief.organizationId} ${brief.briefDate} not found`);
        return toRow(existing);
      });
    },

    updateBrief(organizationId, id, from, patch) {
      return withTenant(db, organizationId, async (tx) => {
        const updated = await tx
          .update(aiBrief)
          .set(patch)
          .where(and(eq(aiBrief.id, id), inArray(aiBrief.status, [...(from as BriefStatus[])])))
          .returning({ id: aiBrief.id });
        return updated.length > 0;
      });
    },
  };
}
