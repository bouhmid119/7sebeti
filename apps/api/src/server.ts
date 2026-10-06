import { createDb } from '@7sebeti/db';
import { serve } from '@hono/node-server';
import { PgBoss } from 'pg-boss';
import { createApp } from './app';
import { loadEnv } from './env';
import { INBOUND_EVENT_QUEUE } from './routes/webhooks';

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);

const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await boss.createQueue(INBOUND_EVENT_QUEUE);

const app = createApp({
  db,
  enqueue: (queue, data) => boss.send(queue, data),
  appUrl: env.APP_URL,
  version: env.RENDER_GIT_COMMIT ?? 'dev',
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
