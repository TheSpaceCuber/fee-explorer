import { describe, expect, it } from 'vitest';
import { computeMetrics, runFund, ValidationError, type FundInput, type Tier } from '../src/engine';
import fixture from './fixtures/hand-worked.json';
import oracle from './fixtures/xirr-oracle.json';

/**
 * Runs every case in hand-worked.json through the engine.
 * Expected numbers come from the JSON, never from the engine, so this test can't pass by
 * "agreeing with itself".
 */

const TOL = 1e-9;

// A case may override the default terms or partners, so we merge.
type Case = (typeof fixture.cases)[number] & Record<string, unknown>;
function toInput(c: Case): FundInput {
  const terms = { ...fixture.defaults.terms, ...((c.terms as object | undefined) ?? {}) };
  const partners = (c.partners as FundInput['partners'] | undefined) ?? fixture.defaults.partners;
  return {
    terms: terms as FundInput['terms'],
    partners: partners as FundInput['partners'],
    events: c.events as FundInput['events'],
    ...(c.nav ? { nav: c.nav as FundInput['nav'] & object } : {}),
  };
}

const oracleIrr = new Map(oracle.cases.map((o) => [o.id, o.irr]));

describe('hand-worked cases', () => {
  for (const raw of fixture.cases) {
    const c = raw as Case;

    if ('expectedError' in c) {
      it(`${c.id}: ${c.title}`, () => {
        let error: unknown;
        try {
          runFund(toInput(c));
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ValidationError);
        const fields = (error as ValidationError).issues.map((i) => i.field);
        expect(fields.some((f) => f.includes(c.expectedError as string))).toBe(true);
      });
      continue;
    }

    it(`${c.id}: ${c.title}`, () => {
      const input = toInput(c);
      const result = runFund(input);
      const expected = (c as unknown as { expected: Expected }).expected;

      // Allocations: any tier the fixture leaves out must be 0.
      for (const row of result.allocations) {
        const want = expected.allocations.find((a) => a.eventId === row.eventId && a.tier === row.tier);
        expect(row.lp, `${row.eventId} ${row.tier} lp`).toBeCloseTo(want?.lp ?? 0, 9);
        expect(row.gp, `${row.eventId} ${row.tier} gp`).toBeCloseTo(want?.gp ?? 0, 9);
      }

      const lp = result.allocations.reduce((s, a) => s + a.lp, 0);
      const gp = result.allocations.reduce((s, a) => s + a.gp, 0);
      expect(lp).toBeCloseTo(expected.totals.lp, 9);
      expect(gp).toBeCloseTo(expected.totals.gp, 9);

      // End state, summed across partners.
      const capital = result.partners.reduce((s, p) => s + p.ledger.capitalOutstanding, 0);
      const pref = result.partners.reduce((s, p) => s + p.ledger.prefAccrued, 0);
      expect(Math.abs(capital - expected.endState.capitalOutstanding)).toBeLessThan(TOL);
      expect(Math.abs(pref - expected.endState.prefAccrued)).toBeLessThan(TOL);

      if (expected.byPartner) {
        for (const [id, want] of Object.entries(expected.byPartner)) {
          const p = result.partners.find((x) => x.partnerId === id)!;
          expect(p.ledger.distributedLp).toBeCloseTo(want.lp, 9);
          expect(p.ledger.distributedGp).toBeCloseTo(want.gp, 9);
        }
      }

      const m = computeMetrics(input, result);
      expect(m.paidIn).toBeCloseTo(expected.metrics.paidIn, 9);
      expect(m.dpi!).toBeCloseTo(expected.metrics.dpi, 9);
      expect(m.tvpi!).toBeCloseTo(expected.metrics.tvpi, 9);
      expect(m.accruedCarry).toBeCloseTo(expected.metrics.accruedCarry ?? 0, 9);
      // IRR: use the hand-derived value if there is one, otherwise the Python oracle's.
      const wantIrr = expected.metrics.irr ?? oracleIrr.get(c.id);
      expect(wantIrr, 'no expected IRR in fixture or oracle').toBeTypeOf('number');
      expect(m.irr!).toBeCloseTo(wantIrr as number, 8);
    });
  }
});

interface Expected {
  allocations: { eventId: string; tier: Tier; lp: number; gp: number }[];
  totals: { lp: number; gp: number };
  endState: { capitalOutstanding: number; prefAccrued: number };
  byPartner?: Record<string, { lp: number; gp: number }>;
  metrics: { paidIn: number; dpi: number; tvpi: number; irr: number | null; accruedCarry?: number };
}
