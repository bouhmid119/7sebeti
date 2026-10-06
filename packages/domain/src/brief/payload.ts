import type { Currency } from '../money';
import type { OrderStatusCategory } from '../order-status';
import type { Signal, SignalDomain, SignalFigure, SignalId } from '../signals';
import { formatMoneyFr, formatNumberFr } from './format';

/**
 * Ce qui part chez Claude pour rédiger le brief. Liste blanche : seuls le titre, le sujet,
 * les chiffres et le seuil de chaque signal sortent, déjà formatés en français.
 * Jamais de nom ou téléphone de client, de ville, d'identifiant ni de lien. Les agents
 * deviennent « Agent A », « Agent B »… et la correspondance reste sur le serveur.
 */

export type BriefFigure = string | null | ReadonlyArray<string | null> | Record<string, string>;

export interface BriefSignal {
  /** Référence que le modèle renvoie pour chaque action : s1, s2… dans l'ordre des signaux. */
  ref: string;
  code: SignalId;
  domaine: SignalDomain;
  titre: string;
  sujet: { produit?: string; pub?: string; agent?: string; zone?: string; transporteur?: string };
  chiffres: Record<string, BriefFigure>;
  seuil: string;
  /** Argent en jeu, formaté ; null si non chiffrable. */
  enJeu: string | null;
}

export interface BriefPayload {
  date: string;
  signaux: BriefSignal[];
  /** Signaux calculés mais non envoyés (au-delà de maxSignals) : visibles dans l'écran Actions. */
  signauxNonDetailles: number;
}

export interface PreparedBrief {
  payload: BriefPayload;
  /** « Agent A » → nom réel. Ne quitte jamais le serveur. */
  pseudonyms: Record<string, string>;
}

export const BRIEF_MAX_SIGNALS = 8;

const STATUS_LABEL: Partial<Record<OrderStatusCategory, string>> = {
  pending: 'en attente',
  no_answer: 'sans réponse',
  callback: 'à rappeler',
};

/** 0 → A, 25 → Z, 26 → AA. */
function letters(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function formatFigure(key: string, value: SignalFigure, currency: Currency): [string, BriefFigure] {
  const isMoney = key.endsWith('Minor');
  const outKey = isMoney ? key.slice(0, -'Minor'.length) : key;
  const one = (v: number | string | null): string | null => {
    if (v === null || typeof v === 'string') return v;
    if (isMoney) return formatMoneyFr(v, currency);
    return key.endsWith('Pct') ? `${formatNumberFr(v)} %` : formatNumberFr(v);
  };
  if (value === null || typeof value !== 'object') return [outKey, one(value)];
  // Array.isArray ne rétrécit pas un ReadonlyArray : le type est précisé à la main.
  if (Array.isArray(value)) return [outKey, (value as ReadonlyArray<number | string | null>).map(one)];
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, number>)) {
    record[STATUS_LABEL[k as OrderStatusCategory] ?? k] = formatNumberFr(v);
  }
  return [outKey, record];
}

export function prepareBrief(
  signals: readonly Signal[],
  options: { asOf: string; currency: Currency; maxSignals?: number },
): PreparedBrief {
  const max = options.maxSignals ?? BRIEF_MAX_SIGNALS;
  const pseudonymOf = new Map<string, string>();
  const pseudonym = (agent: string) => {
    let p = pseudonymOf.get(agent);
    if (!p) {
      p = `Agent ${letters(pseudonymOf.size)}`;
      pseudonymOf.set(agent, p);
    }
    return p;
  };

  const signaux = signals.slice(0, max).map((s, i): BriefSignal => {
    const sujet: BriefSignal['sujet'] = {};
    if (s.subject.product) sujet.produit = s.subject.product;
    if (s.subject.ad) sujet.pub = s.subject.ad;
    if (s.subject.agent) sujet.agent = pseudonym(s.subject.agent);
    if (s.subject.governorate)
      sujet.zone = s.subject.governorate === '?' ? 'non renseignée' : s.subject.governorate;
    if (s.subject.carrier) {
      sujet.transporteur = s.subject.carrier === '?' ? 'non renseigné' : s.subject.carrier;
    }
    return {
      ref: `s${i + 1}`,
      code: s.id,
      domaine: s.domain,
      titre: s.title,
      sujet,
      chiffres: Object.fromEntries(
        Object.entries(s.figures).map(([k, v]) => formatFigure(k, v, options.currency)),
      ),
      seuil: s.threshold,
      enJeu: s.stakeMinor > 0 ? formatMoneyFr(s.stakeMinor, options.currency) : null,
    };
  });

  return {
    payload: { date: options.asOf, signaux, signauxNonDetailles: Math.max(0, signals.length - max) },
    pseudonyms: Object.fromEntries([...pseudonymOf].map(([name, p]) => [p, name])),
  };
}
