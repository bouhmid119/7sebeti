import type { Currency } from '../money';
import type { Signal } from '../signals';
import type { BriefAction, BriefContent } from './output';
import { type BriefPayload, prepareBrief } from './payload';
import { briefFromRules, describeSignals, type SignalView } from './rules';

/** Un brief tel qu'il est stocké (table ai_brief), réduit à ce qui sert à l'afficher. */
export interface StoredBrief {
  status: string;
  signals: readonly Signal[];
  payload: BriefPayload | null;
  pseudonyms: Record<string, string> | null;
  content: BriefContent | null;
}

export interface BriefPresentation {
  /** ai : texte de Claude validé. rules : phrases fixes. null : aucun signal ce jour-là. */
  source: 'ai' | 'rules' | null;
  resume: string | null;
  actions: BriefAction[];
  /** Les signaux sans action rédigée, dans l'ordre d'argent en jeu. */
  otherSignals: SignalView[];
}

/**
 * Ce que l'écran Actions montre pour un jour : le texte de Claude s'il est prêt, sinon les
 * phrases fixes (IA coupée, en attente ou en échec), puis les autres signaux du jour.
 */
export function presentBrief(
  brief: StoredBrief,
  options: { asOf: string; currency: Currency },
): BriefPresentation {
  if (brief.signals.length === 0) return { source: null, resume: null, actions: [], otherSignals: [] };

  let source: 'ai' | 'rules' = 'ai';
  let content = brief.status === 'ready' ? brief.content : null;
  if (!content) {
    source = 'rules';
    const prepared = brief.payload
      ? { payload: brief.payload, pseudonyms: brief.pseudonyms ?? {} }
      : prepareBrief(brief.signals, options);
    content = briefFromRules(prepared, brief.signals);
  }

  const shown = new Set(content.actions.map((a) => a.signal));
  return {
    source,
    resume: content.resume,
    actions: content.actions,
    otherSignals: describeSignals(brief.signals, options).filter((s) => !shown.has(s.signal)),
  };
}
