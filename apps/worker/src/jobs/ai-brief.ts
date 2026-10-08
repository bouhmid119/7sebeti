import {
  addDays,
  type BriefContent,
  type BriefPayload,
  briefUserMessage,
  type Currency,
  computeSignals,
  dayInTimeZone,
  finalizeBrief,
  prepareBrief,
  type Signal,
  type SignalInput,
} from '@7sebeti/domain';
import type { ClaudeJsonResult, ClaudeJsonWriter } from '@7sebeti/integrations';

/**
 * Nightly « Actions à prendre » brief. The code computes the signals, Claude only ranks and
 * words them. Three scheduled steps:
 * - prepare (03:00): compute each organization's signals, store them, send one Batch API job;
 * - collect (every 10 min): store the results of finished batches;
 * - fallback (07:00): cancel what the batch has not returned yet and call the model directly.
 * Without a model (no API key, or AI switched off) the brief keeps the raw signals.
 */

export type BriefStatus = 'empty' | 'signals_only' | 'pending' | 'submitted' | 'ready' | 'failed';

export interface BriefOrganization {
  id: string;
  timezone: string;
  currency: Currency;
}

export interface BriefRef {
  id: string;
  organizationId: string;
  briefDate: string;
  status: BriefStatus;
  batchId: string | null;
  attempts: number;
}

export interface BriefRow extends BriefRef {
  signals: Signal[];
  payload: BriefPayload | null;
  pseudonyms: Record<string, string> | null;
}

export interface NewBrief {
  organizationId: string;
  briefDate: string;
  status: BriefStatus;
  signals: Signal[];
  payload: BriefPayload | null;
  pseudonyms: Record<string, string> | null;
}

export interface BriefPatch {
  status: BriefStatus;
  batchId?: string | null;
  model?: string | null;
  content?: BriefContent | null;
  warnings?: string[];
  error?: string | null;
  attempts?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}

export interface BriefStore {
  /** Platform-level: every organization to brief. */
  listOrganizations(): Promise<BriefOrganization[]>;
  /** Platform-level routing: briefs in these statuses since a day, without their content. */
  listBriefRefs(statuses: readonly BriefStatus[], sinceDay: string): Promise<BriefRef[]>;
  // Everything below runs inside the organization's row-level security context.
  loadSignalInput(org: BriefOrganization, asOf: string): Promise<SignalInput>;
  findBrief(organizationId: string, briefDate: string): Promise<BriefRow | null>;
  getBrief(organizationId: string, id: string): Promise<BriefRow | null>;
  /** Inserts, or returns the row another run already created for that day. */
  insertBrief(brief: NewBrief): Promise<BriefRow>;
  /** Applies the patch only if the row is still in one of `from`; returns whether it did. */
  updateBrief(
    organizationId: string,
    id: string,
    from: readonly BriefStatus[],
    patch: BriefPatch,
  ): Promise<boolean>;
}

export interface BriefDeps {
  store: BriefStore;
  /** null when the AI is off: briefs stay `signals_only`. */
  writer: ClaudeJsonWriter | null;
  now: () => Date;
  log: (message: string) => void;
}

/** A brief gets at most this many model answers (batch, then the morning retry). */
export const BRIEF_MAX_ATTEMPTS = 2;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function prepareDailyBriefs({ store, writer, now, log }: BriefDeps) {
  const stats = { organizations: 0, created: 0, submitted: 0, batchId: null as string | null };
  const toSubmit: BriefRow[] = [];

  for (const org of await store.listOrganizations()) {
    stats.organizations += 1;
    try {
      const day = dayInTimeZone(now(), org.timezone);
      let row = await store.findBrief(org.id, day);
      if (!row) {
        const signals = computeSignals(await store.loadSignalInput(org, day));
        const prepared =
          signals.length > 0 ? prepareBrief(signals, { asOf: day, currency: org.currency }) : null;
        row = await store.insertBrief({
          organizationId: org.id,
          briefDate: day,
          status: !prepared ? 'empty' : writer ? 'pending' : 'signals_only',
          signals,
          payload: prepared?.payload ?? null,
          pseudonyms: prepared?.pseudonyms ?? null,
        });
        stats.created += 1;
      }
      if (row.status === 'pending' && row.payload) toSubmit.push(row);
    } catch (err) {
      log(`[brief] prepare ${org.id}: ${errorText(err)}`);
    }
  }

  if (!writer || toSubmit.length === 0) return stats;
  const batchId = await writer.submitBatch(
    toSubmit.map((r) => ({ id: r.id, user: briefUserMessage(r.payload as BriefPayload) })),
  );
  stats.batchId = batchId;
  for (const r of toSubmit) {
    // A row left `pending` here (crash between the two steps) is picked up by the fallback.
    const done = await store.updateBrief(r.organizationId, r.id, ['pending'], {
      status: 'submitted',
      batchId,
      model: writer.model,
    });
    if (done) stats.submitted += 1;
  }
  return stats;
}

async function applyResult(
  store: BriefStore,
  row: BriefRow,
  result: ClaudeJsonResult,
  from: readonly BriefStatus[],
): Promise<'ready' | 'failed' | 'skipped'> {
  if (!row.payload || !from.includes(row.status)) return 'skipped';
  const attempts = row.attempts + 1;
  const brief = result.ok
    ? finalizeBrief(result.output, { payload: row.payload, pseudonyms: row.pseudonyms ?? {} }, row.signals)
    : result;
  if (!brief.ok) {
    await store.updateBrief(row.organizationId, row.id, from, {
      status: 'failed',
      error: brief.error,
      attempts,
    });
    return 'failed';
  }
  const usage = result.ok ? result.usage : null;
  await store.updateBrief(row.organizationId, row.id, from, {
    status: 'ready',
    content: brief.content,
    warnings: brief.warnings,
    model: result.ok ? result.model : null,
    error: null,
    attempts,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
  });
  return 'ready';
}

export async function collectDailyBriefs({ store, writer, now }: BriefDeps) {
  const stats = { ready: 0, failed: 0, waiting: 0 };
  if (!writer) return stats;
  const refs = await store.listBriefRefs(['submitted'], addDays(dayInTimeZone(now(), 'UTC'), -2));
  const byBatch = new Map<string, BriefRef[]>();
  for (const r of refs) if (r.batchId) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);

  for (const [batchId, rows] of byBatch) {
    if (!(await writer.batchEnded(batchId))) {
      stats.waiting += rows.length;
      continue;
    }
    const waiting = new Map(rows.map((r) => [r.id, r]));
    for await (const { id, result } of writer.batchResults(batchId)) {
      const ref = waiting.get(id);
      if (!ref) continue;
      waiting.delete(id);
      const row = await store.getBrief(ref.organizationId, ref.id);
      const outcome = row ? await applyResult(store, row, result, ['submitted']) : 'skipped';
      if (outcome !== 'skipped') stats[outcome] += 1;
    }
    for (const ref of waiting.values()) {
      await store.updateBrief(ref.organizationId, ref.id, ['submitted'], {
        status: 'failed',
        error: 'absent des résultats du batch',
        attempts: ref.attempts + 1,
      });
      stats.failed += 1;
    }
  }
  return stats;
}

export async function fallbackDailyBriefs(deps: BriefDeps) {
  const { store, writer, now, log } = deps;
  const stats = { ready: 0, failed: 0 };
  if (!writer) return stats;
  // Take what finished batches already returned before paying for direct calls.
  await collectDailyBriefs(deps);

  const since = addDays(dayInTimeZone(now(), 'UTC'), -1);
  const refs = (await store.listBriefRefs(['pending', 'submitted', 'failed'], since)).filter(
    (r) => r.attempts < BRIEF_MAX_ATTEMPTS,
  );
  // Only batches still running: the others already ended (their rows are pending or failed).
  const running = refs.filter((r) => r.status === 'submitted' && r.batchId).map((r) => r.batchId as string);
  for (const batchId of new Set(running)) {
    try {
      await writer.cancelBatch(batchId);
    } catch (err) {
      log(`[brief] cancel batch ${batchId}: ${errorText(err)}`);
    }
  }

  for (const ref of refs) {
    const row = await store.getBrief(ref.organizationId, ref.id);
    if (!row?.payload) continue;
    const result = await writer.writeNow(briefUserMessage(row.payload));
    const outcome = await applyResult(store, row, result, ['pending', 'submitted', 'failed']);
    if (outcome !== 'skipped') stats[outcome] += 1;
  }
  return stats;
}
