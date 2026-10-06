import { type Currency, fromMinor } from '../money';

const CURRENCY_LABEL: Record<Currency, string> = {
  TND: 'DT',
  DZD: 'DA',
  MAD: 'DH',
  EUR: '€',
  USD: '$',
  CAD: '$ CA',
};

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 1234.5 → "1 234,5". Espace simple comme séparateur, pour que le modèle le recopie tel quel. */
export function formatNumberFr(n: number): string {
  const [whole = '0', frac] = String(Math.abs(n)).split('.');
  const sign = n < 0 ? '-' : '';
  return `${sign}${groupThousands(whole)}${frac ? `,${frac}` : ''}`;
}

/** 1234500 millimes → "1 234,500 DT". */
export function formatMoneyFr(minor: number, currency: Currency): string {
  const [whole = '0', frac] = fromMinor(Math.round(minor), currency).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  return `${sign}${groupThousands(digits)}${frac ? `,${frac}` : ''} ${CURRENCY_LABEL[currency]}`;
}
