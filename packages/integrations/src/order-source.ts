/**
 * Contract every order source implements (Converty API, Converty Google Sheets,
 * CSV import, an official partner API later). The rest of the app only sees
 * NormalizedOrder, so swapping the transport never touches business code.
 */
export interface NormalizedOrderLine {
  externalProductKey: string;
  productName: string | null;
  quantity: number;
  /** Unit price in major units as sent by the source; converted to minor units on write. */
  unitPrice: number | null;
  isUpsell: boolean;
}

export interface NormalizedOrderEvent {
  sourceStatus: string;
  attempt: number | null;
  actor: string | null;
  occurredAt: Date;
}

export interface NormalizedOrder {
  externalId: string;
  sourceStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  city: string | null;
  total: number | null;
  deliveryFee: number | null;
  isTest: boolean;
  lines: NormalizedOrderLine[];
  events: NormalizedOrderEvent[];
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
}

export interface OrderSource {
  readonly provider: string;
  /** Parse an inbound webhook body. Returns null when the payload is not an order. */
  parseWebhook(body: unknown): NormalizedOrder | null;
  /** Incremental pull used for backfill and daily reconciliation. */
  fetchOrdersSince?(since: Date, credentials: string): AsyncIterable<NormalizedOrder>;
}
