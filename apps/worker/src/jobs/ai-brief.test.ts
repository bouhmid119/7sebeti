import { addDays, type BriefPayload, type SignalInput, type SignalOrder } from '@7sebeti/domain';
import type { ClaudeJsonResult, ClaudeJsonWriter, ClaudeTask } from '@7sebeti/integrations';
import { describe, expect, it } from 'vitest';
import {
  type BriefDeps,
  type BriefOrganization,
  type BriefRow,
  type BriefStore,
  collectDailyBriefs,
  fallbackDailyBriefs,
  prepareDailyBriefs,
} from './ai-brief';

// 03:00 in Tunis (UTC+1): the brief of 2026-10-20.
const NOW = new Date('2026-10-20T02:00:00Z');
const DAY = '2026-10-20';

const BUSY: BriefOrganization = { id: 'org-busy', timezone: 'Africa/Tunis', currency: 'TND' };
const QUIET: BriefOrganization = { id: 'org-quiet', timezone: 'Africa/Tunis', currency: 'TND' };

function orders(n: number, daysAgo: number, over: Partial<SignalOrder>): SignalOrder[] {
  return Array.from({ length: n }, () => ({
    date: addDays(DAY, -daysAgo),
    productId: 'p1',
    quantity: 1,
    status: 'confirmed' as const,
    agent: null,
    governorate: null,
    carrier: null,
    ...over,
  }));
}

/** Six untreated leads yesterday (C1) and an agent confirming a third of her leads (C3). */
function busyInput(asOf: string): SignalInput {
  return {
    asOf,
    products: [
      {
        id: 'p1',
        name: 'Brosse lissante',
        sellingPriceMinor: 69_000,
        unitCostMinor: 18_000,
        packagingPerOrderMinor: 1_500,
        deliveryCostMinor: 0,
        returnCostMinor: 0,
        stockQty: null,
        restockLeadTimeDays: null,
        targetConfirmRatePct: null,
      },
    ],
    orders: [
      ...orders(6, 1, { status: 'pending' }),
      ...orders(10, 3, { agent: 'Yasmine', status: 'confirmed' }),
      ...orders(20, 3, { agent: 'Yasmine', status: 'refused' }),
    ],
    adDays: [],
  };
}

function memoryStore(orgs: BriefOrganization[]) {
  const rows: BriefRow[] = [];
  let seq = 0;
  const store: BriefStore = {
    async listOrganizations() {
      return orgs;
    },
    async listBriefRefs(statuses, sinceDay) {
      return rows
        .filter((r) => statuses.includes(r.status) && r.briefDate >= sinceDay)
        .map((r) => ({ ...r }));
    },
    async loadSignalInput(org, asOf) {
      return org.id === BUSY.id ? busyInput(asOf) : { asOf, products: [], orders: [], adDays: [] };
    },
    async findBrief(organizationId, briefDate) {
      return rows.find((r) => r.organizationId === organizationId && r.briefDate === briefDate) ?? null;
    },
    async getBrief(organizationId, id) {
      return rows.find((r) => r.organizationId === organizationId && r.id === id) ?? null;
    },
    async insertBrief(brief) {
      const existing = await store.findBrief(brief.organizationId, brief.briefDate);
      if (existing) return existing;
      const row: BriefRow & Record<string, unknown> = {
        ...brief,
        id: `brief-${++seq}`,
        batchId: null,
        attempts: 0,
      };
      rows.push(row);
      return row;
    },
    async updateBrief(organizationId, id, from, patch) {
      const row = rows.find((r) => r.organizationId === organizationId && r.id === id);
      if (!row || !from.includes(row.status)) return false;
      Object.assign(row, patch);
      return true;
    },
  };
  return { store, rows: rows as Array<BriefRow & Record<string, unknown>> };
}

/** Answers every task with an action on the agent signal, written with the pseudonym. */
function answer(payload: BriefPayload): ClaudeJsonResult {
  const agentSignal = payload.signaux.find((s) => s.sujet.agent);
  return {
    ok: true,
    model: 'claude-opus-5-5',
    usage: { inputTokens: 800, outputTokens: 250, cacheReadTokens: 1_100, cacheWriteTokens: 0 },
    output: {
      resume: `Priorité : les leads d'hier, puis ${agentSignal?.sujet.agent}.`,
      actions: agentSignal
        ? [
            {
              signal: agentSignal.ref,
              titre: `Accompagner ${agentSignal.sujet.agent}`,
              constat: `${agentSignal.sujet.agent} est sous ses objectifs.`,
              action: 'Écoutez des appels ensemble.',
            },
          ]
        : [],
    },
  };
}

function fakeWriter(options: { ended?: boolean; results?: (task: ClaudeTask) => ClaudeJsonResult } = {}) {
  const batches = new Map<string, ClaudeTask[]>();
  const calls = { submitted: 0, cancelled: [] as string[], direct: 0 };
  const parse = (user: string) => JSON.parse(user.slice(user.indexOf('{'))) as BriefPayload;
  const writer: ClaudeJsonWriter = {
    model: 'claude-opus-5-5',
    async submitBatch(tasks) {
      calls.submitted += 1;
      const id = `msgbatch_${calls.submitted}`;
      batches.set(id, [...tasks]);
      return id;
    },
    async batchEnded() {
      return options.ended ?? true;
    },
    async *batchResults(batchId) {
      for (const task of batches.get(batchId) ?? []) {
        yield { id: task.id, result: options.results?.(task) ?? answer(parse(task.user)) };
      }
    },
    async cancelBatch(batchId) {
      calls.cancelled.push(batchId);
    },
    async writeNow(user) {
      calls.direct += 1;
      return answer(parse(user));
    },
  };
  return { writer, calls, batches };
}

function deps(store: BriefStore, writer: ClaudeJsonWriter | null): BriefDeps {
  return { store, writer, now: () => NOW, log: () => {} };
}

describe('prepareDailyBriefs', () => {
  it('stocke les signaux, envoie un seul batch et n appelle pas le modèle sans signal', async () => {
    const { store, rows } = memoryStore([BUSY, QUIET]);
    const { writer, batches } = fakeWriter();
    const stats = await prepareDailyBriefs(deps(store, writer));

    expect(stats).toEqual({ organizations: 2, created: 2, submitted: 1, batchId: 'msgbatch_1' });
    const busy = rows.find((r) => r.organizationId === BUSY.id);
    const quiet = rows.find((r) => r.organizationId === QUIET.id);
    expect(quiet).toMatchObject({ briefDate: DAY, status: 'empty', signals: [], payload: null });
    expect(busy).toMatchObject({ briefDate: DAY, status: 'submitted', batchId: 'msgbatch_1' });
    expect(busy?.signals.map((s) => s.id)).toEqual(expect.arrayContaining(['C1', 'C3']));
    expect(busy?.pseudonyms).toEqual({ 'Agent A': 'Yasmine' });

    const [task] = batches.get('msgbatch_1') ?? [];
    expect(task?.id).toBe(busy?.id);
    expect(task?.user).toContain('Agent A');
    expect(task?.user).not.toContain('Yasmine');
  });

  it('ne refait rien si le brief du jour existe déjà', async () => {
    const { store, rows } = memoryStore([BUSY, QUIET]);
    const { writer, calls } = fakeWriter();
    await prepareDailyBriefs(deps(store, writer));
    const again = await prepareDailyBriefs(deps(store, writer));
    expect(again).toMatchObject({ created: 0, submitted: 0, batchId: null });
    expect(calls.submitted).toBe(1);
    expect(rows).toHaveLength(2);
  });

  it('garde les signaux bruts quand l IA est coupée', async () => {
    const { store, rows } = memoryStore([BUSY]);
    const stats = await prepareDailyBriefs(deps(store, null));
    expect(stats.batchId).toBeNull();
    expect(rows[0]).toMatchObject({ status: 'signals_only', batchId: null });
    expect(rows[0]?.payload).not.toBeNull();
  });
});

describe('collectDailyBriefs', () => {
  it('attend un batch en cours, puis enregistre le brief avec les vrais noms', async () => {
    const { store, rows } = memoryStore([BUSY]);
    const running = fakeWriter({ ended: false });
    await prepareDailyBriefs(deps(store, running.writer));
    expect(await collectDailyBriefs(deps(store, running.writer))).toEqual({
      ready: 0,
      failed: 0,
      waiting: 1,
    });

    const ended = fakeWriter();
    ended.batches.set('msgbatch_1', running.batches.get('msgbatch_1') ?? []);
    expect(await collectDailyBriefs(deps(store, ended.writer))).toEqual({ ready: 1, failed: 0, waiting: 0 });

    const row = rows[0];
    expect(row).toMatchObject({
      status: 'ready',
      attempts: 1,
      model: 'claude-opus-5-5',
      warnings: [],
      inputTokens: 800,
      outputTokens: 250,
      cacheReadTokens: 1_100,
      cacheWriteTokens: 0,
    });
    expect(row?.content).toMatchObject({
      resume: "Priorité : les leads d'hier, puis Yasmine.",
      actions: [{ code: 'C3', titre: 'Accompagner Yasmine', lien: '/agents/Yasmine' }],
    });
  });

  it('marque en échec un résultat en erreur ou une réponse hors format', async () => {
    const { store, rows } = memoryStore([BUSY]);
    const { writer } = fakeWriter({ results: () => ({ ok: false, error: 'erreur API : overloaded_error' }) });
    await prepareDailyBriefs(deps(store, writer));
    expect(await collectDailyBriefs(deps(store, writer))).toMatchObject({ failed: 1 });
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1, error: 'erreur API : overloaded_error' });

    const other = memoryStore([BUSY]);
    const bad = fakeWriter({
      results: () => ({ ok: true, output: { texte: 'libre' }, model: 'm', usage: {} as never }),
    });
    await prepareDailyBriefs(deps(other.store, bad.writer));
    await collectDailyBriefs(deps(other.store, bad.writer));
    expect(other.rows[0]).toMatchObject({ status: 'failed', error: 'réponse du modèle hors format' });
  });
});

describe('fallbackDailyBriefs', () => {
  it('annule le batch en retard et appelle le modèle directement', async () => {
    const { store, rows } = memoryStore([BUSY, QUIET]);
    const { writer, calls } = fakeWriter({ ended: false });
    await prepareDailyBriefs(deps(store, writer));
    expect(await fallbackDailyBriefs(deps(store, writer))).toEqual({ ready: 1, failed: 0 });
    expect(calls.cancelled).toEqual(['msgbatch_1']);
    expect(calls.direct).toBe(1);
    expect(rows.find((r) => r.organizationId === BUSY.id)).toMatchObject({ status: 'ready', attempts: 1 });

    // Le batch annulé rend ensuite « canceled » : le brief déjà prêt n'est pas écrasé.
    const late = fakeWriter({ results: () => ({ ok: false, error: 'batch annulé' }) });
    late.batches.set('msgbatch_1', []);
    await collectDailyBriefs(deps(store, late.writer));
    expect(rows.find((r) => r.organizationId === BUSY.id)?.status).toBe('ready');
  });

  it('ne relance pas un brief qui a déjà eu ses deux essais', async () => {
    const { store, rows } = memoryStore([BUSY]);
    const { writer, calls } = fakeWriter({ results: () => ({ ok: false, error: 'refus du modèle' }) });
    await prepareDailyBriefs(deps(store, writer));
    await collectDailyBriefs(deps(store, writer));
    const row = rows[0];
    if (row) row.attempts = 2;
    expect(await fallbackDailyBriefs(deps(store, writer))).toEqual({ ready: 0, failed: 0 });
    expect(calls.direct).toBe(0);
  });
});
