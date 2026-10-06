import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requestLogger } from './request-logger';

describe('requestLogger', () => {
  it('logs the route pattern, never the secret in the URL', async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use(
      '*',
      requestLogger((l) => lines.push(l)),
    );
    app.post('/webhooks/converty/:connectionId/:secret', (c) => c.json({ ok: true }));

    const res = await app.request('/webhooks/converty/abc/super-secret-value', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/webhooks/converty/:connectionId/:secret 200');
    expect(lines.join('\n')).not.toContain('super-secret-value');
    expect(lines.join('\n')).not.toContain('abc');
  });
});
