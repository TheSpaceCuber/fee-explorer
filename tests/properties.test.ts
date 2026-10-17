import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runFund, type FundEvent, type FundInput } from '../src/engine';

/**
 * Property tests: rules that must hold for ANY fund, not just the hand-worked ones.
 *
 * fast-check generates hundreds of random funds. If a property fails, it "shrinks" the input to
 * the smallest fund that still fails and prints it. That gives you a ready-made hand-worked case.
 */

const EPS = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

/** Random but valid fund: 1–4 LPs and 1–12 events with sorted dates between 2020 and 2032. */
const fundArb: fc.Arbitrary<FundInput> = fc
  .record({
    hurdleRate: fc.double({ min: 0, max: 0.2, noNaN: true }),
    carryRate: fc.double({ min: 0, max: 0.4, noNaN: true }),
    commitments: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 4 }),
    rawEvents: fc.array(
      fc.record({
        isCall: fc.boolean(),
        dayOffset: fc.integer({ min: 0, max: 12 * 365 }),
        amount: fc.double({ min: 0, max: 1000, noNaN: true }),
      }),
      { minLength: 1, maxLength: 12 },
    ),
  })
  .map(({ hurdleRate, carryRate, commitments, rawEvents }) => {
    const sorted = [...rawEvents].sort((a, b) => a.dayOffset - b.dayOffset);
    // Valid funds start with a capital call (validation rejects anything else).
    sorted[0]!.isCall = true;
    const events: FundEvent[] = sorted.map((e, i) => {
      const date = new Date(Date.UTC(2020, 0, 1) + e.dayOffset * 86_400_000).toISOString().slice(0, 10);
      return e.isCall
        ? { id: `e${i}`, kind: 'capital_call', date, investment: e.amount, fee: 0 }
        : { id: `e${i}`, kind: 'distribution', date, amount: e.amount };
    });
    return {
      terms: { structure: 'european', hurdleRate, compounding: 'annual', catchUpRate: 0, carryRate },
      partners: commitments.map((c, i) => ({ id: `LP-${i}`, role: 'LP', commitment: c })),
      events,
    } satisfies FundInput;
  });

const distributions = (input: FundInput) =>
  input.events.filter((e): e is Extract<FundEvent, { kind: 'distribution' }> => e.kind === 'distribution');

describe('waterfall properties', () => {
  it('every distribution is fully allocated: LP + GP = amount', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const { allocations } = runFund(input);
        for (const d of distributions(input)) {
          const rows = allocations.filter((a) => a.eventId === d.id);
          const total = rows.reduce((s, a) => s + a.lp + a.gp, 0);
          expect(close(total, d.amount)).toBe(true);
        }
      }),
    );
  });

  it('total allocations equal total distributions', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const { allocations } = runFund(input);
        const allocated = allocations.reduce((s, a) => s + a.lp + a.gp, 0);
        const distributed = distributions(input).reduce((s, d) => s + d.amount, 0);
        expect(close(allocated, distributed)).toBe(true);
      }),
    );
  });

  it('no allocation is ever negative (carry is never negative)', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        for (const a of runFund(input).allocations) {
          expect(a.lp).toBeGreaterThanOrEqual(0);
          expect(a.gp).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('the GP only earns carry once the LP is fully caught up on capital and pref', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        for (const p of runFund(input).partners) {
          // Walk the trace: a SPLIT with gp > 0 means ROC and PREF passed cash on, so neither was short.
          for (const step of p.trace) {
            if (step.tier === 'SPLIT' && step.gp > 0) {
              const roc = p.trace.find((s) => s.eventId === step.eventId && s.tier === 'ROC')!;
              const pref = p.trace.find((s) => s.eventId === step.eventId && s.tier === 'PREF')!;
              expect(roc.remaining).toBeGreaterThan(0);
              expect(pref.remaining).toBeGreaterThan(0);
            }
          }
          expect(p.ledger.capitalOutstanding).toBeGreaterThanOrEqual(-EPS);
          expect(p.ledger.prefAccrued).toBeGreaterThanOrEqual(-EPS);
        }
      }),
    );
  });

  it('with identical terms, each LP gets exactly its pro-rata share of the fund result', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const fund = runFund({ ...input, partners: [{ id: 'ALL', role: 'LP', commitment: 1 }] });
        const fundLp = fund.partners[0]!.ledger.distributedLp;
        const fundGp = fund.partners[0]!.ledger.distributedGp;
        for (const p of runFund(input).partners) {
          expect(close(p.ledger.distributedLp, p.share * fundLp)).toBe(true);
          expect(close(p.ledger.distributedGp, p.share * fundGp)).toBe(true);
        }
      }),
    );
  });

  it('a higher hurdle never gives the GP more carry', () => {
    fc.assert(
      fc.property(fundArb, fc.double({ min: 0, max: 0.1, noNaN: true }), (input, bump) => {
        const carry = (i: FundInput) => runFund(i).allocations.reduce((s, a) => s + a.gp, 0);
        const low = carry(input);
        const high = carry({ ...input, terms: { ...input.terms, hurdleRate: input.terms.hurdleRate + bump } });
        expect(high).toBeLessThanOrEqual(low + EPS * Math.max(1, low));
      }),
    );
  });
});
