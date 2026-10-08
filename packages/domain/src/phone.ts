/**
 * Normalize a phone number to its national significant number so the same customer
 * is recognised across sources ("+216 12 345 678", "0021612345678", "12345678").
 */
const COUNTRY_CODES = { TN: '216', DZ: '213', MA: '212', CA: '1' } as const;
export type CountryCode = keyof typeof COUNTRY_CODES;

export function normalizePhone(raw: string | null | undefined, country: CountryCode = 'TN'): string {
  if (!raw) return '';
  let digits = raw.replace(/\D+/g, '');
  const cc = COUNTRY_CODES[country];
  if (digits.startsWith(`00${cc}`)) digits = digits.slice(cc.length + 2);
  else if (digits.startsWith(cc) && digits.length > nationalLength(country)) digits = digits.slice(cc.length);
  // DZ / MA write a trunk 0 in national format (0555 12 34 56); TN does not use one.
  if ((country === 'DZ' || country === 'MA') && digits.length === 10 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

function nationalLength(country: CountryCode): number {
  switch (country) {
    case 'TN':
      return 8;
    case 'DZ':
    case 'MA':
      return 9;
    case 'CA':
      return 10;
  }
}
