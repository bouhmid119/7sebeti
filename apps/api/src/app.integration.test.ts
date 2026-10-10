/**
 * End-to-end API checks against a real, migrated database (CI provides one).
 * Skipped when DATABASE_URL is not set.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, eq, schema } from '@7sebeti/db';
import { parseKeyring } from '@7sebeti/integrations';
import { afterAll, describe, expect, it } from 'vitest';
import fixture from '../../../packages/integrations/src/__fixtures__/converty-order.json';
import { createApp } from './app';
import { createAuth } from './lib/auth';
import { createDataKeyCache } from './lib/data-keys';
import type { Email } from './lib/mailer';
import { hashWebhookSecret } from './routes/webhooks';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:5173';

describe.skipIf(!url)('API', () => {
  const { db, client } = createDb(url ?? '', { max: 3 });
  const dataMasterKeyring = parseKeyring(`v1:${randomBytes(32).toString('base64')}`);
  const enqueued: object[] = [];
  const sent: Email[] = [];
  const logs: string[] = [];
  const app = createApp({
    db,
    auth: createAuth({
      db,
      secret: randomBytes(32).toString('base64'),
      apiUrl: 'http://localhost:4000',
      appUrl: APP_URL,
      production: false,
      sendEmail: async (email) => {
        sent.push(email);
      },
    }),
    dataKeyFor: createDataKeyCache(db, dataMasterKeyring),
    dataMasterKeyring,
    enqueueInTx: async (_tx, _queue, data) => enqueued.push(data),
    appUrl: APP_URL,
    version: 'test',
    log: (l) => logs.push(l),
  });

  const createdOrgs: string[] = [];
  const emails: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgs) await db.delete(schema.organization).where(eq(schema.organization.id, id));
    for (const email of emails) await db.delete(schema.user).where(eq(schema.user.email, email));
    await client.end();
  });

  async function signUp(): Promise<string> {
    const email = `${randomUUID()}@test.local`;
    emails.push(email);
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ email, password: 'motdepasse-solide', name: 'Test' }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    expect(cookie).toContain('session_token');
    expect(sent.at(-1)).toMatchObject({ to: email, subject: 'Confirmez votre adresse e-mail' });
    return cookie;
  }

  let cookie = '';
  let orgId = '';

  it('rejects anonymous access', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
  });

  it('signs up, creates an organization and lists it', async () => {
    cookie = await signUp();
    const me0 = await app.request('/api/me', { headers: { cookie } });
    expect(((await me0.json()) as { organizations: unknown[] }).organizations).toEqual([]);

    const slug = `boutique-${randomUUID().slice(0, 8)}`;
    const created = await app.request('/api/organizations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ name: 'Ma boutique', slug }),
    });
    expect(created.status).toBe(201);
    orgId = ((await created.json()) as { id: string }).id;
    createdOrgs.push(orgId);

    const me = await app.request('/api/me', { headers: { cookie } });
    const body = (await me.json()) as { organizations: { id: string; role: string }[] };
    expect(body.organizations).toEqual([expect.objectContaining({ id: orgId, role: 'owner' })]);
  });

  it('sends a password reset link by e-mail', async () => {
    const email = emails.at(-1) ?? '';
    const res = await app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ email, redirectTo: `${APP_URL}/nouveau-mot-de-passe` }),
    });
    expect(res.status).toBe(200);
    const mail = sent.at(-1);
    expect(mail).toMatchObject({ to: email, subject: 'Réinitialisation de votre mot de passe' });
    expect(mail?.text).toContain('/api/auth/reset-password/');
  });

  it('keeps organizations apart', async () => {
    const intruder = await signUp();
    const res = await app.request('/api/integrations', {
      headers: { cookie: intruder, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(403);
    const own = await app.request('/api/integrations', { headers: { cookie, 'x-organization-id': orgId } });
    expect(own.status).toBe(200);
  });

  it('stores a webhook once, encrypted, and skips identical replays', async () => {
    const secret = randomBytes(24).toString('base64url');
    const [connection] = await db
      .insert(schema.integrationConnection)
      .values({
        organizationId: orgId,
        provider: 'converty',
        label: 'Boutique',
        webhookSecretHash: hashWebhookSecret(secret),
      })
      .returning({ id: schema.integrationConnection.id });
    const path = `/webhooks/converty/${connection?.id}/${secret}`;
    const post = () =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fixture),
      });

    const first = (await (await post()).json()) as { ok: boolean; eventId?: string };
    expect(first.ok).toBe(true);
    expect(first.eventId).toBeDefined();
    const second = (await (await post()).json()) as { duplicate?: boolean };
    expect(second.duplicate).toBe(true);
    expect(enqueued).toHaveLength(1);

    const [event] = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.organizationId, orgId));
    expect(event?.payloadEncrypted).toBeDefined();
    expect(event?.payloadEncrypted).not.toContain('Client Test');
    expect(event?.payloadEncrypted).not.toContain('20 000 000');

    expect(
      (await app.request(`/webhooks/converty/${connection?.id}/wrong`, { method: 'POST', body: '{}' }))
        .status,
    ).toBe(404);
    expect(logs.join('\n')).not.toContain(secret);
  });
});
