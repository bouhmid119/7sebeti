import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptField,
  decryptSecret,
  encryptField,
  encryptSecret,
  generateWrappedDataKey,
  hashPhone,
  openPayload,
  parseKeyring,
  payloadHash,
  sealPayload,
  unwrapDataKey,
} from './crypto';

const k = () => randomBytes(32).toString('base64');

describe('secret encryption', () => {
  it('round-trips and survives key rotation', () => {
    const v1 = k();
    const enc = encryptSecret('converty-token', `v1:${v1}`);
    expect(enc).not.toContain('converty-token');
    expect(enc.startsWith('v1.')).toBe(true);
    // After rotation, old ciphertexts still decrypt with v1, new ones use v2.
    const rotated = `v1:${v1};v2:${k()}`;
    expect(decryptSecret(enc, rotated)).toBe('converty-token');
    expect(encryptSecret('x', rotated).startsWith('v2.')).toBe(true);
  });

  it('accepts a bare key as v1 and rejects tampering or wrong keys', () => {
    const key = k();
    const enc = encryptSecret('secret', key);
    expect(decryptSecret(enc, key)).toBe('secret');
    expect(() => decryptSecret(enc, k())).toThrow();
    const [id, iv, tag] = enc.split('.');
    expect(() => decryptSecret(`${id}.${iv}.${tag}.AAAA`, key)).toThrow();
  });
});

describe('organization data keys', () => {
  const master = parseKeyring(`v1:${k()}`);
  const orgA = unwrapDataKey(generateWrappedDataKey(master), master);
  const orgB = unwrapDataKey(generateWrappedDataKey(master), master);

  it('encrypts fields and sealed payloads per organization', () => {
    const name = encryptField('Client Test', orgA);
    expect(decryptField(name, orgA)).toBe('Client Test');
    expect(() => decryptField(name, orgB)).toThrow();

    const payload = { _id: 'x', cart: [{ q: 2 }] };
    expect(openPayload(sealPayload(payload, orgA), orgA)).toEqual(payload);
  });

  it('hashes phones per organization', () => {
    expect(hashPhone('20000000', orgA)).toBe(hashPhone('20000000', orgA));
    expect(hashPhone('20000000', orgA)).not.toBe(hashPhone('20000000', orgB));
  });
});

describe('payloadHash', () => {
  it('ignores key order and listed volatile keys', () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(payloadHash({ a: 1, sentAt: 'x' }, new Set(['sentAt']))).toBe(
      payloadHash({ a: 1, sentAt: 'y' }, new Set(['sentAt'])),
    );
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
