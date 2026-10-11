import {
  addDays,
  type Currency,
  isConfirmedOrLater,
  type OrderStatusCategory,
  type SignalAdDay,
  type SignalInput,
  type SignalOrder,
  type SignalProduct,
} from '@7sebeti/domain';

/**
 * Boutiques fictives pour le banc d'essai du brief (MOH-11). Rien ne vient d'une vraie base :
 * produits, agents et commandes sont tirés au sort à partir d'une graine, donc deux exécutions
 * avec la même graine produisent les mêmes signaux et les mêmes payloads.
 *
 * Chaque boutique reçoit quelques situations (pub à couper, rupture proche, zone faible…) qui
 * orientent les données ; les signaux eux-mêmes sont ensuite calculés par `computeSignals`,
 * exactement comme en production.
 */

export const BENCH_AS_OF = '2026-10-21';

export const SITUATIONS = {
  confirmation_basse: 'confirmation basse',
  agent_faible: 'agent faible',
  leads_non_traites: 'leads non traités',
  pub_a_couper: 'pub à couper',
  pub_sans_achat: 'pub sans achat',
  pub_a_scaler: 'pub à scaler',
  fatigue: 'fatigue créative',
  cout_manquant: 'coût manquant',
  cpl_eleve: 'CPL trop élevé',
  livraison_basse: 'livraison basse',
  zone_faible: 'zone faible',
  transporteur_faible: 'transporteur faible',
  rupture: 'rupture proche',
  stock_dormant: 'stock dormant',
  perte_du_mois: 'produit en perte',
} as const;

export type Situation = keyof typeof SITUATIONS;

const SHOP_SITUATIONS: readonly Situation[] = [
  'agent_faible',
  'leads_non_traites',
  'zone_faible',
  'transporteur_faible',
];
const PRODUCT_SITUATIONS = (Object.keys(SITUATIONS) as Situation[]).filter(
  (s) => !SHOP_SITUATIONS.includes(s),
);

export interface BenchScenario {
  id: string;
  /** Situations injectées, en clair, pour lire le rapport. */
  situations: string[];
  currency: Currency;
  input: SignalInput;
}

const PRODUCT_NAMES = [
  'Brosse lissante',
  'Montre connectée',
  'Gaine amincissante',
  'Lampe solaire',
  'Mixeur portable',
  'Sac à dos antivol',
  'Sérum capillaire',
  'Tapis de prière pliable',
  'Robot nettoyeur',
  'Écouteurs sans fil',
  'Coffret parfum',
  'Ceinture lombaire',
  'Hachoir électrique',
  'Organiseur de cuisine',
  'Projecteur LED',
];
const AGENTS = ['Salma', 'Youssef', 'Amira', 'Karim', 'Nour', 'Hichem', 'Ines', 'Walid'];
const GOVERNORATES = ['Tunis', 'Ariana', 'Ben Arous', 'Sfax', 'Sousse', 'Nabeul', 'Monastir', 'Bizerte'];
const CARRIERS = ['Dropo', 'Cosmos'];
const PRICES_TND = [39, 49, 59, 69, 79, 89, 99, 119, 129];

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const sample = <T>(xs: readonly T[], n: number): T[] => {
    const pool = [...xs];
    const out: T[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0] as T);
    return out;
  };
  return { next, between, int, pick, sample, chance: (p: number) => next() < p };
}

type Rng = ReturnType<typeof rng>;

interface ProductPlan {
  product: SignalProduct;
  situations: Set<Situation>;
  dailyLeads: number;
  confirmRate: number;
  deliveryRate: number;
}

const UNTREATED: readonly OrderStatusCategory[] = ['pending', 'no_answer', 'callback'];

function planProduct(r: Rng, id: string, name: string, situations: Set<Situation>): ProductPlan {
  const price = r.pick(PRICES_TND) * 1000;
  const dormant = situations.has('stock_dormant');
  const tracked = dormant || situations.has('rupture') || r.chance(0.5);
  return {
    product: {
      id,
      name,
      sellingPriceMinor: price,
      unitCostMinor: situations.has('cout_manquant')
        ? null
        : Math.round((price * r.between(0.22, 0.35)) / 100) * 100,
      packagingPerOrderMinor: 1_500,
      deliveryCostMinor: 7_000,
      returnCostMinor: 5_000,
      // Le stock réel est fixé après les commandes, à partir des ventes tirées.
      stockQty: tracked ? 0 : null,
      restockLeadTimeDays: tracked ? r.int(8, 18) : null,
      targetConfirmRatePct: r.chance(0.3) ? r.pick([55, 60, 65]) : null,
    },
    situations,
    dailyLeads: dormant ? 0 : situations.has('cpl_eleve') ? r.int(3, 5) : r.int(5, 14),
    confirmRate: situations.has('confirmation_basse') ? r.between(0.25, 0.42) : r.between(0.68, 0.8),
    deliveryRate: situations.has('livraison_basse') ? r.between(0.45, 0.6) : r.between(0.8, 0.9),
  };
}

function contribution(p: SignalProduct): number {
  return p.sellingPriceMinor - (p.unitCostMinor ?? 0) - p.packagingPerOrderMinor - p.deliveryCostMinor;
}

export function generateScenario(seed: number): BenchScenario {
  const r = rng(seed);
  const shop = new Set(r.sample(SHOP_SITUATIONS, r.chance(0.6) ? 1 : r.int(0, 2)));
  const agents = r.sample(AGENTS, r.int(2, 4));
  const weakAgent = agents[0] as string;
  const weakZone = r.pick(GOVERNORATES);
  const weakCarrier = r.pick(CARRIERS);

  const names = r.sample(PRODUCT_NAMES, r.int(2, 5));
  const productSituations = r.sample(PRODUCT_SITUATIONS, r.int(1, Math.min(3, names.length + 1)));
  const perProduct = names.map(() => new Set<Situation>());
  for (const s of productSituations) perProduct[r.int(0, names.length - 1)]?.add(s);
  const plans = names.map((name, i) => planProduct(r, `p${i + 1}`, name, perProduct[i] as Set<Situation>));

  const orders: SignalOrder[] = [];
  for (const plan of plans) {
    for (let age = 1; age <= 30; age++) {
      const date = addDays(BENCH_AS_OF, -age);
      const n = Math.round(plan.dailyLeads * r.between(0.7, 1.3));
      for (let k = 0; k < n; k++) {
        const agent = r.pick(agents);
        const governorate = r.chance(0.05)
          ? null
          : shop.has('zone_faible') && r.chance(0.25)
            ? weakZone
            : r.pick(GOVERNORATES);
        const carrier = r.pick(CARRIERS);
        let confirm = plan.confirmRate;
        if (shop.has('agent_faible') && agent === weakAgent) confirm *= 0.45;
        if (age === 1 && shop.has('leads_non_traites')) confirm *= 0.4;
        let deliver = plan.deliveryRate;
        if (shop.has('agent_faible') && agent === weakAgent) deliver -= 0.35;
        if (shop.has('zone_faible') && governorate === weakZone) deliver -= 0.35;
        if (shop.has('transporteur_faible') && carrier === weakCarrier) deliver -= 0.3;

        let status: OrderStatusCategory;
        if (r.chance(confirm)) {
          status =
            age <= 2 ? 'confirmed' : age <= 4 ? 'shipped' : r.chance(deliver) ? 'delivered' : 'returned';
        } else {
          const untreatedShare = age === 1 ? (shop.has('leads_non_traites') ? 1 : 0.2) : age === 2 ? 0.3 : 0;
          status = r.chance(untreatedShare) ? r.pick(UNTREATED) : 'refused';
        }
        orders.push({
          date,
          productId: plan.product.id,
          quantity: r.chance(0.1) ? 2 : 1,
          status,
          agent,
          governorate,
          carrier,
        });
      }
    }
  }

  for (const plan of plans) {
    const p = plan.product;
    if (p.stockQty === null) continue;
    const sold7 = orders
      .filter(
        (o) => o.productId === p.id && o.date >= addDays(BENCH_AS_OF, -7) && isConfirmedOrLater(o.status),
      )
      .reduce((s, o) => s + o.quantity, 0);
    const perDay = sold7 / 7;
    const lead = p.restockLeadTimeDays ?? 10;
    p.stockQty = plan.situations.has('stock_dormant')
      ? r.int(120, 400)
      : plan.situations.has('rupture')
        ? Math.max(1, Math.round(perDay * r.between(2, lead - 1)))
        : Math.round(perDay * r.between(lead + 8, 60));
  }

  const adDays: SignalAdDay[] = [];
  plans.forEach((plan, i) => {
    if (plan.dailyLeads === 0) return;
    const p = plan.product;
    const s = plan.situations;
    const contrib = Math.max(contribution(p), 5_000);
    const leadsOn = (date: string) => orders.filter((o) => o.productId === p.id && o.date === date).length;
    const adId = `a${i + 1}`;
    const adName = `${p.name} : ${r.pick(['vidéo témoignage', 'carrousel promo', 'avant-après', 'offre -20 %'])}`;
    const cpm = r.between(8_000, 15_000);
    const ctr = r.between(0.012, 0.02);
    const frequency = r.between(1.4, 1.9);
    // Toutes les pubs couvrent le mois en cours, pour que R1 voie leur dépense.
    for (let age = 1; age <= 20; age++) {
      const date = addDays(BENCH_AS_OF, -age);
      let purchases = Math.max(0, Math.round(plan.dailyLeads * 0.25 * r.between(0.7, 1.3)));
      let cpa = contrib * r.between(0.85, 1.25);
      let dayCpm = cpm;
      let dayCtr = ctr;
      let dayFrequency = frequency;
      if (s.has('pub_a_scaler')) cpa = contrib * r.between(0.4, 0.6);
      if (s.has('pub_a_couper')) cpa = contrib * r.between(1.9, 2.6);
      if (s.has('fatigue')) {
        cpa = contrib * 0.9;
        dayFrequency = 2.9;
        if (age <= 3) {
          cpa *= 1.6;
          dayCpm *= 1.35;
          dayCtr *= 0.65;
        }
      }
      let spend = purchases * cpa;
      if (s.has('pub_sans_achat')) {
        purchases = 0;
        spend = contrib * r.between(0.4, 0.8);
      }
      if (s.has('cpl_eleve')) {
        const breakEven = contrib * plan.confirmRate * plan.deliveryRate;
        spend = Math.max(leadsOn(date), 1) * breakEven * r.between(1.4, 1.9);
        purchases = Math.round(leadsOn(date) * 0.4);
      }
      if (s.has('perte_du_mois')) spend = Math.max(spend, contrib * plan.dailyLeads * r.between(0.7, 0.95));
      if (spend === 0) spend = contrib * 0.3;
      const impressions = Math.round((spend / dayCpm) * 1000);
      adDays.push({
        date,
        adId,
        adName,
        productId: p.id,
        spendMinor: Math.round(spend),
        impressions,
        reach: Math.round(impressions / dayFrequency),
        linkClicks: Math.round(impressions * dayCtr),
        purchases,
      });
    }
  });

  const situations = [...shop, ...productSituations].map((x) => SITUATIONS[x]);
  return {
    id: `b${String(seed).padStart(3, '0')}`,
    situations,
    currency: 'TND',
    input: { asOf: BENCH_AS_OF, products: plans.map((p) => p.product), orders, adDays },
  };
}

/** Quarante boutiques par défaut (graines 1 à 40) : assez pour le test de MOH-11, reproductible. */
export function generateBenchScenarios(count = 40, startSeed = 1): BenchScenario[] {
  return Array.from({ length: count }, (_, i) => generateScenario(startSeed + i));
}
