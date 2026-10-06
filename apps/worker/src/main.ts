import { QUEUES } from '@7sebeti/contracts';
import { createDb } from '@7sebeti/db';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { ingestOrderEvent } from './jobs/ingest-order';

const INBOUND_EVENT_QUEUE = QUEUES.inboundEvent;

const env = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);
const { db, client } = createDb(env.DATABASE_URL, { max: 5 });

const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await boss.createQueue(INBOUND_EVENT_QUEUE, { retryLimit: 5, retryBackoff: true });

await boss.work<{ eventId: string }>(INBOUND_EVENT_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const result = await ingestOrderEvent(db, job.data.eventId);
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
