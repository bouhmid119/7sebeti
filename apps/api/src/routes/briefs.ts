import {
  BriefFeedbackRequest,
  type BriefHistoryItem,
  type BriefStatus,
  type BriefView,
} from '@7sebeti/contracts';
import { and, eq, schema, sql, type Tx, withTenant } from '@7sebeti/db';
import {
  type BriefContent,
  type BriefPayload,
  type Currency,
  dayInTimeZone,
  presentBrief,
  type Signal,
} from '@7sebeti/domain';
import { Hono } from 'hono';
import type { AppDeps, AppEnv, MemberRole } from '../app';
import { requireOrganization, requireRole, requireSession } from '../middleware/session';

/**
 * Brief « Actions à prendre » du commerçant (job de nuit du worker, docs/brief-ia.md).
 * Lecture pour le propriétaire, les admins et les associés (viewer) ; les agents n'y ont pas
 * accès, le brief juge aussi leurs résultats. Le retour sur une action est réservé aux
 * propriétaires et admins. Tout passe par withTenant : la RLS borne chaque requête à l'organisation.
 */

const READERS: readonly MemberRole[] = ['owner', 'admin', 'viewer'];
const WRITERS: readonly MemberRole[] = ['owner', 'admin'];
const HISTORY_DEFAULT = 14;
const HISTORY_MAX = 60;

/** AAAA-MM-JJ et un vrai jour du calendrier (le 2026-02-31 est refusé, pas reporté au 3 mars). */
const isDay = (s: string) => {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(s);
};
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
/** Référence d'un signal dans un brief : s1, s2… */
const signalIndex = (ref: string) => (/^s[1-9]\d{0,3}$/.test(ref) ? Number(ref.slice(1)) - 1 : -1);

const briefColumns = {
  id: schema.aiBrief.id,
  briefDate: schema.aiBrief.briefDate,
  status: schema.aiBrief.status,
  signals: schema.aiBrief.signals,
  payload: schema.aiBrief.payload,
  pseudonyms: schema.aiBrief.pseudonyms,
  content: schema.aiBrief.content,
  updatedAt: schema.aiBrief.updatedAt,
};

async function organizationSettings(tx: Tx, organizationId: string) {
  const [org] = await tx
    .select({ timezone: schema.organization.timezone, currency: schema.organization.currency })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  if (!org) throw new Error('organization not visible in its own tenant context');
  return { timezone: org.timezone, currency: org.currency as Currency };
}

/** Le brief d'un jour (ou d'aujourd'hui dans le fuseau de l'organisation), prêt à afficher. */
async function loadBrief(tx: Tx, organizationId: string, day: string | 'today'): Promise<BriefView | null> {
  const { timezone, currency } = await organizationSettings(tx, organizationId);
  const date = day === 'today' ? dayInTimeZone(new Date(), timezone) : day;
  const [row] = await tx
    .select(briefColumns)
    .from(schema.aiBrief)
    .where(eq(schema.aiBrief.briefDate, date))
    .limit(1);
  if (!row) return null;

  const feedback = new Map(
    (
      await tx
        .select({ signal: schema.aiBriefFeedback.signalRef, verdict: schema.aiBriefFeedback.verdict })
        .from(schema.aiBriefFeedback)
        .where(eq(schema.aiBriefFeedback.briefId, row.id))
    ).map((f) => [f.signal, f.verdict]),
  );
  const view = presentBrief(
    {
      status: row.status,
      signals: row.signals as Signal[],
      payload: row.payload as BriefPayload | null,
      pseudonyms: row.pseudonyms as Record<string, string> | null,
      content: row.content as BriefContent | null,
    },
    { asOf: row.briefDate, currency },
  );
  return {
    id: row.id,
    date: row.briefDate,
    status: row.status as BriefStatus,
    source: view.source,
    resume: view.resume,
    actions: view.actions.map((a) => ({ ...a, feedback: feedback.get(a.signal) ?? null })),
    otherSignals: view.otherSignals.map((s) => ({ ...s, feedback: feedback.get(s.signal) ?? null })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function briefRoutes({ db, auth }: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireSession(auth), requireOrganization(db), requireRole(READERS));

  /** Derniers briefs, du plus récent au plus ancien, sans leur contenu. */
  app.get('/', async (c) => {
    const asked = Number(c.req.query('limit') ?? HISTORY_DEFAULT);
    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, HISTORY_MAX) : HISTORY_DEFAULT;
    const rows = await withTenant(db, c.get('organizationId'), (tx) =>
      tx
        .select({
          id: schema.aiBrief.id,
          date: schema.aiBrief.briefDate,
          status: schema.aiBrief.status,
          signals: sql<number>`jsonb_array_length(${schema.aiBrief.signals})`.mapWith(Number),
        })
        .from(schema.aiBrief)
        .orderBy(sql`${schema.aiBrief.briefDate} desc`)
        .limit(limit),
    );
    return c.json(rows satisfies BriefHistoryItem[]);
  });

  app.get('/today', async (c) => {
    const view = await withTenant(db, c.get('organizationId'), (tx) =>
      loadBrief(tx, c.get('organizationId'), 'today'),
    );
    return view ? c.json(view) : c.json({ error: "Pas encore de brief aujourd'hui" }, 404);
  });

  app.get('/:date', async (c) => {
    const date = c.req.param('date');
    if (!isDay(date)) return c.json({ error: 'Date invalide (AAAA-MM-JJ)' }, 400);
    const view = await withTenant(db, c.get('organizationId'), (tx) =>
      loadBrief(tx, c.get('organizationId'), date),
    );
    return view ? c.json(view) : c.json({ error: 'Pas de brief ce jour-là' }, 404);
  });

  /** Retour du commerçant sur un signal : fait, pas pertinent, ou null pour l'effacer. */
  app.put('/:id/signals/:signal/feedback', requireRole(WRITERS), async (c) => {
    const id = c.req.param('id');
    const ref = c.req.param('signal');
    const parsed = BriefFeedbackRequest.safeParse(await c.req.json().catch(() => null));
    if (!isUuid(id) || signalIndex(ref) < 0 || !parsed.success) {
      return c.json({ error: 'Retour invalide' }, 400);
    }
    const { feedback } = parsed.data;
    const organizationId = c.get('organizationId');
    const userId = c.get('userId');

    const outcome = await withTenant(db, organizationId, async (tx) => {
      const [brief] = await tx
        .select({
          status: schema.aiBrief.status,
          signals: schema.aiBrief.signals,
          content: schema.aiBrief.content,
        })
        .from(schema.aiBrief)
        .where(eq(schema.aiBrief.id, id))
        .limit(1);
      if (!brief) return 'no-brief' as const;
      const signal = (brief.signals as Signal[])[signalIndex(ref)];
      if (!signal) return 'no-signal' as const;

      const target = and(eq(schema.aiBriefFeedback.briefId, id), eq(schema.aiBriefFeedback.signalRef, ref));
      if (feedback === null) {
        await tx.delete(schema.aiBriefFeedback).where(target);
        return 'ok' as const;
      }
      const source = brief.status === 'ready' && brief.content ? 'ai' : 'rules';
      await tx
        .insert(schema.aiBriefFeedback)
        .values({
          organizationId,
          briefId: id,
          signalRef: ref,
          code: signal.id,
          verdict: feedback,
          source,
          userId,
        })
        .onConflictDoUpdate({
          target: [schema.aiBriefFeedback.briefId, schema.aiBriefFeedback.signalRef],
          set: { verdict: feedback, source, userId, updatedAt: new Date() },
        });
      return 'ok' as const;
    });

    if (outcome === 'no-brief') return c.json({ error: 'Brief introuvable' }, 404);
    if (outcome === 'no-signal') return c.json({ error: 'Signal introuvable' }, 404);
    return c.json({ signal: ref, feedback });
  });

  return app;
}
