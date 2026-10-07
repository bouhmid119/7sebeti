import { QUEUES } from '@7sebeti/contracts';
import { createDb, rawExecutor, sql } from '@7sebeti/db';
import { parseKeyring } from '@7sebeti/integrations';
import { serve } from '@hono/node-server';
import { PgBoss } from 'pg-boss';
import { createApp } from './app';
import { loadEnv } from './env';
import { createAuth } from './lib/auth';
import { createDataKeyCache } from './lib/data-keys';

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
const dataMasterKeyring = parseKeyring(env.DATA_MASTER_KEY);

const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await boss.createQueue(QUEUES.inboundEvent);

const app = createApp({
  db,
  auth: createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    production: env.NODE_ENV === 'production',
  }),
  dataKeyFor: createDataKeyCache(db, dataMasterKeyring),
  dataMasterKeyring,
  enqueueInTx: async (tx, queue, data) => {
    // pg-boss tables are not granted to app_rw: leave the tenant role for this last statement.
    await tx.execute(sql`reset role`);
    return boss.send(queue, data, { db: { executeSql: rawExecutor(tx) } });
  },
  appUrl: env.APP_URL,
  version: env.APP_VERSION ?? env.RENDER_GIT_COMMIT ?? 'dev',
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`7sebeti API listening on :${info.port}`);
});

const shutdown = async () => {
  server.close();
  await boss.stop({ graceful: true });
  await client.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
