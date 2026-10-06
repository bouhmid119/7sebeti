import type { Db } from '@7sebeti/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthRoutes } from './routes/health';
import { webhookRoutes } from './routes/webhooks';

export interface AppDeps {
  db: Db;
  /** Enqueue a job for apps/worker. */
  enqueue: (queue: string, data: object) => Promise<unknown>;
  appUrl: string;
  version: string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use('*', logger());
  app.use('/api/*', cors({ origin: deps.appUrl, credentials: true }));
  app.route('/', healthRoutes(deps));
  app.route('/webhooks', webhookRoutes(deps));
  return app;
}
