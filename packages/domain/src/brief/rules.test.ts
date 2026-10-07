import { describe, expect, it } from 'vitest';
import type { Signal, SignalId } from '../signals';
import { unknownNumbers } from './output';
import { prepareBrief } from './payload';
import { briefFromRules, describeSignals } from './rules';
import { presentBrief } from './view';

const AS_OF = '2026-10-20';
const product = { productId: 'p-uuid', product: 'Brosse lissante' };
const ad = { ...product, adId: 'ad-1', ad: 'Vidéo avant/après' };

/** Un signal par code, avec les mêmes clés de chiffres que computeSignals. */
const ALL: Record<SignalId, Signal> = {
  C1: {
    id: 'C1',
    domain: 'confirmation',
    title: 'Leads de la veille non traités',
    subject: {},
    figures: { commandes: 14, parStatut: { pending: 9, no_answer: 5 }, chiffreAffairesEnJeuMinor: 966_000 },
    threshold: 'au moins 5',
    stakeMinor: 966_000,
    link: '/confirmation?jour=hier&statut=non-traite',
  },
  C2: {
    id: 'C2',
    domain: 'confirmation',
    title: "Confirmation sous l'objectif",
    subject: product,
    figures: { tauxPct: 52.5, objectifPct: 70, leads: 120, jours: 7, commandesManquees: 21 },
    threshold: 'objectif 70 %',
    stakeMinor: 871_500,
    link: '/confirmation?produit=p-uuid',
  },
  C3: {
    id: 'C3',
    domain: 'confirmation',
    title: 'Agent sous ses objectifs',
    subject: { agent: 'Yasmine' },
    figures: { tauxPct: 41.2, confirmeesParJour: 6.5 },
    threshold: '60 % et 12 par jour',
    stakeMinor: 0,
    link: '/agents/Yasmine',
  },
  C4: {
    id: 'C4',
    domain: 'confirmation',
    title: 'Agent avec trop de retours',
    subject: { agent: 'Mehdi' },
    figures: { tauxRetourPct: 38, colis: 64 },
    threshold: '25 %',
    stakeMinor: 0,
    link: '/agents/Mehdi',
  },
  P1: {
    id: 'P1',
    domain: 'pub',
    title: 'Pub à couper',
    subject: ad,
    figures: { depenseMinor: 420_000, jours: 7, achats: 0, cpaMinor: null, cpaCibleMinor: 18_500 },
    threshold: 'CPA au-dessus de 1,3 fois la cible',
    stakeMinor: 420_000,
    link: '/marketing/ads/ad-1',
  },
  P2: {
    id: 'P2',
    domain: 'pub',
    title: 'Pub à scaler',
    subject: ad,
    figures: {
      depenseMinor: 350_000,
      jours: 7,
      achats: 41,
      cpaMinor: 8_537,
      cpaCibleMinor: 18_500,
      depenseParJourMinor: 50_000,
      plafondParJourMinor: 150_000,
    },
    threshold: 'CPA sous 0,7 fois la cible',
    stakeMinor: 408_483,
    link: '/marketing/ads/ad-1',
  },
  P3: {
    id: 'P3',
    domain: 'pub',
    title: 'Fatigue créative',
    subject: ad,
    figures: { signaux: ['CTR en baisse', 'fréquence élevée (3,4)'] },
    threshold: '2 signaux sur 5',
    stakeMinor: 70_000,
    link: '/marketing/ads/ad-1',
  },
  P4: {
    id: 'P4',
    domain: 'pub',
    title: 'CPL au-dessus du break-even',
    subject: product,
    figures: { cplParJourMinor: [12_400, null, 9_800], cplBreakEvenMinor: 7_350, jours: 3 },
    threshold: '3 jours de suite',
    stakeMinor: 60_000,
    link: '/marketing?produit=p-uuid',
  },
  P5: {
    id: 'P5',
    domain: 'pub',
    title: 'Coûts manquants',
    subject: ad,
    figures: { depenseMinor: 95_000, jours: 7 },
    threshold: "coût d'achat requis",
    stakeMinor: 0,
    link: '/produits/p-uuid',
  },
  L1: {
    id: 'L1',
    domain: 'livraison',
    title: "Livraison sous l'objectif",
    subject: product,
    figures: { tauxLivraisonPct: 61.5, colis: 52, jours: 14 },
    threshold: '70 %',
    stakeMinor: 140_000,
    link: '/livraison?produit=p-uuid',
  },
  L2: {
    id: 'L2',
    domain: 'livraison',
    title: 'Zone faible',
    subject: { governorate: 'Kasserine' },
    figures: { tauxPct: 48, moyennePct: 71.3, colis: 40, jours: 30 },
    threshold: '15 points sous la moyenne',
    stakeMinor: 0,
    link: '/livraison?governorate=Kasserine',
  },
  S1: {
    id: 'S1',
    domain: 'stock',
    title: 'Rupture proche',
    subject: product,
    figures: { stock: 18, ventesParJour: 4.3, joursDeStock: 4.2, delaiReapproJours: 10 },
    threshold: 'délai de réappro + 3 jours',
    stakeMinor: 640_000,
    link: '/stock/p-uuid',
  },
  S2: {
    id: 'S2',
    domain: 'stock',
    title: 'Stock dormant',
    subject: product,
    figures: { stock: 230, joursSansVente: 26, joursDeStock: null, valeurStockMinor: 2_070_000 },
    threshold: '21 jours sans vente ou plus de 90 jours de stock',
    stakeMinor: 0,
    link: '/stock/p-uuid',
  },
  R1: {
    id: 'R1',
    domain: 'rentabilite',
    title: 'Produit en perte ce mois',
    subject: product,
    figures: { margeMoisMinor: -152_000, livrees: 12, retours: 9, pubMinor: 610_000 },
    threshold: 'marge du mois négative',
    stakeMinor: 152_000,
    link: '/pnl?produit=p-uuid',
  },
};

function rules(signals: Signal[]) {
  const prepared = prepareBrief(signals, { asOf: AS_OF, currency: 'TND' });
  return { prepared, content: briefFromRules(prepared, signals) };
}

describe('briefFromRules', () => {
  it.each(Object.keys(ALL) as SignalId[])('rédige %s avec les seuls chiffres envoyés', (code) => {
    const { prepared, content } = rules([ALL[code]]);
    const [action] = content.actions;
    expect(action?.code).toBe(code);
    for (const text of [content.resume, action?.titre, action?.constat, action?.action]) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/null|undefined|\[object|Agent [A-Z]\b|\s[,.]|\.\./);
      expect(unknownNumbers(text ?? '', prepared.payload)).toEqual([]);
    }
    expect(action?.lien).toBe(ALL[code].link);
  });

  it('écrit les vrais prénoms, jamais les pseudonymes', () => {
    const { content } = rules([ALL.C3, ALL.C4]);
    expect(content.actions.map((a) => a.titre)).toEqual([
      'Yasmine sous ses objectifs',
      'Mehdi : trop de retours',
    ]);
    expect(content.actions[1]?.action).toContain('Mehdi');
  });

  it('formate montants, pourcentages et statuts comme le payload', () => {
    const { content } = rules([ALL.C1, ALL.P1, ALL.P4]);
    expect(content.actions[0]?.constat).toBe(
      "14 commandes d'hier n'ont pas encore été confirmées (en attente : 9, sans réponse : 5). Chiffre d'affaires en jeu : 966,000 DT.",
    );
    expect(content.actions[1]?.constat).toBe(
      '420,000 DT dépensés en 7 jours sans aucun achat, pour un CPA cible de 18,500 DT.',
    );
    expect(content.actions[2]?.constat).toContain('(12,400 DT, aucun lead, 9,800 DT)');
  });

  it("garde l'ordre reçu, cinq actions au plus, et le dit dans le résumé", () => {
    const signals = Object.values(ALL);
    const { content } = rules(signals);
    expect(content.actions.map((a) => a.code)).toEqual(['C1', 'C2', 'C3', 'C4', 'P1']);
    expect(content.actions.map((a) => a.signal)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(content.resume).toBe(
      "Cinq actions pour aujourd'hui, en commençant par : Leads d'hier non traités. D'autres signaux sont dans l'écran Actions.",
    );
  });

  it('accorde le résumé à une seule action', () => {
    expect(rules([ALL.S1]).content.resume).toBe(
      "Une action pour aujourd'hui : Rupture proche : Brosse lissante.",
    );
  });

  it('ne casse pas sans signal', () => {
    expect(rules([]).content).toEqual({ resume: "Rien d'urgent aujourd'hui.", actions: [] });
  });

  it('accorde les mots aux chiffres', () => {
    const one: Signal = {
      ...ALL.R1,
      figures: { margeMoisMinor: -5_000, livrees: 1, retours: 0, pubMinor: 40_000 },
    };
    expect(rules([one]).content.actions[0]?.constat).toBe(
      'Marge du mois : -5,000 DT, avec 1 commande livrée, 0 retour et 40,000 DT de pub.',
    );
    expect(rules([ALL.S1]).content.actions[0]?.constat).toBe(
      '18 pièces en stock, soit 4,2 jours de ventes (4,3 par jour), pour un délai de réappro de 10 jours.',
    );
  });

  it('distingue zone et transporteur faibles', () => {
    const carrier: Signal = { ...ALL.L2, title: 'Transporteur faible', subject: { carrier: 'Aramex' } };
    const { content } = rules([ALL.L2, carrier]);
    expect(content.actions.map((a) => a.titre)).toEqual([
      'Zone faible : Kasserine',
      'Transporteur faible : Aramex',
    ]);
  });
});

describe('describeSignals', () => {
  it('formate tous les signaux, au-delà des huit envoyés au modèle, avec les vrais noms', () => {
    const signals = Object.values(ALL);
    const views = describeSignals(signals, { asOf: AS_OF, currency: 'TND' });
    expect(views).toHaveLength(signals.length);
    expect(views.map((v) => v.signal)).toEqual(signals.map((_, i) => `s${i + 1}`));
    expect(views[2]?.sujet.agent).toBe('Yasmine');
    expect(JSON.stringify(views)).not.toMatch(/Agent [A-Z]\b/);
    expect(views[0]?.enJeu).toBe('966,000 DT');
    expect(views.at(-1)?.lien).toBe('/pnl?produit=p-uuid');
  });
});

describe('presentBrief', () => {
  const options = { asOf: AS_OF, currency: 'TND' as const };
  const signals = Object.values(ALL);
  const prepared = prepareBrief(signals, options);
  const stored = { signals, payload: prepared.payload, pseudonyms: prepared.pseudonyms };
  const aiContent = {
    resume: 'Rappelez les leads.',
    actions: [
      {
        signal: 's3',
        code: 'C3' as const,
        titre: 'Yasmine',
        constat: 'x',
        action: 'y',
        lien: '/agents/Yasmine',
      },
    ],
  };

  it('montre le texte de Claude quand il est prêt, et les autres signaux dessous', () => {
    const view = presentBrief({ ...stored, status: 'ready', content: aiContent }, options);
    expect(view.source).toBe('ai');
    expect(view.actions).toEqual(aiContent.actions);
    expect(view.otherSignals.map((s) => s.signal)).not.toContain('s3');
    expect(view.otherSignals).toHaveLength(signals.length - 1);
  });

  it.each(['signals_only', 'pending', 'submitted', 'failed'])(
    'passe aux phrases fixes en statut %s',
    (status) => {
      const view = presentBrief({ ...stored, status, content: null }, options);
      expect(view.source).toBe('rules');
      expect(view.actions.map((a) => a.signal)).toEqual(['s1', 's2', 's3', 's4', 's5']);
      expect(view.otherSignals.map((s) => s.signal)).toEqual(signals.slice(5).map((_, i) => `s${i + 6}`));
    },
  );

  it('refait le payload quand il manque', () => {
    const view = presentBrief(
      { signals, payload: null, pseudonyms: null, status: 'signals_only', content: null },
      options,
    );
    expect(view.actions[2]?.titre).toBe('Yasmine sous ses objectifs');
  });

  it('ne montre rien un jour sans signal', () => {
    expect(
      presentBrief({ signals: [], payload: null, pseudonyms: null, status: 'empty', content: null }, options),
    ).toEqual({ source: null, resume: null, actions: [], otherSignals: [] });
  });
});
