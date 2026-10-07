import type { Db, schema, Tx } from '@7sebeti/db';
import type { Keyring } from '@7sebeti/integrations';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Auth } from './lib/auth';
import type { DataKeyFor } from './lib/data-keys';
import { requestLogger } from './middleware/request-logger';
import { briefRoutes } from './routes/briefs';
import { healthRoutes } from './routes/health';
import { organizationRoutes } from './routes/organizations';
import { webhookRoutes } from './routes/webhooks';

export interface AppDeps {
  db: Db;
  auth: Auth;
  /** Unwrapped data key of an organization (cached). */
  dataKeyFor: DataKeyFor;
  /** Keyring that wraps organization data keys, used when an organization is created. */
  dataMasterKeyring: Keyring;
  /**
   * Enqueue a job inside `tx`: the job commits or rolls back with the transaction.
   * Must be the last statement of a tenant transaction (it leaves the app_rw role).
   */
  enqueueInTx: (tx: Tx, queue: string, data: object) => Promise<unknown>;
  appUrl: string;
  version: string;
  log?: (line: string) => void;
}

export type MemberRole = (typeof schema.memberRole.enumValues)[number];

export type AppEnv = {
  Variables: {
    userId: string;
    organizationId: string;
    role: MemberRole;
  };
};

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requestLogger(deps.log));
  app.use('/api/*', cors({ origin: deps.appUrl, credentials: true }));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));
  app.route('/', healthRoutes(deps));
  app.route('/api', organizationRoutes(deps));
  app.route('/api/briefs', briefRoutes(deps));
  app.route('/webhooks', webhookRoutes(deps));
  return app;
}
