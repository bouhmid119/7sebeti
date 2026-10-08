import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

const key = randomBytes(32).toString('base64');

describe('secret encryption', () => {
  it('round-trips', () => {
    const enc = encryptSecret('converty-token', key);
    expect(enc).not.toContain('converty-token');
    expect(decryptSecret(enc, key)).toBe('converty-token');
  });

  it('rejects tampering and wrong keys', () => {
    const enc = encryptSecret('secret', key);
    expect(() => decryptSecret(enc, randomBytes(32).toString('base64'))).toThrow();
    const [iv, tag] = enc.split('.');
    expect(() => decryptSecret(`${iv}.${tag}.AAAA`, key)).toThrow();
  });
});
