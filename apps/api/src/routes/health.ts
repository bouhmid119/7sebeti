import type { HealthResponse } from '@7sebeti/contracts';
import { sql } from '@7sebeti/db';
import { Hono } from 'hono';
import type { AppDeps } from '../app';

export function healthRoutes({ db, version }: AppDeps) {
  return new Hono().get('/health', async (c) => {
    let dbStatus: HealthResponse['db'] = 'ok';
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbStatus = 'down';
    }
    const body: HealthResponse = { status: 'ok', version, db: dbStatus };
    return c.json(body, dbStatus === 'ok' ? 200 : 503);
  });
}
