/**
 * Money is stored and computed in minor units (integers) to avoid float drift.
 * TND and the other North-African currencies use 3 decimals (millimes), CAD uses 2.
 */
export type Currency = 'TND' | 'DZD' | 'MAD' | 'EUR' | 'USD' | 'CAD';

const MINOR_DIGITS: Record<Currency, number> = {
  TND: 3,
  DZD: 2,
  MAD: 2,
  EUR: 2,
  USD: 2,
  CAD: 2,
};

export function minorDigits(currency: Currency): number {
  return MINOR_DIGITS[currency];
}

/** "69.5" TND → 69500 millimes. Rounds half away from zero at the currency precision. */
export function toMinor(amount: number | string, currency: Currency): number {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${amount}`);
  const factor = 10 ** MINOR_DIGITS[currency];
  return Math.sign(value) * Math.round(Math.abs(value) * factor);
}

/** 69500 millimes → "69.500" (string, exact, for numeric DB columns and display). */
export function fromMinor(minor: number, currency: Currency): string {
  const digits = MINOR_DIGITS[currency];
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = String(abs % 10 ** digits).padStart(digits, '0');
  return digits === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`;
}
