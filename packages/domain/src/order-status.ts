/**
 * Canonical order lifecycle shared by every order source (Converty today, others later).
 * Source statuses are free text chosen by the merchant ("tentative 2", "à rappeler"…),
 * so each organization gets a mapping table; these defaults seed it and cover the
 * statuses observed in v1.
 */
export const ORDER_STATUS_CATEGORIES = [
  'pending',
  'no_answer',
  'callback',
  'confirmed',
  'refused',
  'shipped',
  'delivered',
  'returned',
  'ignored',
] as const;

export type OrderStatusCategory = (typeof ORDER_STATUS_CATEGORIES)[number];

export interface StatusRule {
  /** Lowercased, trimmed source status or prefix. */
  match: string;
  kind: 'exact' | 'prefix';
  category: OrderStatusCategory;
}

export const DEFAULT_STATUS_RULES: readonly StatusRule[] = [
  { match: 'deleted', kind: 'exact', category: 'ignored' },
  { match: 'pending', kind: 'exact', category: 'pending' },
  { match: 'abandoned', kind: 'exact', category: 'pending' },
  { match: 'attempt', kind: 'prefix', category: 'no_answer' },
  { match: 'tentative', kind: 'prefix', category: 'no_answer' },
  { match: 'confirmed', kind: 'exact', category: 'confirmed' },
  { match: 'packed', kind: 'exact', category: 'confirmed' },
  { match: 'uploaded', kind: 'exact', category: 'shipped' },
  { match: 'in transit', kind: 'exact', category: 'shipped' },
  { match: 'deposit', kind: 'exact', category: 'shipped' },
  { match: 'to be returned', kind: 'exact', category: 'shipped' },
  { match: 'delivered', kind: 'exact', category: 'delivered' },
  { match: 'returned', kind: 'exact', category: 'returned' },
  { match: 'cancelled', kind: 'exact', category: 'refused' },
  { match: 'refused', kind: 'exact', category: 'refused' },
  { match: 'rejected', kind: 'exact', category: 'refused' },
];

export function normalizeStatus(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Resolve a source status to a canonical category. Exact rules win over prefix rules,
 * and longer prefixes win over shorter ones. Returns null for an unknown status so
 * the caller can surface it instead of silently dropping it (a v1 failure mode).
 */
export function categorizeStatus(
  raw: string,
  rules: readonly StatusRule[] = DEFAULT_STATUS_RULES,
): OrderStatusCategory | null {
  const status = normalizeStatus(raw);
  const exact = rules.find((r) => r.kind === 'exact' && r.match === status);
  if (exact) return exact.category;
  const prefix = rules
    .filter((r) => r.kind === 'prefix' && status.startsWith(r.match))
    .sort((a, b) => b.match.length - a.match.length)[0];
  return prefix?.category ?? null;
}

/** A lead reached confirmation if it ever got to confirmed or any later stage. */
export function isConfirmedOrLater(category: OrderStatusCategory): boolean {
  return (
    category === 'confirmed' || category === 'shipped' || category === 'delivered' || category === 'returned'
  );
}
