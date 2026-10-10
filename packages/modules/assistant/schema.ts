/**
 * assistant: daily « Actions à prendre » brief and the merchant's feedback on it.
 */

import { organizationRef, user } from '@7sebeti/modules/identity';
import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../shared/columns';

export const assistantSchema = pgSchema('assistant');

/**
 * empty: no signal that day, no model call. signals_only: AI off or no API key, the screen shows
 * the fixed-sentence brief (briefFromRules). pending → submitted (in a Batch API job) → ready, or
 * failed after the morning retry.
 */
export const aiBriefStatus = assistantSchema.enum('ai_brief_status', [
  'empty',
  'signals_only',
  'pending',
  'submitted',
  'ready',
  'failed',
]);

/** Daily « Actions à prendre » brief: signals computed by code, wording by Claude. One row per org and day. */
export const aiBrief = assistantSchema.table(
  'ai_brief',
  {
    id: id(),
    organizationId: organizationRef(),
    /** Day of the brief in the organization's timezone. */
    briefDate: date({ mode: 'string' }).notNull(),
    status: aiBriefStatus().notNull(),
    /** Full signals (real agent names, links): what the screen shows when the AI text is missing. */
    signals: jsonb().notNull(),
    /** What is sent to the model: whitelisted, pseudonymised, formatted. Null when nothing is sent. */
    payload: jsonb(),
    /** Pseudonym → real agent name, to restore names in the answer. Never sent to the model. */
    pseudonyms: jsonb(),
    /** Validated brief with real names restored (BriefContent in @7sebeti/domain). */
    content: jsonb(),
    model: text(),
    batchId: text(),
    attempts: integer().notNull().default(0),
    /** Usage of the answer that was kept, for cost tracking (uncached input, output, cache reads and writes). */
    inputTokens: integer(),
    outputTokens: integer(),
    cacheReadTokens: integer(),
    cacheWriteTokens: integer(),
    /** Non-blocking checks on the answer (figure not found in the data, unknown pseudonym…). */
    warnings: text().array().notNull().default(sql`'{}'::text[]`),
    error: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.briefDate), index().on(t.status, t.briefDate)],
);

/**
 * What the merchant had in front of them when answering on a signal: Claude's text, a fixed
 * sentence (no model), or just the signal card (a signal without a written action).
 */
export const aiBriefShownAs = assistantSchema.enum('ai_brief_shown_as', ['ai', 'rules', 'signal']);

/** done: the merchant did it. not_relevant: the signal did not apply to their shop. */
export const aiBriefVerdict = assistantSchema.enum('ai_brief_verdict', ['done', 'not_relevant']);

/**
 * The merchant's answer to one signal of a brief, to measure during the beta which signals
 * lead to action. One row per brief and signal: the last answer wins, removing it deletes the row.
 */
export const aiBriefFeedback = assistantSchema.table(
  'ai_brief_feedback',
  {
    id: id(),
    organizationId: organizationRef(),
    briefId: uuid()
      .notNull()
      .references(() => aiBrief.id, { onDelete: 'cascade' }),
    /** Signal reference within the brief (s1, s2…). */
    signalRef: text().notNull(),
    /** Signal code (C1…R1), for statistics without opening the brief. */
    code: text().notNull(),
    verdict: aiBriefVerdict().notNull(),
    shownAs: aiBriefShownAs().notNull(),
    userId: uuid().references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.briefId, t.signalRef), index().on(t.organizationId, t.code)],
);
