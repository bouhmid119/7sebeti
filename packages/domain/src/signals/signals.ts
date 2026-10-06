import { isConfirmedOrLater, type OrderStatusCategory } from '../order-status';
import { DEFAULT_SIGNAL_THRESHOLDS, type SignalThresholds } from './thresholds';

/**
 * Signaux « Actions à prendre » : le code calcule, l'IA explique.
 * Fonctions pures, sans I/O ni appel à un modèle. Le job de brief du worker charge les
 * données d'une organisation, appelle `computeSignals`, puis demande au modèle de
 * classer et formuler les signaux, sans jamais inventer un chiffre.
 *
 * Montants en unités mineures (millimes pour le TND). Dates au format AAAA-MM-JJ,
 * dans le fuseau de l'organisation.
 */

export interface SignalProduct {
  id: string;
  name: string;
  sellingPriceMinor: number;
  /** null si le coût d'achat n'est pas renseigné : la marge est alors inconnue (signal P5). */
  unitCostMinor: number | null;
  packagingPerOrderMinor: number;
  /** Frais de livraison d'un colis livré. */
  deliveryCostMinor: number;
  /** Frais d'un colis retourné. */
  returnCostMinor: number;
  /** null tant que le stock n'est pas suivi : S1 et S2 sont alors ignorés. */
  stockQty: number | null;
  restockLeadTimeDays: number | null;
  targetConfirmRatePct: number | null;
}

export interface SignalOrder {
  date: string;
  productId: string;
  quantity: number;
  status: OrderStatusCategory;
  agent: string | null;
  governorate: string | null;
  carrier: string | null;
}

export interface SignalAdDay {
  date: string;
  adId: string;
  adName: string;
  productId: string;
  spendMinor: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  purchases: number;
}

export type SignalId =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'
  | 'L1'
  | 'L2'
  | 'S1'
  | 'S2'
  | 'R1';

export type SignalDomain = 'confirmation' | 'pub' | 'stock' | 'livraison' | 'rentabilite';

export type SignalFigure =
  | number
  | string
  | null
  | ReadonlyArray<number | string | null>
  | Record<string, number>;

export interface Signal {
  id: SignalId;
  domain: SignalDomain;
  title: string;
  /** Ce dont parle le signal : produit, pub, agent, zone ou transporteur. */
  subject: {
    productId?: string;
    product?: string;
    adId?: string;
    ad?: string;
    agent?: string;
    governorate?: string;
    carrier?: string;
  };
  /** Les seuls chiffres que le modèle a le droit de citer. Clés en *Minor = montants. */
  figures: Record<string, SignalFigure>;
  threshold: string;
  /** Argent en jeu, en unités mineures : sert au classement. 0 si non chiffrable. */
  stakeMinor: number;
  link: string;
}

export interface SignalInput {
  /** Jour du brief : les fenêtres couvrent les jours strictement avant cette date. */
  asOf: string;
  products: readonly SignalProduct[];
  orders: readonly SignalOrder[];
  adDays: readonly SignalAdDay[];
}

const UNTREATED: ReadonlySet<OrderStatusCategory> = new Set(['pending', 'no_answer', 'callback']);
const DOMAIN_ORDER: Record<SignalDomain, number> = {
  confirmation: 0,
  pub: 1,
  stock: 2,
  livraison: 3,
  rentabilite: 4,
};

const DAY_MS = 86_400_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Marge d'une commande livrée avant pub (le CPA de break-even de la v1), ou null si inconnue. */
export function contributionMinor(p: SignalProduct): number | null {
  if (p.unitCostMinor === null) return null;
  const c = p.sellingPriceMinor - p.unitCostMinor - p.packagingPerOrderMinor - p.deliveryCostMinor;
  return c > 0 ? c : null;
}

function pct(num: number, den: number): number | null {
  return den ? (100 * num) / den : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function counter<K>() {
  const m = new Map<K, number>();
  return {
    add: (k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n),
    get: (k: K) => m.get(k) ?? 0,
  };
}

export function computeSignals(
  input: SignalInput,
  t: SignalThresholds = DEFAULT_SIGNAL_THRESHOLDS,
): Signal[] {
  const { asOf } = input;
  const orders = input.orders.filter((o) => o.status !== 'ignored');
  const products = new Map(input.products.map((p) => [p.id, p]));
  const inWindow = (day: string, days: number) => day >= addDays(asOf, -days) && day < asOf;
  const productSubject = (id: string) => ({ productId: id, product: products.get(id)?.name ?? id });
  const signals: Signal[] = [
    ...confirmationSignals(),
    ...adSignals(),
    ...cplSignals(),
    ...deliverySignals(),
    ...stockSignals(),
    ...monthSignals(),
  ];

  for (const s of signals) s.stakeMinor = Math.max(0, Math.round(s.stakeMinor));
  return signals.sort(
    (a, b) => b.stakeMinor - a.stakeMinor || DOMAIN_ORDER[a.domain] - DOMAIN_ORDER[b.domain],
  );

  // Funnel par produit sur la fenêtre livraison, partagé par P4 et L1.
  function funnel() {
    const f = new Map<string, { leads: number; confirmed: number; delivered: number; returned: number }>();
    for (const o of orders) {
      if (!inWindow(o.date, t.deliveryWindowDays)) continue;
      const row = f.get(o.productId) ?? { leads: 0, confirmed: 0, delivered: 0, returned: 0 };
      row.leads += 1;
      if (isConfirmedOrLater(o.status)) row.confirmed += 1;
      if (o.status === 'delivered') row.delivered += 1;
      if (o.status === 'returned') row.returned += 1;
      f.set(o.productId, row);
    }
    return f;
  }

  function confirmationSignals(): Signal[] {
    const out: Signal[] = [];

    // C1 : leads de la veille non traités.
    const yesterday = addDays(asOf, -1);
    const untreated = orders.filter((o) => o.date === yesterday && UNTREATED.has(o.status));
    if (untreated.length >= t.c1MinUntreated) {
      const byStatus: Record<string, number> = {};
      let stake = 0;
      for (const o of untreated) {
        byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
        stake += (products.get(o.productId)?.sellingPriceMinor ?? 0) * o.quantity;
      }
      out.push({
        id: 'C1',
        domain: 'confirmation',
        title: 'Leads de la veille non traités',
        subject: {},
        figures: { commandes: untreated.length, parStatut: byStatus, chiffreAffairesEnJeuMinor: stake },
        threshold: `au moins ${t.c1MinUntreated}`,
        stakeMinor: stake,
        link: '/confirmation?jour=hier&statut=non-traite',
      });
    }

    // C2 : confirmation sous l'objectif du produit.
    const leads = counter<string>();
    const confirmed = counter<string>();
    for (const o of orders) {
      if (!inWindow(o.date, t.confirmWindowDays)) continue;
      leads.add(o.productId);
      if (isConfirmedOrLater(o.status)) confirmed.add(o.productId);
    }
    for (const p of input.products) {
      const n = leads.get(p.id);
      const rate = pct(confirmed.get(p.id), n);
      const target = p.targetConfirmRatePct ?? t.defaultConfirmRatePct;
      if (n < t.minLeads || rate === null || rate >= target) continue;
      const missed = ((target - rate) / 100) * n;
      out.push({
        id: 'C2',
        domain: 'confirmation',
        title: "Confirmation sous l'objectif",
        subject: productSubject(p.id),
        figures: {
          tauxPct: round1(rate),
          objectifPct: target,
          leads: n,
          jours: t.confirmWindowDays,
          commandesManquees: Math.round(missed),
        },
        threshold: `objectif ${target} %`,
        stakeMinor: missed * (contributionMinor(p) ?? 0),
        link: `/confirmation?produit=${p.id}`,
      });
    }

    // C3 / C4 : agents.
    const agents = new Map<string, { leads: number; confirmed: number; closed: number; returned: number }>();
    for (const o of orders) {
      if (!o.agent || !inWindow(o.date, t.confirmWindowDays)) continue;
      const a = agents.get(o.agent) ?? { leads: 0, confirmed: 0, closed: 0, returned: 0 };
      a.leads += 1;
      if (isConfirmedOrLater(o.status)) a.confirmed += 1;
      if (o.status === 'delivered' || o.status === 'returned') a.closed += 1;
      if (o.status === 'returned') a.returned += 1;
      agents.set(o.agent, a);
    }
    for (const [agent, a] of agents) {
      const rate = pct(a.confirmed, a.leads) ?? 0;
      const perDay = a.confirmed / t.confirmWindowDays;
      if (a.leads >= t.minLeads && (rate < t.agentConfirmRatePct || perDay < t.agentDailyConfirmed)) {
        out.push({
          id: 'C3',
          domain: 'confirmation',
          title: 'Agent sous ses objectifs',
          subject: { agent },
          figures: { tauxPct: round1(rate), confirmeesParJour: round1(perDay) },
          threshold: `${t.agentConfirmRatePct} % et ${t.agentDailyConfirmed} par jour`,
          stakeMinor: 0,
          link: `/agents/${encodeURIComponent(agent)}`,
        });
      }
      const returnRate = pct(a.returned, a.closed);
      if (a.closed >= t.agentMinClosedParcels && returnRate !== null && returnRate > t.agentReturnRatePct) {
        out.push({
          id: 'C4',
          domain: 'confirmation',
          title: 'Agent avec trop de retours',
          subject: { agent },
          figures: { tauxRetourPct: round1(returnRate), colis: a.closed },
          threshold: `${t.agentReturnRatePct} %`,
          stakeMinor: 0,
          link: `/agents/${encodeURIComponent(agent)}`,
        });
      }
    }
    return out;
  }

  function adSignals(): Signal[] {
    const out: Signal[] = [];
    const byAd = new Map<string, SignalAdDay[]>();
    for (const d of input.adDays) byAd.set(d.adId, [...(byAd.get(d.adId) ?? []), d]);

    for (const [adId, days] of byAd) {
      const first = days[0];
      if (!first) continue;
      const p = products.get(first.productId);
      const win = days.filter((d) => inWindow(d.date, t.adWindowDays));
      const spend = win.reduce((s, d) => s + d.spendMinor, 0);
      const purchases = win.reduce((s, d) => s + d.purchases, 0);
      if (spend <= 0) continue;
      const subject = { ...productSubject(first.productId), adId, ad: first.adName };
      const link = `/marketing/ads/${adId}`;
      const target = p ? contributionMinor(p) : null;

      if (target === null) {
        out.push({
          id: 'P5',
          domain: 'pub',
          title: 'Coûts manquants',
          subject,
          figures: { depenseMinor: spend, jours: t.adWindowDays },
          threshold: "coût d'achat requis",
          stakeMinor: 0,
          link: `/produits/${first.productId}`,
        });
        continue;
      }

      const cpa = purchases ? spend / purchases : null;
      const fatigue = fatigueSignals(days, p?.sellingPriceMinor ?? 0);
      const tired = fatigue.length >= t.fatigueMinSignals;
      let bucket: 'cut' | 'scale' | null = null;
      if (cpa === null) {
        if (spend >= target * t.adCutNoOrderRatio) bucket = 'cut';
      } else if (cpa / target > t.adCutRatio) {
        bucket = 'cut';
      } else if (cpa / target <= t.adScaleRatio && purchases >= t.adScaleMinPurchases && !tired) {
        bucket = 'scale';
      }

      if (cpa !== null && tired) {
        out.push({
          id: 'P3',
          domain: 'pub',
          title: 'Fatigue créative',
          subject,
          figures: { signaux: fatigue },
          threshold: `${t.fatigueMinSignals} signaux sur 5`,
          // Approximation : un cinquième du budget de la semaine part en pure perte.
          stakeMinor: spend * 0.2,
          link,
        });
      }

      const figures = {
        depenseMinor: spend,
        jours: t.adWindowDays,
        achats: purchases,
        cpaMinor: cpa === null ? null : Math.round(cpa),
        cpaCibleMinor: target,
      };
      if (bucket === 'cut') {
        out.push({
          id: 'P1',
          domain: 'pub',
          title: 'Pub à couper',
          subject,
          figures,
          threshold: `CPA au-dessus de ${t.adCutRatio} fois la cible, ou ${t.adCutNoOrderRatio} fois la cible dépensés sans commande`,
          stakeMinor: spend - purchases * target,
          link,
        });
      } else if (bucket === 'scale' && cpa !== null) {
        out.push({
          id: 'P2',
          domain: 'pub',
          title: 'Pub à scaler',
          subject,
          figures: {
            ...figures,
            depenseParJourMinor: Math.round(spend / t.adWindowDays),
            plafondParJourMinor: t.adDailyCapMinor,
          },
          threshold: `CPA sous ${t.adScaleRatio} fois la cible et au moins ${t.adScaleMinPurchases} achats`,
          stakeMinor: purchases * (target - cpa),
          link,
        });
      }
    }
    return out;
  }

  /** Signaux de fatigue de la v1 : 3 derniers jours comparés aux jours 4 à 14. */
  function fatigueSignals(days: readonly SignalAdDay[], priceMinor: number): string[] {
    const agg = (lo: number, hi: number) => {
      const rows = days.filter((d) => d.date >= addDays(asOf, -hi) && d.date < addDays(asOf, -lo));
      const sum = (k: 'impressions' | 'linkClicks' | 'spendMinor' | 'purchases' | 'reach') =>
        rows.reduce((s, r) => s + r[k], 0);
      const imp = sum('impressions');
      const spend = sum('spendMinor');
      const purchases = sum('purchases');
      const reach = sum('reach');
      return {
        n: rows.length,
        ctr: imp ? sum('linkClicks') / imp : 0,
        cpm: imp ? (spend / imp) * 1000 : 0,
        cpa: purchases ? spend / purchases : null,
        roas: spend ? (purchases * priceMinor) / spend : 0,
        frequency: reach ? imp / reach : 0,
      };
    };
    const recent = agg(0, 3);
    const base = agg(3, 14);
    const all = agg(0, 14);
    const out: string[] = [];
    if (base.n) {
      if (base.ctr && recent.ctr < base.ctr * t.fatigueCtrDrop) out.push('CTR en baisse');
      if (base.cpm && recent.cpm > base.cpm * t.fatigueCpmRise) out.push('CPM en hausse');
      if (recent.cpa && base.cpa && recent.cpa > base.cpa * t.fatigueCpaRise) out.push('CPA en hausse');
      if (base.roas && recent.roas < base.roas * t.fatigueRoasDrop) out.push('ROAS en baisse');
    }
    if (all.frequency >= t.fatigueFrequency) out.push(`fréquence élevée (${round1(all.frequency)})`);
    return out;
  }

  // P4 : CPL au-dessus du CPL de break-even plusieurs jours de suite.
  function cplSignals(): Signal[] {
    const out: Signal[] = [];
    const f = funnel();
    const spendDay = counter<string>();
    const leadsDay = counter<string>();
    for (const d of input.adDays) spendDay.add(`${d.productId}|${d.date}`, d.spendMinor);
    for (const o of orders) leadsDay.add(`${o.productId}|${o.date}`);

    for (const p of input.products) {
      const row = f.get(p.id);
      const contrib = contributionMinor(p);
      if (!row || contrib === null || row.leads < t.minLeads || !row.confirmed) continue;
      const closed = row.delivered + row.returned;
      const deliveryRate = closed ? row.delivered / closed : t.fallbackDeliveryRatePct / 100;
      const breakEvenCpl = contrib * (row.confirmed / row.leads) * deliveryRate;
      const days = Array.from({ length: t.cplConsecutiveDays }, (_, i) => addDays(asOf, -(i + 1)));
      const perDay = days.map((d) => ({
        spend: spendDay.get(`${p.id}|${d}`),
        leads: leadsDay.get(`${p.id}|${d}`),
      }));
      // Un jour sans dépense ne compte pas ; un jour avec dépense et sans lead est au-dessus.
      const over = perDay.every((d) => d.spend > 0 && (d.leads === 0 || d.spend / d.leads > breakEvenCpl));
      if (!over) continue;
      out.push({
        id: 'P4',
        domain: 'pub',
        title: 'CPL au-dessus du break-even',
        subject: productSubject(p.id),
        figures: {
          // null : dépense sans aucun lead ce jour-là.
          cplParJourMinor: perDay.map((d) => (d.leads ? Math.round(d.spend / d.leads) : null)),
          cplBreakEvenMinor: Math.round(breakEvenCpl),
          jours: t.cplConsecutiveDays,
        },
        threshold: `${t.cplConsecutiveDays} jours de suite`,
        stakeMinor: perDay.reduce((s, d) => s + d.spend - breakEvenCpl * d.leads, 0),
        link: `/marketing?produit=${p.id}`,
      });
    }
    return out;
  }

  function deliverySignals(): Signal[] {
    const out: Signal[] = [];

    // L1 : taux de livraison sous l'objectif, par produit.
    for (const [productId, row] of funnel()) {
      const closed = row.delivered + row.returned;
      const rate = pct(row.delivered, closed);
      if (closed < t.minClosedParcels || rate === null || rate >= t.deliveryRatePct) continue;
      out.push({
        id: 'L1',
        domain: 'livraison',
        title: "Livraison sous l'objectif",
        subject: productSubject(productId),
        figures: { tauxLivraisonPct: round1(rate), colis: closed, jours: t.deliveryWindowDays },
        threshold: `${t.deliveryRatePct} %`,
        stakeMinor: row.returned * (products.get(productId)?.returnCostMinor ?? 0),
        link: `/livraison?produit=${productId}`,
      });
    }

    // L2 : zone ou transporteur nettement sous la moyenne.
    for (const dim of ['governorate', 'carrier'] as const) {
      const delivered = counter<string>();
      const closed = counter<string>();
      const keys = new Set<string>();
      for (const o of orders) {
        if (!inWindow(o.date, t.zoneWindowDays)) continue;
        if (o.status !== 'delivered' && o.status !== 'returned') continue;
        const k = o[dim] ?? '?';
        keys.add(k);
        closed.add(k);
        if (o.status === 'delivered') delivered.add(k);
      }
      const totalClosed = [...keys].reduce((s, k) => s + closed.get(k), 0);
      const avg = pct(
        [...keys].reduce((s, k) => s + delivered.get(k), 0),
        totalClosed,
      );
      if (avg === null) continue;
      for (const k of keys) {
        const n = closed.get(k);
        const rate = pct(delivered.get(k), n);
        if (n < t.minClosedParcels || rate === null || rate >= avg - t.zoneGapPoints) continue;
        out.push({
          id: 'L2',
          domain: 'livraison',
          title: dim === 'governorate' ? 'Zone faible' : 'Transporteur faible',
          subject: { [dim]: k },
          figures: { tauxPct: round1(rate), moyennePct: round1(avg), colis: n, jours: t.zoneWindowDays },
          threshold: `${t.zoneGapPoints} points sous la moyenne`,
          stakeMinor: 0,
          link: `/livraison?${dim}=${encodeURIComponent(k)}`,
        });
      }
    }
    return out;
  }

  function stockSignals(): Signal[] {
    const out: Signal[] = [];
    const sold7 = counter<string>();
    const lastSale = new Map<string, string>();
    for (const o of orders) {
      if (!isConfirmedOrLater(o.status)) continue;
      if (inWindow(o.date, 7)) sold7.add(o.productId, o.quantity);
      const prev = lastSale.get(o.productId);
      if (!prev || o.date > prev) lastSale.set(o.productId, o.date);
    }

    for (const p of input.products) {
      const stock = p.stockQty;
      if (stock === null) continue;
      const sold = sold7.get(p.id);
      if (stock <= 0 && !sold) continue;
      const perDay = sold / 7;
      const daysOfStock = perDay ? stock / perDay : null;
      const lead = p.restockLeadTimeDays;

      // S1 : rupture avant que le réappro n'arrive.
      if (daysOfStock !== null && lead !== null && daysOfStock < lead + t.stockMarginDays) {
        out.push({
          id: 'S1',
          domain: 'stock',
          title: 'Rupture proche',
          subject: productSubject(p.id),
          figures: {
            stock,
            ventesParJour: round1(perDay),
            joursDeStock: round1(daysOfStock),
            delaiReapproJours: lead,
          },
          threshold: `délai de réappro + ${t.stockMarginDays} jours`,
          stakeMinor: perDay * Math.max(lead - daysOfStock, 1) * (contributionMinor(p) ?? 0),
          link: `/stock/${p.id}`,
        });
      }

      // S2 : stock qui dort.
      const last = lastSale.get(p.id);
      const noSaleDays = last ? daysBetween(last, asOf) : null;
      const dormant =
        noSaleDays === null ||
        noSaleDays >= t.dormantNoSaleDays ||
        (daysOfStock !== null && daysOfStock > t.dormantMaxDaysOfStock);
      if (stock > 0 && dormant) {
        out.push({
          id: 'S2',
          domain: 'stock',
          title: 'Stock dormant',
          subject: productSubject(p.id),
          figures: {
            stock,
            joursSansVente: noSaleDays,
            joursDeStock: daysOfStock === null ? null : Math.round(daysOfStock),
            valeurStockMinor: p.unitCostMinor === null ? null : stock * p.unitCostMinor,
          },
          threshold: `${t.dormantNoSaleDays} jours sans vente ou plus de ${t.dormantMaxDaysOfStock} jours de stock`,
          stakeMinor: 0,
          link: `/stock/${p.id}`,
        });
      }
    }
    return out;
  }

  // R1 : produit en perte depuis le début du mois.
  function monthSignals(): Signal[] {
    const monthStart = `${asOf.slice(0, 7)}-01`;
    if (daysBetween(monthStart, asOf) < t.monthMinDays) return [];
    const inMonth = (d: string) => d >= monthStart && d < asOf;
    const out: Signal[] = [];
    for (const p of input.products) {
      const contrib = contributionMinor(p);
      if (contrib === null) continue;
      const month = orders.filter((o) => o.productId === p.id && inMonth(o.date));
      const delivered = month.filter((o) => o.status === 'delivered').length;
      const returned = month.filter((o) => o.status === 'returned').length;
      const adSpend = input.adDays
        .filter((d) => d.productId === p.id && inMonth(d.date))
        .reduce((s, d) => s + d.spendMinor, 0);
      const margin = delivered * contrib - returned * p.returnCostMinor - adSpend;
      if ((!delivered && !adSpend) || margin >= 0) continue;
      out.push({
        id: 'R1',
        domain: 'rentabilite',
        title: 'Produit en perte ce mois',
        subject: productSubject(p.id),
        figures: { margeMoisMinor: margin, livrees: delivered, retours: returned, pubMinor: adSpend },
        threshold: 'marge du mois négative',
        stakeMinor: -margin,
        link: `/pnl?produit=${p.id}`,
      });
    }
    return out;
  }
}
