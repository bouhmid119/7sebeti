import { describe, expect, it } from 'vitest';
import { dayInTimeZone } from './day';
import { toGovernorate } from './governorate';

describe('toGovernorate', () => {
  it.each([
    ['Tunis', 'Tunis'],
    ['tunis - la marsa', 'Tunis'],
    ['BEN AROUS', 'Ben Arous'],
    ['Béja', 'Béja'],
    ['beja', 'Béja'],
    ['Kef', 'Le Kef'],
    ['El Kef', 'Le Kef'],
    ['Manouba', 'La Manouba'],
    ['Sidi Bouzid', 'Sidi Bouzid'],
    ['Gouvernorat de Sfax', 'Sfax'],
    ['الكاف', 'Le Kef'],
    ['صفاقس', 'Sfax'],
    ['سوسة', 'Sousse'],
    ['ولاية نابل', 'Nabeul'],
  ])('%s → %s', (city, gov) => {
    expect(toGovernorate(city)).toBe(gov);
  });

  it('renvoie null pour une ville inconnue ou vide', () => {
    expect(toGovernorate('Paris')).toBeNull();
    expect(toGovernorate('Tunisie')).toBeNull();
    expect(toGovernorate('  ')).toBeNull();
    expect(toGovernorate(null)).toBeNull();
  });
});

describe('dayInTimeZone', () => {
  it('donne le jour dans le fuseau de l organisation', () => {
    const lateEvening = new Date('2026-10-06T23:30:00Z');
    expect(dayInTimeZone(lateEvening, 'Africa/Tunis')).toBe('2026-10-07');
    expect(dayInTimeZone(lateEvening, 'UTC')).toBe('2026-10-06');
  });
});
