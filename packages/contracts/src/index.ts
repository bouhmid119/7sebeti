import { z } from 'zod';

/** Schemas shared by apps/api (validation, OpenAPI) and apps/web (typed client). */

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.enum(['ok', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const WebhookAck = z.object({
  ok: z.boolean(),
  eventId: z.string().uuid().optional(),
  /** True when the payload was identical to the last one seen for this object. */
  duplicate: z.boolean().optional(),
});
export type WebhookAck = z.infer<typeof WebhookAck>;

/** pg-boss queue names shared by apps/api (producer) and apps/worker (consumer). */
export const QUEUES = {
  inboundEvent: 'inbound-event',
  /** Nightly AI brief: compute signals and send the batch, store results, morning retry. */
  aiBriefPrepare: 'ai-brief-prepare',
  aiBriefCollect: 'ai-brief-collect',
  aiBriefFallback: 'ai-brief-fallback',
} as const;

// ─── Brief « Actions à prendre » ────────────────────────────────────────────

/** done: action menée. not_relevant: le signal ne concernait pas la boutique. */
export const BriefFeedback = z.enum(['done', 'not_relevant']);
export type BriefFeedback = z.infer<typeof BriefFeedback>;

export const BriefStatus = z.enum(['empty', 'signals_only', 'pending', 'submitted', 'ready', 'failed']);
export type BriefStatus = z.infer<typeof BriefStatus>;

const BriefFigure = z.union([
  z.string(),
  z.null(),
  z.array(z.string().nullable()).readonly(),
  z.record(z.string()),
]);

/** Une action du brief : texte de Claude ou phrases fixes, lien vers l'écran où agir. */
export const BriefActionView = z.object({
  /** Référence du signal dans le brief (s1, s2…), à renvoyer avec le retour du commerçant. */
  signal: z.string(),
  code: z.string(),
  titre: z.string(),
  constat: z.string(),
  action: z.string(),
  lien: z.string(),
  feedback: BriefFeedback.nullable(),
});
export type BriefActionView = z.infer<typeof BriefActionView>;

/** Un signal sans action rédigée : chiffres déjà formatés, vrais noms. */
export const BriefSignalView = z.object({
  signal: z.string(),
  code: z.string(),
  titre: z.string(),
  sujet: z.record(z.string()),
  chiffres: z.record(BriefFigure),
  seuil: z.string(),
  enJeu: z.string().nullable(),
  lien: z.string(),
  feedback: BriefFeedback.nullable(),
});
export type BriefSignalView = z.infer<typeof BriefSignalView>;

export const BriefView = z.object({
  id: z.string().uuid(),
  /** Jour du brief, AAAA-MM-JJ, dans le fuseau de l'organisation. */
  date: z.string(),
  status: BriefStatus,
  /** ai : rédigé par Claude. rules : phrases fixes (IA coupée, en attente ou en échec). null : aucun signal. */
  source: z.enum(['ai', 'rules']).nullable(),
  resume: z.string().nullable(),
  actions: z.array(BriefActionView),
  /** Les autres signaux du jour, à montrer sous les actions. */
  otherSignals: z.array(BriefSignalView),
  updatedAt: z.string(),
});
export type BriefView = z.infer<typeof BriefView>;

export const BriefHistoryItem = z.object({
  id: z.string().uuid(),
  date: z.string(),
  status: BriefStatus,
  signals: z.number().int(),
});
export type BriefHistoryItem = z.infer<typeof BriefHistoryItem>;

export const BriefFeedbackRequest = z.object({ feedback: BriefFeedback.nullable() });
export type BriefFeedbackRequest = z.infer<typeof BriefFeedbackRequest>;
