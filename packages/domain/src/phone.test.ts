import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each(['+216 12 345 678', '00216-12-345-678', '(216) 12.345.678', '12345678', '21612345678'])(
    'TN %s',
    (raw) => expect(normalizePhone(raw)).toBe('12345678'),
  );

  it('handles Algeria and Morocco trunk prefix', () => {
    expect(normalizePhone('0555 12 34 56', 'DZ')).toBe('555123456');
    expect(normalizePhone('+213 555 12 34 56', 'DZ')).toBe('555123456');
    expect(normalizePhone('06 12 34 56 78', 'MA')).toBe('612345678');
  });

  it('returns empty for missing input', () => {
    expect(normalizePhone(null)).toBe('');
  });
});
