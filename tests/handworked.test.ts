import { describe, expect, it } from 'vitest';
import { computeMetrics, lpCashFlows, runFund, ValidationError, type DatedFlow, type FundInput, type Tier } from '../src/engine';
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
    ...(c.fees ? { fees: c.fees as FundInput['fees'] & object } : {}),
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

      if (expected.fees) {
        expect(result.fees.reduce((s, f) => s + f.amount, 0)).toBeCloseTo(expected.fees.total, 9);
        expect(result.fees.map((f) => [f.date, f.partnerId])).toEqual(
          [...expected.fees.lines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((f) => [f.date, f.partnerId]),
        );
        for (const want of expected.fees.lines) {
          const got = result.fees.find((f) => f.date === want.date && f.partnerId === want.partnerId)!;
          expect(got.amount, `fee ${want.partnerId} ${want.date}`).toBeCloseTo(want.amount, 9);
        }
      }

      if (expected.lpFlows) {
        expect(byDate(lpCashFlows(input, result))).toEqual(
          expect.arrayContaining(expected.lpFlows.map((f) => [f.date, expect.closeTo(f.amount, 9)])),
        );
        expect(byDate(lpCashFlows(input, result)).length).toBe(expected.lpFlows.length);
      }

      if (expected.clawback) {
        expect(result.comparison, 'expected an American comparison').not.toBeNull();
        expect(result.comparison!.americanCarry).toBeCloseTo(expected.clawback.american, 9);
        expect(result.comparison!.europeanCarry).toBeCloseTo(expected.clawback.european, 9);
        expect(result.comparison!.clawback).toBeCloseTo(expected.clawback.clawback, 9);
      }

      const m = computeMetrics(input, result);
      if (expected.bridge) {
        for (const [k, v] of Object.entries(expected.bridge)) {
          expect(m.bridge[k as keyof typeof m.bridge] as number, `bridge.${k}`).toBeCloseTo(v, 9);
        }
      }
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

/** Sum flows per date, so [call, fee call] on one day compare as one flow. Zero flows (e.g. a write-off) are dropped. */
function byDate(flows: DatedFlow[]): [string, number][] {
  const m = new Map<string, number>();
  for (const f of flows) m.set(f.date, (m.get(f.date) ?? 0) + f.amount);
  return [...m.entries()].filter(([, a]) => Math.abs(a) > 1e-12).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

interface Expected {
  allocations: { eventId: string; tier: Tier; lp: number; gp: number }[];
  totals: { lp: number; gp: number };
  endState: { capitalOutstanding: number; prefAccrued: number };
  byPartner?: Record<string, { lp: number; gp: number }>;
  metrics: { paidIn: number; dpi: number; tvpi: number; irr: number | null; accruedCarry?: number };
  fees?: { total: number; lines: { date: string; partnerId: string; amount: number }[] };
  lpFlows?: DatedFlow[];
  bridge?: Record<string, number>;
  clawback?: { american: number; european: number; clawback: number };
}
