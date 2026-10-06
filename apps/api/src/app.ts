import type { Db, Tx } from '@7sebeti/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestLogger } from './middleware/request-logger';
import { healthRoutes } from './routes/health';
import { webhookRoutes } from './routes/webhooks';

export interface AppDeps {
  db: Db;
  /**
   * Run `fn` in one transaction; `enqueue` inside it commits the job together with the
   * rows written through `db`, so a stored event can never miss its job.
   */
  withTransaction: <T>(
    fn: (tx: { db: Tx; enqueue: (queue: string, data: object) => Promise<unknown> }) => Promise<T>,
  ) => Promise<T>;
  appUrl: string;
  version: string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use('*', requestLogger());
  app.use('/api/*', cors({ origin: deps.appUrl, credentials: true }));
  app.route('/', healthRoutes(deps));
  app.route('/webhooks', webhookRoutes(deps));
  return app;
}
