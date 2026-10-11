import type { Signal, SignalId } from '../signals';
import type { BriefPayload, PreparedBrief } from './payload';
import { BRIEF_MAX_ACTIONS } from './prompt';

/** Brief tel qu'il est stocké et affiché : vrais noms rétablis, lien et code du signal rattachés. */
export interface BriefAction {
  /** Référence du signal dans le payload (s1, s2…). */
  signal: string;
  code: SignalId;
  titre: string;
  constat: string;
  action: string;
  /** Écran de 7sebeti où agir, repris du signal (jamais du modèle). */
  lien: string;
}

export interface BriefContent {
  resume: string;
  actions: BriefAction[];
}

export type FinalizedBrief =
  | { ok: true; content: BriefContent; warnings: string[] }
  | { ok: false; error: string };

interface RawAction {
  signal: string;
  titre: string;
  constat: string;
  action: string;
}

const TEXT_FIELDS = ['signal', 'titre', 'constat', 'action'] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseRaw(raw: unknown): { resume: string; actions: RawAction[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { resume, actions } = raw as Record<string, unknown>;
  if (!isNonEmptyString(resume) || !Array.isArray(actions)) return null;
  const out: RawAction[] = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') return null;
    const r = a as Record<string, unknown>;
    if (!TEXT_FIELDS.every((k) => isNonEmptyString(r[k]))) return null;
    out.push({
      signal: (r.signal as string).trim(),
      titre: (r.titre as string).trim(),
      constat: (r.constat as string).trim(),
      action: (r.action as string).trim(),
    });
  }
  return { resume: resume.trim(), actions: out };
}

const NUMBER = /\d+(?:[   ]\d{3})*(?:[.,]\d+)?/g;
const SEPARATORS = /[   ]/g;

function canonical(token: string): string {
  return String(Number(token.replace(SEPARATORS, '').replace(',', '.')));
}

/**
 * Chiffres écrits par le modèle qui n'apparaissent nulle part dans ce qu'on lui a envoyé.
 * Heuristique de contrôle : le brief n'est pas rejeté, l'écart est journalisé en avertissement.
 */
export function unknownNumbers(text: string, payload: BriefPayload): string[] {
  const known = new Set<string>(['0', '1']);
  for (const m of JSON.stringify(payload).matchAll(NUMBER)) {
    known.add(canonical(m[0]));
    for (const part of m[0].split(SEPARATORS)) known.add(canonical(part));
  }
  const unknown: string[] = [];
  for (const m of text.matchAll(NUMBER)) {
    if (known.has(canonical(m[0]))) continue;
    // « 3 100 » peut être « 3 » puis « 100 » : accepté si chaque morceau est connu.
    if (m[0].split(SEPARATORS).every((part) => known.has(canonical(part)))) continue;
    unknown.push(m[0]);
  }
  return unknown;
}

/**
 * « Agent A », « l'Agent A », « l'agent A » ou « agent A ».
 * L'article fait partie du motif : sinon « l'Agent A » devient « l'Salma ».
 */
const PSEUDONYM = /(?:\b[LlDd]['’])?\b[Aa]gent ([A-Z]+)\b/g;

function restoreNames(text: string, pseudonyms: Record<string, string>, unknown: Set<string>): string {
  return text.replace(PSEUDONYM, (match, letters: string) => {
    const key = `Agent ${letters}`;
    const name = pseudonyms[key];
    if (name === undefined) {
      unknown.add(key);
      return match;
    }
    return name;
  });
}

/**
 * Valide la réponse du modèle et la rend affichable : actions sur des signaux connus,
 * cinq au plus, une par signal, vrais noms d'agents rétablis, lien repris du signal.
 */
export function finalizeBrief(
  raw: unknown,
  prepared: PreparedBrief,
  signals: readonly Signal[],
): FinalizedBrief {
  const parsed = parseRaw(raw);
  if (!parsed) return { ok: false, error: 'réponse du modèle hors format' };

  const warnings: string[] = [];
  const refs = new Map(prepared.payload.signaux.map((s, i) => [s.ref, signals[i]]));
  const seen = new Set<string>();
  const kept: Array<RawAction & { source: Signal }> = [];
  for (const a of parsed.actions) {
    const source = refs.get(a.signal);
    if (!source) {
      warnings.push(`action sur un signal inconnu (${a.signal}) ignorée`);
      continue;
    }
    if (seen.has(a.signal)) {
      warnings.push(`deuxième action sur ${a.signal} ignorée`);
      continue;
    }
    seen.add(a.signal);
    kept.push({ ...a, source });
  }
  if (kept.length > BRIEF_MAX_ACTIONS) {
    warnings.push(`${kept.length} actions proposées, ${BRIEF_MAX_ACTIONS} gardées`);
    kept.length = BRIEF_MAX_ACTIONS;
  }
  // Un brief sans action alors que des signaux existent : échec, pour que le rattrapage du matin
  // redemande, puis que l'écran passe aux phrases fixes.
  if (kept.length === 0 && prepared.payload.signaux.length > 0) {
    return { ok: false, error: 'aucune action retenue alors que des signaux existent' };
  }

  const texts = [parsed.resume, ...kept.flatMap((a) => [a.titre, a.constat, a.action])];
  for (const n of new Set(texts.flatMap((t) => unknownNumbers(t, prepared.payload)))) {
    warnings.push(`chiffre absent des données : ${n}`);
  }

  const unknownPseudonyms = new Set<string>();
  const restore = (t: string) => restoreNames(t, prepared.pseudonyms, unknownPseudonyms);
  const content: BriefContent = {
    resume: restore(parsed.resume),
    actions: kept.map((a) => ({
      signal: a.signal,
      code: a.source.id,
      titre: restore(a.titre),
      constat: restore(a.constat),
      action: restore(a.action),
      lien: a.source.link,
    })),
  };
  for (const p of unknownPseudonyms) warnings.push(`pseudonyme inconnu : ${p}`);

  return { ok: true, content, warnings };
}
