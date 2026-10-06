import { describe, expect, it } from 'vitest';
import type { Signal } from '../signals';
import { formatMoneyFr, formatNumberFr } from './format';
import { finalizeBrief, unknownNumbers } from './output';
import { prepareBrief } from './payload';
import { BRIEF_SYSTEM_PROMPT, briefUserMessage } from './prompt';

const AS_OF = '2026-10-20';

function signal(over: Partial<Signal>): Signal {
  return {
    id: 'C2',
    domain: 'confirmation',
    title: "Confirmation sous l'objectif",
    subject: { productId: '0f3c-uuid-produit', product: 'Brosse lissante' },
    figures: { tauxPct: 52.5, objectifPct: 70, leads: 120, jours: 7, commandesManquees: 21 },
    threshold: 'objectif 70 %',
    stakeMinor: 871_500,
    link: '/confirmation?produit=0f3c-uuid-produit',
    ...over,
  };
}

const SIGNALS: Signal[] = [
  signal({
    id: 'C1',
    title: 'Leads de la veille non traités',
    subject: {},
    figures: { commandes: 14, parStatut: { pending: 9, no_answer: 5 }, chiffreAffairesEnJeuMinor: 966_000 },
    threshold: 'au moins 5',
    stakeMinor: 966_000,
    link: '/confirmation?jour=hier&statut=non-traite',
  }),
  signal({}),
  signal({
    id: 'C3',
    title: 'Agent sous ses objectifs',
    subject: { agent: 'Yasmine' },
    figures: { tauxPct: 41.2, confirmeesParJour: 6.5 },
    threshold: '60 % et 12 par jour',
    stakeMinor: 0,
    link: '/agents/Yasmine',
  }),
  signal({
    id: 'C4',
    title: 'Agent avec trop de retours',
    subject: { agent: 'Mehdi' },
    figures: { tauxRetourPct: 38, colis: 64 },
    threshold: '25 %',
    stakeMinor: 0,
    link: '/agents/Mehdi',
  }),
  signal({
    id: 'C3',
    title: 'Agent sous ses objectifs',
    subject: { agent: 'Yasmine' },
    figures: { tauxPct: 41.2, confirmeesParJour: 6.5 },
    threshold: '60 % et 12 par jour',
    stakeMinor: 0,
    link: '/agents/Yasmine',
  }),
  signal({
    id: 'L2',
    domain: 'livraison',
    title: 'Zone faible',
    subject: { governorate: '?' },
    figures: { tauxPct: 48, moyennePct: 71.3, colis: 40, jours: 30 },
    threshold: '15 points sous la moyenne',
    stakeMinor: 0,
    link: '/livraison?governorate=%3F',
  }),
  signal({
    id: 'P4',
    domain: 'pub',
    title: 'CPL au-dessus du break-even',
    figures: { cplParJourMinor: [12_400, null, 9_800], cplBreakEvenMinor: 7_350, jours: 3 },
    threshold: '3 jours de suite',
    stakeMinor: 0,
  }),
];

describe('formatage français', () => {
  it('formate montants et nombres comme le modèle doit les recopier', () => {
    expect(formatMoneyFr(1_234_500, 'TND')).toBe('1 234,500 DT');
    expect(formatMoneyFr(69_000, 'TND')).toBe('69,000 DT');
    expect(formatMoneyFr(-500, 'TND')).toBe('-0,500 DT');
    expect(formatMoneyFr(123_456, 'EUR')).toBe('1 234,56 €');
    expect(formatNumberFr(52.5)).toBe('52,5');
    expect(formatNumberFr(1_234_567)).toBe('1 234 567');
  });
});

describe('prepareBrief', () => {
  const prepared = prepareBrief(SIGNALS, { asOf: AS_OF, currency: 'TND' });
  const json = JSON.stringify(prepared.payload);

  it('remplace les agents par des pseudonymes stables et garde la correspondance côté serveur', () => {
    const agents = prepared.payload.signaux.map((s) => s.sujet.agent).filter(Boolean);
    expect(agents).toEqual(['Agent A', 'Agent B', 'Agent A']);
    expect(prepared.pseudonyms).toEqual({ 'Agent A': 'Yasmine', 'Agent B': 'Mehdi' });
    expect(json).not.toContain('Yasmine');
    expect(json).not.toContain('Mehdi');
  });

  it('ne laisse sortir ni identifiant ni lien', () => {
    expect(json).not.toContain('uuid');
    expect(json).not.toContain('/confirmation');
    expect(json).not.toContain('/agents');
    expect(json).not.toContain('Minor');
  });

  it('formate les chiffres : montants, pourcentages, statuts, listes', () => {
    const [c1, c2, , , , l2, p4] = prepared.payload.signaux;
    expect(c1).toMatchObject({
      ref: 's1',
      code: 'C1',
      sujet: {},
      chiffres: {
        commandes: '14',
        parStatut: { 'en attente': '9', 'sans réponse': '5' },
        chiffreAffairesEnJeu: '966,000 DT',
      },
      enJeu: '966,000 DT',
    });
    expect(c2?.chiffres).toMatchObject({ tauxPct: '52,5 %', objectifPct: '70 %', leads: '120' });
    expect(c2?.sujet).toEqual({ produit: 'Brosse lissante' });
    expect(l2?.sujet).toEqual({ zone: 'non renseignée' });
    expect(l2?.enJeu).toBeNull();
    expect(p4?.chiffres).toMatchObject({
      cplParJour: ['12,400 DT', null, '9,800 DT'],
      cplBreakEven: '7,350 DT',
    });
  });

  it('ne détaille que les premiers signaux', () => {
    const p = prepareBrief(SIGNALS, { asOf: AS_OF, currency: 'TND', maxSignals: 2 });
    expect(p.payload.signaux.map((s) => s.ref)).toEqual(['s1', 's2']);
    expect(p.payload.signauxNonDetailles).toBe(5);
    expect(p.pseudonyms).toEqual({});
  });

  it('met la date et les données dans le message utilisateur', () => {
    const message = briefUserMessage(prepared.payload);
    expect(message.startsWith(`Signaux du ${AS_OF}.`)).toBe(true);
    expect(JSON.parse(message.slice(message.indexOf('{')))).toEqual(prepared.payload);
  });
});

describe('consigne système', () => {
  it('ne contient aucun chiffre en dehors des codes, des refs et du nom 7sebeti', () => {
    const rest = BRIEF_SYSTEM_PROMPT.replace(/\b[CPLSRs]\d\b/g, '').replaceAll('7sebeti', '');
    expect(rest).not.toMatch(/\d/);
  });

  it('est assez longue pour être mise en cache (plus de 512 tokens)', () => {
    // Environ 4 caractères par token en français : la marge est large.
    expect(BRIEF_SYSTEM_PROMPT.length).toBeGreaterThan(3000);
  });
});

describe('finalizeBrief', () => {
  const prepared = prepareBrief(SIGNALS, { asOf: AS_OF, currency: 'TND' });

  it('rétablit les vrais noms et rattache lien et code du signal', () => {
    const result = finalizeBrief(
      {
        resume: 'Rappelez les 14 leads d hier et accompagnez Agent A.',
        actions: [
          {
            signal: 's1',
            titre: 'Leads d hier à rappeler',
            constat: '14 leads attendent, soit 966,000 DT en jeu.',
            action: 'Faites-les rappeler ce matin.',
          },
          {
            signal: 's3',
            titre: 'Accompagner Agent A',
            constat: 'Agent A confirme 41,2 % de ses leads.',
            action: 'Écoutez trois appels avec Agent A.',
          },
        ],
      },
      prepared,
      SIGNALS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.content.resume).toBe('Rappelez les 14 leads d hier et accompagnez Yasmine.');
    expect(result.content.actions[1]).toEqual({
      signal: 's3',
      code: 'C3',
      titre: 'Accompagner Yasmine',
      constat: 'Yasmine confirme 41,2 % de ses leads.',
      action: 'Écoutez trois appels avec Yasmine.',
      lien: '/agents/Yasmine',
    });
  });

  it('écarte les actions sur un signal inconnu ou en double, et en garde cinq au plus', () => {
    const action = (signal: string) => ({ signal, titre: 't', constat: 'c', action: 'a' });
    const result = finalizeBrief(
      {
        resume: 'r',
        actions: ['s9', 's1', 's1', 's2', 's3', 's4', 's5', 's6'].map(action),
      },
      prepared,
      SIGNALS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.actions.map((a) => a.signal)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(result.warnings).toEqual([
      'action sur un signal inconnu (s9) ignorée',
      'deuxième action sur s1 ignorée',
      '6 actions proposées, 5 gardées',
    ]);
  });

  it('signale un chiffre inventé et un pseudonyme inconnu sans rejeter le brief', () => {
    const result = finalizeBrief(
      {
        resume: 'Votre confirmation pourrait gagner 18 % avec Agent Z.',
        actions: [{ signal: 's2', titre: 't', constat: 'Taux de 52,5 % pour 70 %.', action: 'a' }],
      },
      prepared,
      SIGNALS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual(['chiffre absent des données : 18', 'pseudonyme inconnu : Agent Z']);
  });

  it('refuse une réponse hors format', () => {
    expect(finalizeBrief({ resume: 'r' }, prepared, SIGNALS)).toEqual({
      ok: false,
      error: 'réponse du modèle hors format',
    });
    expect(finalizeBrief({ resume: 'r', actions: [{ signal: 's1' }] }, prepared, SIGNALS).ok).toBe(false);
    expect(finalizeBrief('texte libre', prepared, SIGNALS).ok).toBe(false);
  });
});

describe('unknownNumbers', () => {
  const { payload } = prepareBrief(SIGNALS, { asOf: AS_OF, currency: 'TND' });

  it('accepte les chiffres recopiés, même avec un autre arrondi d écriture', () => {
    expect(unknownNumbers('966,000 DT, 966 DT, 52,5 %, 1 234 colis ? non', payload)).toEqual(['1 234']);
    expect(unknownNumbers('le 20 octobre, 7 jours, 3 jours de suite', payload)).toEqual([]);
  });
});
