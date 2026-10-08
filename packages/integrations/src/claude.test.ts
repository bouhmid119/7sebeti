import type Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeJsonWriter, readJsonMessage } from './claude';

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '{"resume":"r","actions":[]}', citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 900,
      output_tokens: 300,
      cache_read_input_tokens: 1_200,
      cache_creation_input_tokens: 0,
    },
    ...over,
  } as Message;
}

function fakeClient() {
  const create = vi.fn(async () => message());
  const batchesCreate = vi.fn(async () => ({ id: 'msgbatch_1' }));
  const retrieve = vi.fn(async () => ({ processing_status: 'ended' }));
  const cancel = vi.fn(async () => ({}));
  const results = vi.fn(async () =>
    (async function* () {
      yield { custom_id: 'a', result: { type: 'succeeded', message: message() } };
      yield {
        custom_id: 'b',
        result: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error' } } },
      };
      yield { custom_id: 'c', result: { type: 'expired' } };
    })(),
  );
  const client = {
    messages: { create, batches: { create: batchesCreate, retrieve, results, cancel } },
  } as unknown as Anthropic;
  return { client, create, batchesCreate, retrieve, results, cancel };
}

const SCHEMA = { type: 'object', properties: { resume: { type: 'string' } } };

describe('readJsonMessage', () => {
  it('lit le JSON après les blocs de réflexion et rend la consommation', () => {
    expect(readJsonMessage(message())).toEqual({
      ok: true,
      output: { resume: 'r', actions: [] },
      model: 'claude-opus-5-5',
      usage: { inputTokens: 900, outputTokens: 300, cacheReadTokens: 1_200, cacheWriteTokens: 0 },
    });
  });

  it('traite refus, troncature et texte non JSON comme des échecs', () => {
    expect(readJsonMessage(message({ stop_reason: 'refusal' }))).toEqual({
      ok: false,
      error: 'refus du modèle',
    });
    expect(readJsonMessage(message({ stop_reason: 'max_tokens' })).ok).toBe(false);
    expect(
      readJsonMessage(message({ content: [{ type: 'text', text: 'Bonjour', citations: null }] })).ok,
    ).toBe(false);
  });
});

describe('createClaudeJsonWriter', () => {
  it('envoie la consigne en cache, le format JSON et le modèle par défaut', async () => {
    const fake = fakeClient();
    const writer = createClaudeJsonWriter({ system: 'Consigne', schema: SCHEMA, client: fake.client });
    expect(writer.model).toBe('claude-opus-5-5');

    const batchId = await writer.submitBatch([
      { id: 'org-1', user: 'données 1' },
      { id: 'org-2', user: 'données 2' },
    ]);
    expect(batchId).toBe('msgbatch_1');
    const [{ requests }] = fake.batchesCreate.mock.calls[0] as unknown as [
      { requests: Array<{ custom_id: string; params: Record<string, unknown> }> },
    ];
    expect(requests.map((r) => r.custom_id)).toEqual(['org-1', 'org-2']);
    expect(requests[0]?.params).toMatchObject({
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: 'Consigne', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: 'données 1' }],
    });
  });

  it('rend chaque résultat du batch avec son identifiant', async () => {
    const fake = fakeClient();
    const writer = createClaudeJsonWriter({ system: 's', schema: SCHEMA, client: fake.client, model: 'm' });
    expect(await writer.batchEnded('msgbatch_1')).toBe(true);
    const out = [];
    for await (const r of writer.batchResults('msgbatch_1')) out.push(r);
    expect(out.map((r) => [r.id, r.result.ok])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
    expect(out[1]?.result).toEqual({ ok: false, error: 'erreur API : overloaded_error' });
    expect(out[2]?.result).toEqual({ ok: false, error: 'batch expiré' });
  });

  it('appelle directement pour le rattrapage, avec le modèle choisi', async () => {
    const fake = fakeClient();
    const writer = createClaudeJsonWriter({
      system: 's',
      schema: SCHEMA,
      client: fake.client,
      model: 'claude-sonnet-5-5',
    });
    const result = await writer.writeNow('données');
    expect(result.ok).toBe(true);
    expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5-5' }));
  });
});
