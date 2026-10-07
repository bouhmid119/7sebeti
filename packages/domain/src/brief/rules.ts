import type { Currency } from '../money';
import type { Signal, SignalId } from '../signals';
import type { BriefAction, BriefContent } from './output';
import { type BriefFigure, type BriefSignal, type PreparedBrief, prepareBrief } from './payload';
import { BRIEF_MAX_ACTIONS } from './prompt';

/**
 * Brief rédigé sans modèle, par des phrases fixes : ce que voit le commerçant quand l'IA est
 * coupée, sans clé, en échec, ou avant que sa réponse n'arrive. Mêmes règles que le modèle :
 * les chiffres viennent uniquement du payload (déjà formatés), rien n'est calculé ici.
 */

type Text = Pick<BriefAction, 'titre' | 'constat' | 'action'>;

/** Pour le résumé : pas de chiffre écrit par le code, seulement ceux des données. */
const COUNT_WORDS = ['aucune', 'une', 'deux', 'trois', 'quatre', 'cinq'] as const;

function show(value: BriefFigure | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return (value as ReadonlyArray<string | null>).map((v) => v ?? 'aucun lead').join(', ');
  }
  const parts = Object.entries(value as Record<string, string>).map(([k, v]) => `${k} : ${v}`);
  return parts.length ? parts.join(', ') : null;
}

function subjectName(s: BriefSignal, agentName: string | undefined): string {
  return agentName ?? s.sujet.pub ?? s.sujet.produit ?? s.sujet.zone ?? s.sujet.transporteur ?? '';
}

function sentence(parts: ReadonlyArray<string | null | false>): string {
  return parts.filter(Boolean).join(' ');
}

/** « 0 achat », « 1,5 jour », « 3 achats » : le singulier français va jusqu'à 2 exclu. */
function count(value: string | null, singular: string, plural = `${singular}s`): string {
  const n = Number((value ?? '').replace(/\s/g, '').replace(',', '.'));
  return `${value} ${Math.abs(n) < 2 ? singular : plural}`;
}

/** Phrases par code de signal. `agent` est le vrai nom (le payload n'a que le pseudonyme). */
function textFor(s: BriefSignal, agent: string | undefined): Text {
  const f = (key: string) => show(s.chiffres[key]);
  const who = subjectName(s, agent);
  const code: SignalId = s.code;
  switch (code) {
    case 'C1': {
      const detail = f('parStatut');
      const stake = f('chiffreAffairesEnJeu');
      return {
        titre: "Leads d'hier non traités",
        constat: sentence([
          `${f('commandes')} commandes d'hier n'ont pas encore été confirmées${detail ? ` (${detail})` : ''}.`,
          stake && `Chiffre d'affaires en jeu : ${stake}.`,
        ]),
        action: 'Faites-les rappeler ce matin, en commençant par les plus anciennes.',
      };
    }
    case 'C2':
      return {
        titre: `Confirmation basse : ${who}`,
        constat: sentence([
          `Taux de confirmation de ${f('tauxPct')} sur ${f('jours')} jours (${f('leads')} leads), pour un objectif de ${f('objectifPct')}.`,
          f('commandesManquees') &&
            `Environ ${count(f('commandesManquees'), 'commande manquée', 'commandes manquées')}.`,
        ]),
        action: 'Écoutez quelques appels et vérifiez le script, le prix annoncé et le délai de livraison.',
      };
    case 'C3':
      return {
        titre: `${who} sous ses objectifs`,
        constat: `${f('tauxPct')} de confirmation et ${f('confirmeesParJour')} commandes confirmées par jour, pour un objectif de ${s.seuil}.`,
        action: `Faites le point avec ${who} et écoutez quelques appels ensemble.`,
      };
    case 'C4':
      return {
        titre: `${who} : trop de retours`,
        constat: `${f('tauxRetourPct')} de retours sur ${f('colis')} colis, au-delà du seuil de ${s.seuil}.`,
        action: `Vérifiez avec ${who} que l'adresse et l'intention d'achat sont confirmées avant l'expédition.`,
      };
    case 'P1': {
      const cpa = f('cpa');
      return {
        titre: `Pub à couper : ${who}`,
        constat: cpa
          ? `${f('depense')} dépensés en ${f('jours')} jours pour ${count(f('achats'), 'achat')} : CPA de ${cpa}, pour une cible de ${f('cpaCible')}.`
          : `${f('depense')} dépensés en ${f('jours')} jours sans aucun achat, pour un CPA cible de ${f('cpaCible')}.`,
        action: 'Coupez cette pub ou baissez fortement son budget.',
      };
    }
    case 'P2':
      return {
        titre: `Pub à scaler : ${who}`,
        constat: `CPA de ${f('cpa')} pour une cible de ${f('cpaCible')}, avec ${count(f('achats'), 'achat')} en ${f('jours')} jours.`,
        action: f('plafondParJour')
          ? `Augmentez le budget par paliers, sans dépasser ${f('plafondParJour')} par jour.`
          : 'Augmentez le budget par paliers en surveillant le CPA.',
      };
    case 'P3':
      return {
        titre: `Fatigue créative : ${who}`,
        constat: `Signes de fatigue : ${f('signaux') ?? 'plusieurs indicateurs en baisse'}.`,
        action: "Préparez une nouvelle créa et réduisez la diffusion de l'actuelle.",
      };
    case 'P4':
      return {
        titre: `CPL trop élevé : ${who}`,
        constat: `CPL au-dessus du break-even de ${f('cplBreakEven')} ${f('jours')} jours de suite (${f('cplParJour')}).`,
        action: 'Revoyez le ciblage ou la créa, ou baissez le budget de ce produit.',
      };
    case 'P5':
      return {
        titre: `Coût d'achat manquant : ${who}`,
        constat: `${f('depense')} dépensés en pub sur ${f('jours')} jours sans coût d'achat renseigné : impossible de juger la rentabilité.`,
        action: "Renseignez le coût d'achat de ce produit dans 7sebeti.",
      };
    case 'L1':
      return {
        titre: `Livraison basse : ${who}`,
        constat: `${f('tauxLivraisonPct')} de colis livrés sur ${f('colis')} colis en ${f('jours')} jours, sous l'objectif de ${s.seuil}.`,
        action: "Confirmez bien l'adresse et appelez le client la veille de la livraison.",
      };
    case 'L2': {
      const zone = s.sujet.zone !== undefined;
      return {
        titre: zone ? `Zone faible : ${who}` : `Transporteur faible : ${who}`,
        constat: `${f('tauxPct')} de livraison sur ${f('colis')} colis en ${f('jours')} jours, contre ${f('moyennePct')} en moyenne.`,
        action: zone
          ? 'Vérifiez les colis de cette zone et changez de transporteur si le problème dure.'
          : 'Vérifiez les colis confiés à ce transporteur et changez-en si le problème dure.',
      };
    }
    case 'S1':
      return {
        titre: `Rupture proche : ${who}`,
        constat: `${count(f('stock'), 'pièce')} en stock, soit ${count(f('joursDeStock'), 'jour')} de ventes (${f('ventesParJour')} par jour), pour un délai de réappro de ${count(f('delaiReapproJours'), 'jour')}.`,
        action: "Passez la commande fournisseur dès aujourd'hui.",
      };
    case 'S2': {
      const noSale = f('joursSansVente');
      const value = f('valeurStock');
      return {
        titre: `Stock dormant : ${who}`,
        constat: sentence([
          `${count(f('stock'), 'pièce')} en stock`,
          noSale ? `et aucune vente depuis ${count(noSale, 'jour')}.` : 'et aucune vente enregistrée.',
          value && `Valeur du stock : ${value}.`,
        ]),
        action: "Écoulez ce stock (offre, pack, relance) avant d'en racheter.",
      };
    }
    case 'R1':
      return {
        titre: `Produit en perte : ${who}`,
        constat: `Marge du mois : ${f('margeMois')}, avec ${count(f('livrees'), 'commande livrée', 'commandes livrées')}, ${count(f('retours'), 'retour')} et ${f('pub')} de pub.`,
        action: 'Revoyez le prix, les coûts ou la pub de ce produit.',
      };
  }
}

/**
 * Brief à partir des signaux seuls, dans l'ordre reçu (déjà trié par argent en jeu),
 * cinq actions au plus. Les vrais noms d'agents viennent des signaux, pas du payload.
 */
export function briefFromRules(prepared: PreparedBrief, signals: readonly Signal[]): BriefContent {
  const kept = prepared.payload.signaux.slice(0, BRIEF_MAX_ACTIONS);
  const actions = kept.map((s, i): BriefAction => {
    const source = signals[i];
    return {
      signal: s.ref,
      code: s.code,
      ...textFor(s, source?.subject.agent),
      lien: source?.link ?? '/actions',
    };
  });
  const first = actions[0];
  const more = prepared.payload.signaux.length + prepared.payload.signauxNonDetailles > actions.length;
  const howMany = COUNT_WORDS[actions.length] ?? 'plusieurs';
  const headline =
    actions.length === 1
      ? `Une action pour aujourd'hui : ${first?.titre}.`
      : `${howMany.charAt(0).toUpperCase()}${howMany.slice(1)} actions pour aujourd'hui, en commençant par : ${first?.titre}.`;
  const resume = first
    ? sentence([headline, more && "D'autres signaux sont dans l'écran Actions."])
    : "Rien d'urgent aujourd'hui.";
  return { resume, actions };
}

/** Un signal tel que l'écran Actions le montre : chiffres formatés, vrais noms, lien. */
export interface SignalView {
  signal: string;
  code: SignalId;
  titre: string;
  sujet: BriefSignal['sujet'];
  chiffres: BriefSignal['chiffres'];
  seuil: string;
  enJeu: string | null;
  lien: string;
}

/**
 * Tous les signaux d'un jour, formatés comme pour le modèle mais avec les vrais noms
 * (c'est le commerçant qui lit). Les références s1, s2… sont celles du payload.
 */
export function describeSignals(
  signals: readonly Signal[],
  options: { asOf: string; currency: Currency },
): SignalView[] {
  const { payload } = prepareBrief(signals, { ...options, maxSignals: signals.length });
  return payload.signaux.map((s, i) => {
    const source = signals[i];
    const sujet = { ...s.sujet };
    if (source?.subject.agent) sujet.agent = source.subject.agent;
    return {
      signal: s.ref,
      code: s.code,
      titre: s.titre,
      sujet,
      chiffres: s.chiffres,
      seuil: s.seuil,
      enJeu: s.enJeu,
      lien: source?.link ?? '/actions',
    };
  });
}
