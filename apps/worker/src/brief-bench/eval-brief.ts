import {
  BRIEF_OUTPUT_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
  type BriefContent,
  briefFromRules,
  briefUserMessage,
  computeSignals,
  finalizeBrief,
  type PreparedBrief,
  prepareBrief,
  type Signal,
} from '@7sebeti/domain';
import { createClaudeJsonWriter } from '@7sebeti/integrations';
import { generateBenchScenarios } from './scenarios';

/**
 * Banc d'essai MOH-11 : 40 briefs fictifs, Haiku 5.5 en batch, à côté des phrases fixes.
 *
 *   set -a; . ./.env; set +a
 *   pnpm --filter @7sebeti/worker eval-brief
 *
 * Options : EVAL_BRIEF_COUNT (défaut 40), AI_BRIEF_MODEL (défaut claude-haiku-5-5),
 * EVAL_BRIEF_DIRECT=1 pour appeler le modèle un par un (plus cher, utile si le batch tarde).
 * N'écrit rien dans le repo ; le rapport va sur stdout.
 */

const COUNT = Math.min(50, Math.max(1, Number(process.env.EVAL_BRIEF_COUNT ?? 40)));
const MODEL = process.env.AI_BRIEF_MODEL || 'claude-haiku-5-5';
const DIRECT = process.env.EVAL_BRIEF_DIRECT === '1';
const POLL_MS = 15_000;
const MAX_WAIT_MS = 45 * 60_000;

/** Barème indicatif $ / million de tokens (entrée / sortie). Cache lu ≈ 10 % de l'entrée. */
const RATE: Record<string, { in: number; out: number }> = {
  'claude-haiku-5-5': { in: 1, out: 5 },
  'claude-sonnet-5-5': { in: 3, out: 15 },
  'claude-opus-5-5': { in: 15, out: 75 },
};

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface CaseResult {
  id: string;
  situations: string[];
  signalCodes: string[];
  rules: BriefContent;
  model: BriefContent | null;
  modelName: string | null;
  warnings: string[];
  error: string | null;
  usage: Usage | null;
}

function usd(u: Usage, model: string): number {
  const rate = RATE[model] ?? RATE['claude-haiku-5-5'];
  if (!rate) return 0;
  const input = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens * 0.1;
  return (input * rate.in + u.outputTokens * rate.out) / 1_000_000;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function renderBrief(c: BriefContent): string {
  const actions = c.actions
    .map((a) => `- **${a.titre}** (${a.code}, ${a.signal})\n  ${a.constat}\n  → ${a.action}`)
    .join('\n');
  return `${c.resume}\n${actions}`;
}

function report(results: CaseResult[], model: string, batchId: string | null): string {
  const failed = results.filter((r) => r.error);
  const warned = results.filter((r) => r.warnings.length > 0);
  const usage = results.reduce<Usage>(
    (acc, r) => {
      if (!r.usage) return acc;
      acc.inputTokens += r.usage.inputTokens;
      acc.outputTokens += r.usage.outputTokens;
      acc.cacheReadTokens += r.usage.cacheReadTokens;
      acc.cacheWriteTokens += r.usage.cacheWriteTokens;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
  const cost = usd(usage, model);
  const lines = [
    `# Comparaison brief : ${model} contre les phrases fixes`,
    '',
    `- Date : ${new Date().toISOString()}`,
    `- Cas : ${results.length}`,
    `- Batch : ${batchId ?? (DIRECT ? 'appels directs' : 'aucun')}`,
    `- Réponses refusées : ${failed.length}`,
    `- Cas avec avertissement : ${warned.length}`,
    `- Tokens : ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache lu, ${usage.cacheWriteTokens} cache écrit`,
    `- Coût estimé : ${cost.toFixed(4)} $ (barème indicatif)`,
    '',
    '| id | situations | signaux | Haiku | avertissements |',
    '|---|---|---|---|---|',
    ...results.map((r) => {
      const status = r.error
        ? `échec (${r.error})`
        : r.model
          ? `${r.model.actions.length} actions`
          : 'pas d’appel';
      return `| ${r.id} | ${r.situations.join(', ') || '—'} | ${r.signalCodes.join(', ') || 'aucun'} | ${status} | ${r.warnings.join('; ') || '—'} |`;
    }),
  ];
  for (const r of results) {
    lines.push('', `## ${r.id}`, '', `Situations : ${r.situations.join(', ') || 'aucune'}.`);
    lines.push('', '### Phrases fixes', '', renderBrief(r.rules));
    if (r.error) lines.push('', `### ${model}`, '', `Échec : ${r.error}`);
    else if (r.model) {
      lines.push('', `### ${model}`, '', renderBrief(r.model));
      if (r.warnings.length) lines.push('', `Avertissements : ${r.warnings.join(' ; ')}`);
    } else lines.push('', `### ${model}`, '', 'Aucun signal : pas d’appel au modèle.');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY manquant. Exporte-le (set -a; . ./.env; set +a) sans l’afficher.');
    process.exit(1);
  }

  const scenarios = generateBenchScenarios(COUNT);
  const prepared = scenarios.map((s) => {
    const signals = computeSignals(s.input);
    const brief: PreparedBrief = prepareBrief(signals, { asOf: s.input.asOf, currency: s.currency });
    return { s, signals, brief, rules: briefFromRules(brief, signals) };
  });

  const writer = createClaudeJsonWriter({
    apiKey,
    model: MODEL,
    system: BRIEF_SYSTEM_PROMPT,
    schema: BRIEF_OUTPUT_SCHEMA,
  });

  const byId = new Map<
    string,
    {
      content: BriefContent | null;
      warnings: string[];
      error: string | null;
      usage: Usage | null;
      modelName: string | null;
    }
  >();
  const withSignals = prepared.filter((c) => c.signals.length > 0);

  let batchId: string | null = null;
  if (DIRECT) {
    for (const c of withSignals) {
      const result = await writer.writeNow(briefUserMessage(c.brief.payload));
      byId.set(c.s.id, toOutcome(result, c.brief, c.signals));
    }
  } else {
    batchId = await writer.submitBatch(
      withSignals.map((c) => ({ id: c.s.id, user: briefUserMessage(c.brief.payload) })),
    );
    console.error(`[eval-brief] batch ${batchId}, ${withSignals.length} requêtes, attente…`);
    const started = Date.now();
    while (!(await writer.batchEnded(batchId))) {
      if (Date.now() - started > MAX_WAIT_MS) {
        await writer.cancelBatch(batchId);
        throw new Error(`batch encore en cours après ${MAX_WAIT_MS / 60_000} min`);
      }
      await sleep(POLL_MS);
    }
    for await (const row of writer.batchResults(batchId)) {
      const c = withSignals.find((x) => x.s.id === row.id);
      if (!c) continue;
      byId.set(row.id, toOutcome(row.result, c.brief, c.signals));
    }
  }

  const results: CaseResult[] = prepared.map((c) => {
    const out = byId.get(c.s.id);
    return {
      id: c.s.id,
      situations: c.s.situations,
      signalCodes: c.signals.map((s) => s.id),
      rules: c.rules,
      model: out?.content ?? null,
      modelName: out?.modelName ?? null,
      warnings: out?.warnings ?? [],
      error: out?.error ?? null,
      usage: out?.usage ?? null,
    };
  });
  process.stdout.write(report(results, writer.model, batchId));
}

function toOutcome(
  result: Awaited<ReturnType<ReturnType<typeof createClaudeJsonWriter>['writeNow']>>,
  prepared: PreparedBrief,
  signals: readonly Signal[],
): {
  content: BriefContent | null;
  warnings: string[];
  error: string | null;
  usage: Usage | null;
  modelName: string | null;
} {
  if (!result.ok) return { content: null, warnings: [], error: result.error, usage: null, modelName: null };
  const finalized = finalizeBrief(result.output, prepared, signals);
  if (!finalized.ok) {
    return {
      content: null,
      warnings: [],
      error: finalized.error,
      usage: result.usage,
      modelName: result.model,
    };
  }
  return {
    content: finalized.content,
    warnings: finalized.warnings,
    error: null,
    usage: result.usage,
    modelName: result.model,
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
