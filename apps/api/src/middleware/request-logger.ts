import type { MiddlewareHandler } from 'hono';

/**
 * Access log that records the matched route pattern (`/webhooks/converty/:connectionId/:secret`),
 * never the concrete path: webhook URLs carry a secret, so raw paths must not reach logs.
 */
export function requestLogger(log: (line: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    log(`${c.req.method} ${c.req.routePath} ${c.res.status} ${ms}ms`);
  };
}
