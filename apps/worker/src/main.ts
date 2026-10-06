import { QUEUES } from '@7sebeti/contracts';
import { createDb, eq, schema } from '@7sebeti/db';
import { parseKeyring, unwrapDataKey } from '@7sebeti/integrations';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { ingestOrderEvent } from './jobs/ingest-order';

const env = z
  .object({ DATABASE_URL: z.string().url(), DATA_MASTER_KEY: z.string().min(1) })
  .parse(process.env);
const { db, client } = createDb(env.DATABASE_URL, { max: 5 });
const master = parseKeyring(env.DATA_MASTER_KEY);

const keys = new Map<string, Buffer>();
const dataKeyFor = async (organizationId: string) => {
  const cached = keys.get(organizationId);
  if (cached) return cached;
  const [org] = await db
    .select({ wrapped: schema.organization.dataKeyEncrypted })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw new Error(`organization ${organizationId} not found`);
  const key = unwrapDataKey(org.wrapped, master);
  keys.set(organizationId, key);
  return key;
};

const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await boss.createQueue(QUEUES.inboundEvent, { retryLimit: 5, retryBackoff: true });

await boss.work<{ eventId: string }>(QUEUES.inboundEvent, async (jobs) => {
  for (const job of jobs) {
    const result = await ingestOrderEvent({ db, dataKeyFor }, job.data.eventId);
    console.log(`[ingest] ${job.data.eventId} → ${result}`);
  }
});

console.log('7sebeti worker started');

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await client.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
