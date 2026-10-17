import { describe, expect, it } from 'vitest';
import { xirr, type DatedFlow } from '../src/engine';
import { dayNumber } from '../src/engine/daycount';
import oracle from './fixtures/xirr-oracle.json';

/** Our XIRR against pyxirr (Excel-compatible), on waterfall cases and harder generic shapes. */

const npv = (flows: DatedFlow[], r: number) => {
  const d0 = Math.min(...flows.map((f) => dayNumber(f.date)));
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (dayNumber(f.date) - d0) / 365), 0);
};

describe('xirr vs pyxirr oracle', () => {
  for (const c of [...oracle.cases, ...oracle.generic]) {
    it(c.id, () => {
      const ours = xirr(c.flows);
      expect(ours).not.toBeNull();
      // Relative tolerance so the 11,663% case (G3) is judged fairly.
      const err = Math.abs(ours! - c.irr) / Math.max(1, Math.abs(c.irr));
      expect(err).toBeLessThan(1e-8);
    });
  }
});

describe('xirr behaviour', () => {
  it('returns null when every flow has the same sign', () => {
    expect(xirr([{ date: '2020-01-01', amount: -100 }, { date: '2021-01-01', amount: -5 }])).toBeNull();
    expect(xirr([{ date: '2020-01-01', amount: 100 }])).toBeNull();
  });

  it('returns a rate at which NPV is zero', () => {
    const flows = oracle.generic.find((g) => g.id === 'G5-pe-jcurve')!.flows;
    const r = xirr(flows)!;
    expect(Math.abs(npv(flows, r))).toBeLessThan(1e-9);
  });

  it('falls back to bisection when Newton starts far away', () => {
    const flows = oracle.generic.find((g) => g.id === 'G3-short-high')!.flows;
    const r = xirr(flows, -0.99)!;
    expect(Math.abs(npv(flows, r))).toBeLessThan(1e-6);
  });
});
