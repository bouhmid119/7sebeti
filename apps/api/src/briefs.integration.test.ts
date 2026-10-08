/**
 * Brief « Actions à prendre » through the API, against a real, migrated database.
 * Skipped when DATABASE_URL is not set.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { BriefHistoryItem, BriefView } from '@7sebeti/contracts';
import { and, createDb, eq, schema, sql, withTenant } from '@7sebeti/db';
import { addDays, dayInTimeZone, prepareBrief, type Signal } from '@7sebeti/domain';
import { parseKeyring } from '@7sebeti/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createAuth } from './lib/auth';
import { createDataKeyCache } from './lib/data-keys';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:5173';
/** Fixed clock: « today » must not change if the suite runs across midnight in Tunis. */
const NOW = new Date('2026-10-07T10:00:00Z');

const SIGNALS: Signal[] = [
  {
    id: 'C1',
    domain: 'confirmation',
    title: 'Leads de la veille non traités',
    subject: {},
    figures: { commandes: 14, parStatut: { pending: 9, no_answer: 5 }, chiffreAffairesEnJeuMinor: 966_000 },
    threshold: 'au moins 5',
    stakeMinor: 966_000,
    link: '/confirmation?jour=hier&statut=non-traite',
  },
  {
    id: 'C3',
    domain: 'confirmation',
    title: 'Agent sous ses objectifs',
    subject: { agent: 'Yasmine' },
    figures: { tauxPct: 41.2, confirmeesParJour: 6.5 },
    threshold: '60 % et 12 par jour',
    stakeMinor: 0,
    link: '/agents/Yasmine',
  },
  {
    id: 'L2',
    domain: 'livraison',
    title: 'Zone faible',
    subject: { governorate: 'Kasserine' },
    figures: { tauxPct: 48, moyennePct: 71.3, colis: 40, jours: 30 },
    threshold: '15 points sous la moyenne',
    stakeMinor: 0,
    link: '/livraison?governorate=Kasserine',
  },
];

describe.skipIf(!url)('brief API', () => {
  const { db, client } = createDb(url ?? '', { max: 3 });
  const dataMasterKeyring = parseKeyring(`v1:${randomBytes(32).toString('base64')}`);
  const app = createApp({
    db,
    auth: createAuth({
      db,
      secret: randomBytes(32).toString('base64'),
      apiUrl: 'http://localhost:4000',
      appUrl: APP_URL,
      production: false,
    }),
    dataKeyFor: createDataKeyCache(db, dataMasterKeyring),
    dataMasterKeyring,
    enqueueInTx: async () => undefined,
    appUrl: APP_URL,
    version: 'test',
    now: () => NOW,
  });

  const orgs: string[] = [];
  const emails: string[] = [];
  const today = dayInTimeZone(NOW, 'Africa/Tunis');
  const yesterday = addDays(today, -1);
  let owner = '';
  let orgId = '';
  let otherOrgId = '';
  let todayId = '';
  let yesterdayId = '';
  let otherBriefId = '';

  async function signUp(): Promise<{ cookie: string; userId: string }> {
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
    const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
    return { cookie, userId: u?.id ?? '' };
  }

  async function createOrganization(cookie: string): Promise<string> {
    const res = await app.request('/api/organizations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ name: 'Boutique', slug: `boutique-${randomUUID().slice(0, 8)}` }),
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { id: string }).id;
    orgs.push(id);
    return id;
  }

  async function memberWithRole(role: 'agent' | 'viewer'): Promise<string> {
    const { cookie, userId } = await signUp();
    await db.insert(schema.membership).values({ organizationId: orgId, userId, role });
    return cookie;
  }

  const get = (path: string, cookie: string, org = orgId) =>
    app.request(path, { headers: { cookie, 'x-organization-id': org } });
  const put = (path: string, cookie: string, body: unknown, org = orgId) =>
    app.request(path, {
      method: 'PUT',
      headers: { cookie, 'x-organization-id': org, 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    owner = (await signUp()).cookie;
    orgId = await createOrganization(owner);
    otherOrgId = await createOrganization((await signUp()).cookie);

    const prepared = prepareBrief(SIGNALS, { asOf: today, currency: 'TND' });
    // As the table owner (the worker writes briefs), seed one brief per case.
    const rows = await db
      .insert(schema.aiBrief)
      .values([
        {
          organizationId: orgId,
          briefDate: today,
          status: 'ready',
          signals: SIGNALS,
          payload: prepared.payload,
          pseudonyms: prepared.pseudonyms,
          content: {
            resume: "Rappelez d'abord les leads d'hier.",
            actions: [
              {
                signal: 's1',
                code: 'C1',
                titre: "14 leads d'hier à rappeler",
                constat: '966,000 DT de commandes en attente.',
                action: 'Rappelez-les avant midi.',
                lien: '/confirmation?jour=hier&statut=non-traite',
              },
            ],
          },
          warnings: ['chiffre absent des données : 3'],
        },
        {
          organizationId: orgId,
          briefDate: yesterday,
          status: 'signals_only',
          signals: SIGNALS,
          payload: prepared.payload,
          pseudonyms: prepared.pseudonyms,
        },
        { organizationId: orgId, briefDate: addDays(today, -2), status: 'empty', signals: [] },
        { organizationId: otherOrgId, briefDate: today, status: 'signals_only', signals: SIGNALS },
      ])
      .returning({ id: schema.aiBrief.id });
    [todayId = '', yesterdayId = '', , otherBriefId = ''] = rows.map((r) => r.id);
  });

  afterAll(async () => {
    for (const id of orgs) await db.delete(schema.organization).where(eq(schema.organization.id, id));
    for (const email of emails) await db.delete(schema.user).where(eq(schema.user.email, email));
    await client.end();
  });

  it('demande une session, une organisation et un rôle autorisé', async () => {
    expect((await app.request('/api/briefs/today')).status).toBe(401);
    expect((await app.request('/api/briefs/today', { headers: { cookie: owner } })).status).toBe(400);
    const intruder = (await signUp()).cookie;
    expect((await get('/api/briefs/today', intruder)).status).toBe(403);
    expect((await get('/api/briefs/today', await memberWithRole('agent'))).status).toBe(403);
  });

  it("montre le brief du jour rédigé par Claude, puis les autres signaux, sans rien d'interne", async () => {
    const res = await get('/api/briefs/today', owner);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BriefView;
    expect(view).toMatchObject({ id: todayId, date: today, status: 'ready', source: 'ai' });
    expect(view.actions).toEqual([expect.objectContaining({ signal: 's1', code: 'C1', feedback: null })]);
    expect(view.otherSignals.map((s) => s.signal)).toEqual(['s2', 's3']);
    // The agent's real name is restored on the card, never its pseudonym.
    expect(view.otherSignals.find((s) => s.code === 'C3')?.sujet.agent).toBe('Yasmine');
    const raw = JSON.stringify(view);
    for (const hidden of ['pseudonyms', 'payload', 'warnings', 'chiffre absent', 'Agent A']) {
      expect(raw).not.toContain(hidden);
    }
  });

  it("rédige avec les phrases fixes quand l'IA n'a rien rendu", async () => {
    const view = (await (await get(`/api/briefs/${yesterday}`, owner)).json()) as BriefView;
    expect(view).toMatchObject({ id: yesterdayId, status: 'signals_only', source: 'rules' });
    expect(view.actions.map((a) => a.titre)).toEqual([
      "Leads d'hier non traités",
      'Yasmine sous ses objectifs',
      'Zone faible : Kasserine',
    ]);
    expect(view.otherSignals).toEqual([]);
  });

  it('distingue un jour sans signal, un jour sans brief et une date invalide', async () => {
    const empty = (await (await get(`/api/briefs/${addDays(today, -2)}`, owner)).json()) as BriefView;
    expect(empty).toMatchObject({ status: 'empty', source: null, resume: null, actions: [] });
    expect((await get(`/api/briefs/${addDays(today, -30)}`, owner)).status).toBe(404);
    expect((await get('/api/briefs/2026-13-45', owner)).status).toBe(400);
    expect((await get('/api/briefs/2026-02-31', owner)).status).toBe(400);
    expect((await get('/api/briefs/0000-01-01', owner)).status).toBe(400);
  });

  it("liste l'historique du plus récent au plus ancien", async () => {
    const list = (await (await get('/api/briefs?limit=2', owner)).json()) as BriefHistoryItem[];
    expect(list).toEqual([
      { id: todayId, date: today, status: 'ready', signals: 3 },
      { id: yesterdayId, date: yesterday, status: 'signals_only', signals: 3 },
    ]);
  });

  it('enregistre, remplace et efface le retour sur un signal', async () => {
    const path = `/api/briefs/${todayId}/signals/s1/feedback`;
    expect((await put(path, owner, { feedback: 'done' })).status).toBe(200);
    expect(
      (await put(`/api/briefs/${todayId}/signals/s2/feedback`, owner, { feedback: 'not_relevant' })).status,
    ).toBe(200);
    let view = (await (await get('/api/briefs/today', owner)).json()) as BriefView;
    expect(view.actions[0]?.feedback).toBe('done');
    expect(view.otherSignals.find((s) => s.signal === 's2')?.feedback).toBe('not_relevant');

    expect((await put(path, owner, { feedback: 'not_relevant' })).status).toBe(200);
    // What the merchant saw: Claude's text for s1, the bare card for s2, phrases fixes on another day.
    expect(
      (await put(`/api/briefs/${yesterdayId}/signals/s1/feedback`, owner, { feedback: 'done' })).status,
    ).toBe(200);
    const rows = await db
      .select()
      .from(schema.aiBriefFeedback)
      .where(eq(schema.aiBriefFeedback.organizationId, orgId));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.briefId === todayId && r.signalRef === 's1')).toMatchObject({
      code: 'C1',
      verdict: 'not_relevant',
      shownAs: 'ai',
    });
    expect(rows.find((r) => r.briefId === todayId && r.signalRef === 's2')).toMatchObject({
      code: 'C3',
      shownAs: 'signal',
    });
    expect(rows.find((r) => r.briefId === yesterdayId)).toMatchObject({ code: 'C1', shownAs: 'rules' });

    // The front says what it showed (the brief may have turned « ready » since): that wins.
    expect((await put(path, owner, { feedback: 'done', shownAs: 'rules' })).status).toBe(200);
    const [kept] = await db
      .select({ shownAs: schema.aiBriefFeedback.shownAs })
      .from(schema.aiBriefFeedback)
      .where(and(eq(schema.aiBriefFeedback.briefId, todayId), eq(schema.aiBriefFeedback.signalRef, 's1')));
    expect(kept?.shownAs).toBe('rules');

    expect((await put(path, owner, { feedback: null })).status).toBe(200);
    view = (await (await get('/api/briefs/today', owner)).json()) as BriefView;
    expect(view.actions[0]?.feedback).toBeNull();
  });

  it('refuse un retour mal formé, sur un signal ou un brief inconnu, ou venant d’un associé', async () => {
    expect(
      (await put(`/api/briefs/${todayId}/signals/s2/feedback`, owner, { feedback: 'peut-être' })).status,
    ).toBe(400);
    expect(
      (await put(`/api/briefs/${todayId}/signals/s2/feedback`, owner, { feedback: 'done', shownAs: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await put(`/api/briefs/${todayId}/signals/x2/feedback`, owner, { feedback: 'done' })).status,
    ).toBe(400);
    expect(
      (await put(`/api/briefs/${todayId}/signals/s9/feedback`, owner, { feedback: 'done' })).status,
    ).toBe(404);
    expect(
      (await put(`/api/briefs/${otherBriefId}/signals/s1/feedback`, owner, { feedback: 'done' })).status,
    ).toBe(404);
    const viewer = await memberWithRole('viewer');
    expect((await get('/api/briefs/today', viewer)).status).toBe(200);
    expect(
      (await put(`/api/briefs/${todayId}/signals/s1/feedback`, viewer, { feedback: 'done' })).status,
    ).toBe(403);
  });

  it("empêche en base un retour qui pointe vers le brief d'une autre organisation", async () => {
    const attempt = withTenant(db, orgId, (tx) =>
      tx.insert(schema.aiBriefFeedback).values({
        organizationId: orgId,
        briefId: otherBriefId,
        signalRef: 's1',
        code: 'C1',
        verdict: 'done',
        shownAs: 'rules',
      }),
    );
    await expect(attempt).rejects.toThrow();
    const leaked = await db.execute(sql`select 1 from ai_brief_feedback where brief_id = ${otherBriefId}`);
    expect(leaked).toHaveLength(0);
  });
});
