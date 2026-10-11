import { briefFromRules, computeSignals, prepareBrief, unknownNumbers } from '@7sebeti/domain';
import { describe, expect, it } from 'vitest';
import { BENCH_AS_OF, generateBenchScenarios, generateScenario } from './scenarios';

describe('banc d’essai du brief', () => {
  const cases = generateBenchScenarios(40);

  it('produit 40 boutiques fictives, reproductibles, sans donnée personnelle', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(40);
    expect(generateScenario(7).id).toBe(generateScenario(7).id);
    expect(generateScenario(7).input.orders.length).toBe(generateScenario(7).input.orders.length);
    const blob = JSON.stringify(cases);
    expect(blob).not.toMatch(/\+216|sk-ant-|AGE-SECRET|@gmail|@outlook/);
    expect(cases.every((c) => c.input.asOf === BENCH_AS_OF)).toBe(true);
  });

  it('calcule des signaux et des phrases fixes qui n’inventent aucun chiffre', () => {
    const withSignals = cases.filter((c) => computeSignals(c.input).length > 0);
    expect(withSignals.length).toBeGreaterThanOrEqual(30);
    for (const c of cases) {
      const signals = computeSignals(c.input);
      const prepared = prepareBrief(signals, { asOf: c.input.asOf, currency: c.currency });
      const content = briefFromRules(prepared, signals);
      for (const text of [
        content.resume,
        ...content.actions.flatMap((a) => [a.titre, a.constat, a.action]),
      ]) {
        expect(unknownNumbers(text, prepared.payload)).toEqual([]);
      }
    }
  });
});
