import { QUEUES } from '@7sebeti/contracts';
import { createDb, databaseSsl, eq, schema } from '@7sebeti/db';
import { BRIEF_OUTPUT_SCHEMA, BRIEF_SYSTEM_PROMPT } from '@7sebeti/domain';
import { createClaudeJsonWriter, parseKeyring, unwrapDataKey } from '@7sebeti/integrations';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { type BriefDeps, collectDailyBriefs, fallbackDailyBriefs, prepareDailyBriefs } from './jobs/ai-brief';
import { createBriefStore } from './jobs/ai-brief-store';
import { ingestOrderEvent } from './jobs/ingest-order';

// An empty line in .env counts as unset.
const optional = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    DATA_MASTER_KEY: z.string().min(1),
    /** Without it the nightly brief keeps the raw signals (no model call). */
    ANTHROPIC_API_KEY: optional,
    AI_BRIEF_ENABLED: z.enum(['true', 'false', '']).default('true'),
    /** Defaults to the integration's model; switches model without a code change. */
    AI_BRIEF_MODEL: optional,
  })
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

const boss = new PgBoss({ connectionString: env.DATABASE_URL, ssl: databaseSsl() });
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await boss.createQueue(QUEUES.inboundEvent, { retryLimit: 5, retryBackoff: true });

await boss.work<{ eventId: string }>(QUEUES.inboundEvent, async (jobs) => {
  for (const job of jobs) {
    const result = await ingestOrderEvent({ db, dataKeyFor }, job.data.eventId);
    console.log(`[ingest] ${job.data.eventId} → ${result}`);
  }
});

// ─── Nightly AI brief ───────────────────────────────────────────────────────

const briefDeps: BriefDeps = {
  store: createBriefStore(db),
  writer:
    env.ANTHROPIC_API_KEY && env.AI_BRIEF_ENABLED !== 'false'
      ? createClaudeJsonWriter({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.AI_BRIEF_MODEL,
          system: BRIEF_SYSTEM_PROMPT,
          schema: BRIEF_OUTPUT_SCHEMA,
        })
      : null,
  now: () => new Date(),
  log: (message) => console.error(message),
};
if (!briefDeps.writer) console.log('[brief] AI off: briefs keep the raw signals');

const briefJobs = [
  // Times in Tunis: signals after the evening's orders are in, brief ready before the merchant wakes up.
  { queue: QUEUES.aiBriefPrepare, cron: '0 3 * * *', run: prepareDailyBriefs },
  { queue: QUEUES.aiBriefCollect, cron: '*/10 * * * *', run: collectDailyBriefs },
  { queue: QUEUES.aiBriefFallback, cron: '0 7 * * *', run: fallbackDailyBriefs },
];
for (const { queue, cron, run } of briefJobs) {
  // exclusive: a slow run is never doubled by the next tick.
  await boss.createQueue(queue, { policy: 'exclusive', retryLimit: 1, retryBackoff: true });
  await boss.schedule(queue, cron, null, { tz: 'Africa/Tunis', missed: 'once' });
  await boss.work(queue, async () => {
    try {
      console.log(`[brief] ${queue}`, JSON.stringify(await run(briefDeps)));
    } catch (err) {
      console.error(`[brief] ${queue} failed:`, err instanceof Error ? err.message : err);
      throw err;
    }
  });
}

console.log('7sebeti worker started');

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await client.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
