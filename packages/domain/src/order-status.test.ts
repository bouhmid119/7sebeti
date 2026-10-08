import { describe, expect, it } from 'vitest';
import { categorizeStatus, isConfirmedOrLater } from './order-status';

describe('categorizeStatus', () => {
  it.each([
    ['Confirmed', 'confirmed'],
    ['  IN TRANSIT ', 'shipped'],
    ['Tentative 2', 'no_answer'],
    ['attempt 150', 'no_answer'],
    ['delivered', 'delivered'],
    ['returned', 'returned'],
    ['rejected', 'refused'],
    ['abandoned', 'pending'],
    ['deleted', 'ignored'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(categorizeStatus(raw)).toBe(expected);
  });

  it('returns null for unknown statuses instead of guessing', () => {
    expect(categorizeStatus('à rappeler demain')).toBeNull();
  });

  it('lets merchant rules override defaults', () => {
    const rules = [{ match: 'à rappeler', kind: 'prefix' as const, category: 'callback' as const }];
    expect(categorizeStatus('À rappeler demain', rules)).toBe('callback');
  });

  it('counts later stages as confirmed', () => {
    expect(isConfirmedOrLater('returned')).toBe(true);
    expect(isConfirmedOrLater('no_answer')).toBe(false);
  });
});
