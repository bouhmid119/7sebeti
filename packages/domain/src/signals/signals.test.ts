import { describe, expect, it } from 'vitest';
import type { OrderStatusCategory } from '../order-status';
import {
  addDays,
  computeSignals,
  contributionMinor,
  type Signal,
  type SignalAdDay,
  type SignalOrder,
  type SignalProduct,
} from './signals';

const AS_OF = '2026-10-20';

function product(over: Partial<SignalProduct> = {}): SignalProduct {
  return {
    id: 'P1',
    name: 'Brosse lissante',
    sellingPriceMinor: 69_000,
    unitCostMinor: 18_000,
    packagingPerOrderMinor: 1_500,
    deliveryCostMinor: 8_000,
    returnCostMinor: 4_000,
    stockQty: 500,
    restockLeadTimeDays: null,
    targetConfirmRatePct: null,
    ...over,
  };
}

/** n commandes d'un même jour (daysAgo jours avant AS_OF). */
function orders(
  n: number,
  daysAgo: number,
  status: OrderStatusCategory,
  over: Partial<SignalOrder> = {},
): SignalOrder[] {
  return Array.from({ length: n }, () => ({
    date: addDays(AS_OF, -daysAgo),
    productId: 'P1',
    quantity: 1,
    status,
    agent: null,
    governorate: null,
    carrier: null,
    ...over,
  }));
}

function adDays(days: number, over: Partial<SignalAdDay> = {}): SignalAdDay[] {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(AS_OF, -(i + 1)),
    adId: 'A1',
    adName: 'Pub A1',
    productId: 'P1',
    spendMinor: 40_000,
    impressions: 9_000,
    reach: 6_000,
    linkClicks: 160,
    purchases: 2,
    ...over,
  }));
}

const ids = (signals: Signal[]) => signals.map((s) => s.id);
const find = (signals: Signal[], id: string) => {
  const s = signals.find((x) => x.id === id);
  if (!s) throw new Error(`signal ${id} absent : ${ids(signals).join(', ')}`);
  return s;
};

describe('contributionMinor', () => {
  it('soustrait coût, emballage et livraison du prix', () => {
    expect(contributionMinor(product())).toBe(41_500);
  });
  it('renvoie null sans coût ou avec une marge négative', () => {
    expect(contributionMinor(product({ unitCostMinor: null }))).toBeNull();
    expect(contributionMinor(product({ unitCostMinor: 70_000 }))).toBeNull();
  });
});

describe('computeSignals', () => {
  it('ne renvoie rien sans données', () => {
    expect(computeSignals({ asOf: AS_OF, products: [], orders: [], adDays: [] })).toEqual([]);
  });

  it('C1 : leads de la veille non traités, chiffre d affaires en jeu', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product()],
      orders: [...orders(3, 1, 'pending'), ...orders(2, 1, 'callback'), ...orders(4, 1, 'confirmed')],
      adDays: [],
    });
    const c1 = find(s, 'C1');
    expect(c1.figures).toMatchObject({ commandes: 5, parStatut: { pending: 3, callback: 2 } });
    expect(c1.stakeMinor).toBe(5 * 69_000);
  });

  it('C1 : rien sous le seuil, et les commandes supprimées sont ignorées', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product()],
      orders: [...orders(4, 1, 'pending'), ...orders(3, 1, 'ignored')],
      adDays: [],
    });
    expect(ids(s)).not.toContain('C1');
  });

  it('C2 : confirmation sous l objectif du produit', () => {
    // 20 leads sur 7 jours, 8 confirmés (40 %) pour un objectif de 60 %.
    const s = computeSignals({
      asOf: AS_OF,
      products: [product()],
      orders: [...orders(8, 3, 'shipped'), ...orders(12, 3, 'refused')],
      adDays: [],
    });
    const c2 = find(s, 'C2');
    expect(c2.figures).toMatchObject({ tauxPct: 40, objectifPct: 60, leads: 20, commandesManquees: 4 });
    expect(c2.stakeMinor).toBe(4 * 41_500);
  });

  it('C3 et C4 : agent sous ses objectifs et avec trop de retours', () => {
    const agent = { agent: 'Sami' };
    const s = computeSignals({
      asOf: AS_OF,
      products: [product()],
      orders: [
        ...orders(6, 2, 'delivered', agent),
        ...orders(6, 2, 'returned', agent),
        ...orders(18, 2, 'refused', agent),
      ],
      adDays: [],
    });
    expect(find(s, 'C3').figures).toMatchObject({ tauxPct: 40, confirmeesParJour: 1.7 });
    expect(find(s, 'C4').figures).toMatchObject({ tauxRetourPct: 50, colis: 12 });
  });

  it('P1 : pub qui dépense sans commande', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product()],
      orders: [],
      adDays: adDays(7, { purchases: 0, spendMinor: 30_000 }),
    });
    const p1 = find(s, 'P1');
    expect(p1.subject).toMatchObject({ adId: 'A1', product: 'Brosse lissante' });
    expect(p1.figures).toMatchObject({
      depenseMinor: 210_000,
      achats: 0,
      cpaMinor: null,
      cpaCibleMinor: 41_500,
    });
    expect(p1.stakeMinor).toBe(210_000);
  });

  it('P2 : pub rentable à scaler, avec le plafond quotidien', () => {
    // 7 x 40 DT pour 14 achats : CPA 20 DT, sous 0,7 x 41,5 DT.
    const s = computeSignals({ asOf: AS_OF, products: [product()], orders: [], adDays: adDays(7) });
    const p2 = find(s, 'P2');
    expect(p2.figures).toMatchObject({
      cpaMinor: 20_000,
      depenseParJourMinor: 40_000,
      plafondParJourMinor: 558_000,
    });
    expect(p2.stakeMinor).toBe(14 * (41_500 - 20_000));
  });

  it('P3 : fatigue créative, et pas de scale sur une pub fatiguée', () => {
    const days = adDays(14).map((d, i) =>
      i < 3
        ? { ...d, spendMinor: 70_000, impressions: 7_000, reach: 1_000, linkClicks: 60, purchases: 1 }
        : d,
    );
    const s = computeSignals({ asOf: AS_OF, products: [product()], orders: [], adDays: days });
    expect(find(s, 'P3').figures.signaux).toEqual(
      expect.arrayContaining(['CTR en baisse', 'CPM en hausse', 'CPA en hausse', 'ROAS en baisse']),
    );
    expect(ids(s)).not.toContain('P2');
  });

  it('P5 : pub sur un produit sans coût d achat', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product({ unitCostMinor: null, stockQty: 0 })],
      orders: [],
      adDays: adDays(7),
    });
    expect(ids(s)).toEqual(['P5']);
  });

  it('P4 : CPL au-dessus du break-even trois jours de suite', () => {
    // 20 leads sur 14 jours, 10 confirmés, 8 livrés sur 10 : break-even = 41,5 x 0,5 x 0,8 = 16,6 DT.
    const funnel = [
      ...orders(8, 10, 'delivered'),
      ...orders(2, 10, 'returned'),
      ...orders(7, 10, 'refused'),
      ...orders(1, 1, 'refused'),
      ...orders(1, 2, 'refused'),
      ...orders(1, 3, 'refused'),
    ];
    const ads = adDays(3, { spendMinor: 30_000, purchases: 0 });
    const s = computeSignals({ asOf: AS_OF, products: [product()], orders: funnel, adDays: ads });
    const p4 = find(s, 'P4');
    expect(p4.figures).toMatchObject({
      cplParJourMinor: [30_000, 30_000, 30_000],
      cplBreakEvenMinor: 16_600,
    });
    expect(p4.stakeMinor).toBe(3 * (30_000 - 16_600));
  });

  it('L1 et L2 : livraison faible par produit, zone et transporteur', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product()],
      orders: [
        ...orders(20, 5, 'delivered', { governorate: 'Tunis', carrier: 'Dropo' }),
        ...orders(5, 5, 'returned', { governorate: 'Tunis', carrier: 'Dropo' }),
        ...orders(8, 5, 'delivered', { governorate: 'Kasserine', carrier: 'Cosmos' }),
        ...orders(12, 5, 'returned', { governorate: 'Kasserine', carrier: 'Cosmos' }),
      ],
      adDays: [],
    });
    expect(find(s, 'L1').figures).toMatchObject({ tauxLivraisonPct: 62.2, colis: 45 });
    expect(find(s, 'L1').stakeMinor).toBe(17 * 4_000);
    const zones = s.filter((x) => x.id === 'L2');
    expect(zones.map((z) => z.subject)).toEqual([{ governorate: 'Kasserine' }, { carrier: 'Cosmos' }]);
    expect(zones[0]?.figures).toMatchObject({ tauxPct: 40, moyennePct: 62.2, colis: 20 });
  });

  it('S1 : rupture avant l arrivée du réappro', () => {
    // 70 vendus sur 7 jours = 10 par jour, 60 en stock = 6 jours, délai 12 jours.
    const s = computeSignals({
      asOf: AS_OF,
      products: [product({ stockQty: 60, restockLeadTimeDays: 12 })],
      orders: orders(70, 2, 'confirmed'),
      adDays: [],
    });
    const s1 = find(s, 'S1');
    expect(s1.figures).toMatchObject({
      stock: 60,
      ventesParJour: 10,
      joursDeStock: 6,
      delaiReapproJours: 12,
    });
    expect(s1.stakeMinor).toBe(10 * 6 * 41_500);
  });

  it('S1 : pas d alerte sans délai de réappro renseigné', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product({ stockQty: 60 })],
      orders: orders(70, 2, 'confirmed'),
      adDays: [],
    });
    expect(ids(s)).not.toContain('S1');
  });

  it('S2 : stock dormant', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product({ stockQty: 300 })],
      orders: orders(5, 30, 'delivered'),
      adDays: [],
    });
    expect(find(s, 'S2').figures).toMatchObject({
      stock: 300,
      joursSansVente: 30,
      valeurStockMinor: 5_400_000,
    });
  });

  it('R1 : produit en perte depuis le début du mois', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product({ stockQty: 0 })],
      orders: [...orders(2, 5, 'delivered'), ...orders(3, 5, 'returned')],
      adDays: adDays(7, { purchases: 0, spendMinor: 30_000 }),
    });
    const r1 = find(s, 'R1');
    expect(r1.figures).toMatchObject({ livrees: 2, retours: 3, pubMinor: 210_000 });
    expect(r1.figures.margeMoisMinor).toBe(2 * 41_500 - 3 * 4_000 - 210_000);
  });

  it('R1 : pas de jugement en tout début de mois', () => {
    const s = computeSignals({
      asOf: '2026-10-03',
      products: [product({ stockQty: 0 })],
      orders: [],
      adDays: adDays(2, { date: '2026-10-01', purchases: 0 }),
    });
    expect(ids(s)).not.toContain('R1');
  });

  it('classe par argent en jeu, en montants entiers', () => {
    const s = computeSignals({
      asOf: AS_OF,
      products: [product({ stockQty: 60, restockLeadTimeDays: 12 })],
      orders: [...orders(70, 2, 'confirmed'), ...orders(5, 1, 'pending')],
      adDays: [],
    });
    expect(ids(s).slice(0, 2)).toEqual(['S1', 'C1']);
    for (const x of s) expect(Number.isInteger(x.stakeMinor)).toBe(true);
    const stakes = s.map((x) => x.stakeMinor);
    expect(stakes).toEqual([...stakes].sort((a, b) => b - a));
  });
});
