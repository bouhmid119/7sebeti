import { describe, expect, it } from 'vitest';
import type { Signal, SignalId } from '../signals';
import { unknownNumbers } from './output';
import { prepareBrief } from './payload';
import { briefFromRules, describeSignals } from './rules';
import { presentBrief, shownAs } from './view';

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
      expect(text).not.toMatch(/\bnull\b|undefined|\[object|Agent [A-Z]\b|\s[,.]|\.\./);
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

describe('briefFromRules, cas limites relevés en relecture', () => {
  const constat = (sig: Signal) => rules([sig]).content.actions[0]?.constat;
  const action = (sig: Signal) => rules([sig]).content.actions[0]?.action;

  it("n'écrit pas « 0 commande manquée »", () => {
    const c2: Signal = { ...ALL.C2, figures: { ...ALL.C2.figures, commandesManquees: 0 } };
    expect(constat(c2)).not.toContain('Environ');
  });

  it('accorde les commandes confirmées par jour', () => {
    const c3: Signal = { ...ALL.C3, figures: { tauxPct: 25, confirmeesParJour: 0.7 } };
    expect(constat(c3)).toContain('0,7 commande confirmée par jour');
  });

  it('ne pousse pas à monter une pub déjà au plafond, et dit sa dépense actuelle', () => {
    expect(constat(ALL.P2)).toContain('Dépense actuelle : 50,000 DT par jour.');
    expect(action(ALL.P2)).toBe('Augmentez le budget par paliers, sans dépasser 150,000 DT par jour.');
    const atCap: Signal = { ...ALL.P2, figures: { ...ALL.P2.figures, depenseParJourMinor: 180_000 } };
    expect(action(atCap)).toBe('Gardez ce budget : il atteint déjà le plafond de 150,000 DT par jour.');
  });

  it('nomme le produit à vérifier, pas la pub, et ne suppose pas que le coût manque', () => {
    const [a] = rules([ALL.P5]).content.actions;
    expect(a?.titre).toBe('Coûts à vérifier : Brosse lissante');
    expect(a?.constat).toContain('(pub Vidéo avant/après)');
    expect(a?.constat).toContain("le coût d'achat manque ou que la marge avant pub n'est pas positive");
  });

  it('explique un stock dormant par la lenteur des ventes ou par leur absence', () => {
    const slow: Signal = {
      ...ALL.S2,
      figures: { stock: 120, joursSansVente: 1, joursDeStock: 420, valeurStockMinor: null },
    };
    expect(constat(slow)).toBe('120 pièces en stock, soit 420 jours de ventes au rythme actuel.');
    expect(constat(ALL.S2)).toBe(
      '230 pièces en stock et aucune vente depuis 26 jours. Valeur du stock : 2 070,000 DT.',
    );
    const never: Signal = { ...ALL.S2, figures: { ...ALL.S2.figures, joursSansVente: null } };
    expect(constat(never)).toContain('aucune vente enregistrée');
  });

  it('traite à part les commandes sans gouvernorat ou sans transporteur reconnu', () => {
    const unknownZone: Signal = { ...ALL.L2, subject: { governorate: '?' } };
    const unknownCarrier: Signal = { ...ALL.L2, title: 'Transporteur faible', subject: { carrier: '?' } };
    const [zone, carrier] = rules([unknownZone, unknownCarrier]).content.actions;
    expect(zone?.titre).toBe('Livraison faible : gouvernorat non reconnu');
    expect(zone?.action).toContain('gouvernorat');
    expect(carrier?.titre).toBe('Livraison faible : transporteur non renseigné');
  });

  it('garde au plus deux actions du même code, les suivantes restent des signaux', () => {
    const agent = (name: string): Signal => ({
      ...ALL.C3,
      subject: { agent: name },
      link: `/agents/${name}`,
    });
    const signals = [agent('Yasmine'), agent('Mehdi'), agent('Sarra'), agent('Amine'), ALL.L2];
    const { content } = rules(signals);
    expect(content.actions.map((a) => a.signal)).toEqual(['s1', 's2', 's5']);
    expect(content.resume).toContain("D'autres signaux");
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

  it("passe aux phrases fixes quand le texte de Claude n'a gardé aucune action", () => {
    const empty = { resume: 'Une action : rappelez les leads.', actions: [] };
    const view = presentBrief({ ...stored, status: 'ready', content: empty }, options);
    expect(view.source).toBe('rules');
    expect(view.actions).toHaveLength(5);
  });

  it('dit ce que le commerçant avait sous les yeux pour chaque signal', () => {
    const ai = presentBrief({ ...stored, status: 'ready', content: aiContent }, options);
    expect(shownAs(ai, 's3')).toBe('ai');
    expect(shownAs(ai, 's1')).toBe('signal');
    const fixed = presentBrief({ ...stored, status: 'signals_only', content: null }, options);
    expect(shownAs(fixed, 's1')).toBe('rules');
    expect(shownAs(fixed, 's9')).toBe('signal');
  });

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
