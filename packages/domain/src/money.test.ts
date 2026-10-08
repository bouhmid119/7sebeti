import { describe, expect, it } from 'vitest';
import { fromMinor, toMinor } from './money';

describe('money', () => {
  it('stores TND in millimes', () => {
    expect(toMinor('69.5', 'TND')).toBe(69500);
    expect(toMinor(0.1 + 0.2, 'TND')).toBe(300);
    expect(fromMinor(69500, 'TND')).toBe('69.500');
  });

  it('handles negatives and 2-decimal currencies', () => {
    expect(toMinor(-12.345, 'TND')).toBe(-12345);
    expect(fromMinor(-5, 'TND')).toBe('-0.005');
    expect(toMinor(19.99, 'CAD')).toBe(1999);
    expect(fromMinor(1999, 'CAD')).toBe('19.99');
  });

  it('rejects garbage', () => {
    expect(() => toMinor('abc', 'TND')).toThrow();
  });
});
