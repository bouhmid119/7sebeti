import { type Db, eq, schema } from '@7sebeti/db';
import { type Keyring, unwrapDataKey } from '@7sebeti/integrations';

/**
 * Unwraps organization data keys on demand and keeps them in memory for a few minutes,
 * so hot paths (webhooks) do not decrypt the same key on every call.
 */
export function createDataKeyCache(db: Db, master: Keyring, ttlMs = 5 * 60_000) {
  const cache = new Map<string, { key: Buffer; expiresAt: number }>();
  return async function dataKeyFor(organizationId: string): Promise<Buffer> {
    const hit = cache.get(organizationId);
    if (hit && hit.expiresAt > Date.now()) return hit.key;
    // Read as the owner role: routing happens before a tenant context exists.
    const [org] = await db
      .select({ wrapped: schema.organization.dataKeyEncrypted })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) throw new Error(`organization ${organizationId} not found`);
    const key = unwrapDataKey(org.wrapped, master);
    cache.set(organizationId, { key, expiresAt: Date.now() + ttlMs });
    return key;
  };
}

export type DataKeyFor = ReturnType<typeof createDataKeyCache>;
