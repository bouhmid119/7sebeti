import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';

/**
 * Appels à Claude qui rendent un objet JSON au format imposé (structured outputs).
 * Deux voies : le Batch API la nuit (moitié prix, résultat en général sous l'heure),
 * et un appel direct pour rattraper ce que le batch n'a pas rendu à temps.
 * La consigne système est fixe et mise en cache ; seul le message utilisateur varie.
 */

/** Modèle par défaut ; AI_BRIEF_MODEL permet d'en changer sans toucher au code. */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type ClaudeJsonResult =
  | { ok: true; output: unknown; model: string; usage: ClaudeUsage }
  | { ok: false; error: string };

export interface ClaudeTask {
  /** Identifiant renvoyé avec le résultat du batch : lettres, chiffres, - et _, 64 caractères au plus. */
  id: string;
  user: string;
}

export interface ClaudeJsonWriter {
  readonly model: string;
  submitBatch(tasks: readonly ClaudeTask[]): Promise<string>;
  batchEnded(batchId: string): Promise<boolean>;
  batchResults(batchId: string): AsyncIterable<{ id: string; result: ClaudeJsonResult }>;
  cancelBatch(batchId: string): Promise<void>;
  writeNow(user: string): Promise<ClaudeJsonResult>;
}

export interface ClaudeJsonWriterOptions {
  system: string;
  schema: Record<string, unknown>;
  apiKey?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** Pour les tests : un client déjà construit. */
  client?: Anthropic;
}

export function readJsonMessage(message: Message): ClaudeJsonResult {
  if (message.stop_reason === 'refusal') return { ok: false, error: 'refus du modèle' };
  if (message.stop_reason === 'max_tokens') return { ok: false, error: 'réponse tronquée (max_tokens)' };
  // Les blocs de réflexion précèdent le texte : on prend le premier bloc texte.
  const text = message.content.find((b) => b.type === 'text');
  if (text?.type !== 'text') return { ok: false, error: 'réponse sans texte' };
  let output: unknown;
  try {
    output = JSON.parse(text.text);
  } catch {
    return { ok: false, error: "réponse qui n'est pas du JSON" };
  }
  const u = message.usage;
  return {
    ok: true,
    output,
    model: message.model,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

export function createClaudeJsonWriter(options: ClaudeJsonWriterOptions): ClaudeJsonWriter {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;

  const params = (user: string): MessageCreateParamsNonStreaming => ({
    model,
    max_tokens: options.maxTokens ?? 16_000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: options.effort ?? 'medium',
      format: { type: 'json_schema', schema: options.schema },
    },
    // TTL d'une heure : les requêtes d'un batch s'étalent, le cache doit tenir jusqu'au bout.
    system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: user }],
  });

  return {
    model,

    async submitBatch(tasks) {
      const batch = await client.messages.batches.create({
        requests: tasks.map((t) => ({ custom_id: t.id, params: params(t.user) })),
      });
      return batch.id;
    },

    async batchEnded(batchId) {
      const batch = await client.messages.batches.retrieve(batchId);
      return batch.processing_status === 'ended';
    },

    async *batchResults(batchId) {
      for await (const r of await client.messages.batches.results(batchId)) {
        const res = r.result;
        let result: ClaudeJsonResult;
        if (res.type === 'succeeded') result = readJsonMessage(res.message);
        else if (res.type === 'errored')
          result = { ok: false, error: `erreur API : ${res.error.error.type}` };
        else result = { ok: false, error: res.type === 'expired' ? 'batch expiré' : 'batch annulé' };
        yield { id: r.custom_id, result };
      }
    },

    async cancelBatch(batchId) {
      await client.messages.batches.cancel(batchId);
    },

    async writeNow(user) {
      try {
        return readJsonMessage(await client.messages.create(params(user)));
      } catch (err) {
        if (err instanceof Anthropic.APIError)
          return { ok: false, error: `erreur API : ${err.status ?? '?'}` };
        throw err;
      }
    },
  };
}
