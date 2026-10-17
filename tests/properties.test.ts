import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeMetrics, runFund, type FundEvent, type FundInput } from '../src/engine';
import { carryPaid, profitPaid } from '../src/engine/carry/tiers';
import { fundArb } from './arbitraries';

/**
 * Property tests: rules that must hold for ANY fund, not just the hand-worked ones.
 *
 * fast-check generates hundreds of random funds. If a property fails, it "shrinks" the input to
 * the smallest fund that still fails and prints it. That gives you a ready-made hand-worked case.
 */

const EPS = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

const distributions = (input: FundInput) =>
  input.events.filter((e): e is Extract<FundEvent, { kind: 'distribution' }> => e.kind === 'distribution');

/**
 * A property only proves something if the random funds actually reach the code it's about.
 * This checks the generator produces enough interesting cases. It exists because an earlier
 * version never produced a single catch-up payment (see arbitraries.ts).
 */
describe('generator coverage', () => {
  it('produces funds that pay pref, catch-up, carry, and end mid-catch-up', () => {
    const counts = { pref: 0, catchUp: 0, split: 0, endsInCatchUp: 0, fees: 0, investedBasisFees: 0, clawback: 0 };
    // Fixed seed: a coverage check must not pass or fail depending on luck.
    // (The properties below still use a fresh random seed every run, to keep exploring.)
    for (const input of fc.sample(fundArb, { numRuns: 2000, seed: 20261017 })) {
      const result = runFund(input);
      if (result.fees.length > 0) counts.fees++;
      if ((result.comparison?.clawback ?? 0) > EPS) counts.clawback++;
      if (result.fees.some((f) => f.basis === 'invested_capital' && f.amount > EPS)) counts.investedBasisFees++;
      const p = result.partners[0]!;
      const steps = p.trace.flatMap((ev) => ev.steps);
      if (steps.some((s) => s.tier === 'PREF' && s.lp > EPS)) counts.pref++;
      if (steps.some((s) => s.tier === 'CATCHUP' && s.gp > EPS)) counts.catchUp++;
      if (steps.some((s) => s.tier === 'SPLIT' && s.gp > EPS)) counts.split++;
      const last = p.trace.filter((ev) => ev.steps.length > 0).at(-1);
      const cu = last?.steps.find((s) => s.tier === 'CATCHUP');
      if (cu && cu.gp > EPS && cu.remaining <= EPS) counts.endsInCatchUp++;
    }
    expect(counts.pref).toBeGreaterThan(400);
    expect(counts.catchUp).toBeGreaterThan(200);
    expect(counts.split).toBeGreaterThan(200);
    expect(counts.endsInCatchUp).toBeGreaterThan(10);
    expect(counts.fees).toBeGreaterThan(400);
    expect(counts.investedBasisFees).toBeGreaterThan(200);
    expect(counts.clawback).toBeGreaterThan(50);
  }, 30_000); // 2,000 funds with fee schedules take a few seconds
});

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
        const result = runFund(input);
        for (const a of [...result.allocations, ...(result.liquidation?.allocations ?? [])]) {
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
          for (const ev of p.trace) {
            const [roc, pref, ...gpTiers] = ev.steps;
            // Cash reached CATCHUP or SPLIT only if ROC and PREF passed something on.
            if (gpTiers.some((s) => s.gp > 0)) {
              expect(roc!.remaining).toBeGreaterThan(0);
              expect(pref!.remaining).toBeGreaterThan(0);
            }
          }
          expect(p.ledger.capitalOutstanding).toBeGreaterThanOrEqual(-EPS);
          expect(p.ledger.prefAccrued).toBeGreaterThanOrEqual(-EPS);
        }
      }),
    );
  });

  it('the GP never has more than its carry rate of the profit paid so far', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const c = input.terms.carryRate;
        for (const p of runFund(input).partners) {
          for (const ev of p.trace) {
            const cum = ev.ledgerAfter.cumulative;
            expect(carryPaid(cum)).toBeLessThanOrEqual(c * profitPaid(cum) + EPS * Math.max(1, profitPaid(cum)));
          }
        }
      }),
    );
  });

  it('with a catch-up, a distribution that reaches the split leaves the GP at exactly its carry rate', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        if (input.terms.catchUpRate === 0) return;
        const c = input.terms.carryRate;
        // Only carry-paying partners: the GP's own commitment pays 0% carry by design.
        for (const p of runFund(input).partners.filter((x) => x.role === 'LP')) {
          for (const ev of p.trace) {
            const split = ev.steps.find((s) => s.tier === 'SPLIT');
            if (split && split.available > EPS) {
              const cum = ev.ledgerAfter.cumulative;
              expect(close(carryPaid(cum), c * profitPaid(cum))).toBe(true);
            }
          }
        }
      }),
    );
  });

  it('with identical terms, each LP gets exactly its pro-rata share of the fund result', () => {
    fc.assert(
      fc.property(fundArb, (generated) => {
        // Identical terms: drop the fees and make every partner a plain LP.
        const { fees: _, ...rest } = generated;
        const input: FundInput = { ...rest, partners: generated.partners.map((p) => ({ id: p.id, role: 'LP', commitment: p.commitment })) };
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
      fc.property(fundArb, fc.integer({ min: 0, max: 1000 }), (input, bumpBps) => {
        const bump = bumpBps / 10_000;
        const carry = (i: FundInput) => runFund(i).allocations.reduce((s, a) => s + a.gp, 0);
        const low = carry(input);
        const high = carry({ ...input, terms: { ...input.terms, hurdleRate: input.terms.hurdleRate + bump } });
        expect(high).toBeLessThanOrEqual(low + EPS * Math.max(1, low));
      }),
    );
  });

  it('the gross-to-net bridge reconciles with what the partners actually got', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const result = runFund(input);
        const { bridge } = computeMetrics(input, result);
        // Net profit computed bottom-up from each partner's own ledger and liquidation:
        const fromPartners = result.partners.reduce((s, p) => {
          const navLp = p.liquidation?.steps.reduce((t, x) => t + x.lp, 0) ?? 0;
          return s + p.ledger.distributedLp + navLp + p.clawback - p.ledger.contributed;
        }, 0);
        expect(Math.abs(bridge.netProfit - fromPartners)).toBeLessThanOrEqual(1e-7 * Math.max(1, Math.abs(fromPartners)));
      }),
    );
  });

  it('fees are never negative and only charged inside a fee period', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        for (const f of runFund(input).fees) {
          expect(f.amount).toBeGreaterThan(0);
          const partner = input.partners.find((p) => p.id === f.partnerId)!;
          const periods = input.fees!.classes[partner.feeClassId!]!.periods;
          expect(periods.some((p) => p.from <= f.date && f.date < p.to)).toBe(true);
        }
      }),
    );
  });

  it('charging management fees never gives the GP more carry', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        if (!input.fees) return;
        const { fees: _, ...noFees } = input;
        const carry = (i: FundInput) => runFund(i).allocations.reduce((s, a) => s + a.gp, 0);
        const withoutPartnerClasses: FundInput = { ...noFees, partners: input.partners.map(({ feeClassId: __, ...p }) => p) };
        expect(carry(input)).toBeLessThanOrEqual(carry(withoutPartnerClasses) + EPS * Math.max(1, carry(withoutPartnerClasses)));
      }),
    );
  });

  it('the GP commitment never pays carry or fees', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const gp = runFund(input).partners.find((p) => p.role === 'GP');
        if (!gp) return;
        expect(gp.ledger.distributedGp).toBe(0);
        expect(gp.fees).toHaveLength(0);
      }),
    );
  });

  it('American: after the clawback, the GP never keeps more carry than European would give', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const result = runFund({ ...input, terms: { ...input.terms, structure: 'american' } });
        const c = result.comparison!;
        expect(c.americanCarry - c.clawback).toBeLessThanOrEqual(c.europeanCarry + 1e-9 * Math.max(1, c.europeanCarry));
      }),
    );
  });

  it('American: recovering realized losses never gives the GP more carry than ignoring them', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const carry = (lossRecovery: 'none' | 'realized') =>
          runFund({ ...input, terms: { ...input.terms, structure: 'american', lossRecovery } }).allocations.reduce((s, a) => s + a.gp, 0);
        const none = carry('none');
        expect(carry('realized')).toBeLessThanOrEqual(none + EPS * Math.max(1, none));
      }),
    );
  });

  it('the hypothetical liquidation does not change real allocations', () => {
    fc.assert(
      fc.property(fundArb, (input) => {
        const { nav: _, ...withoutNav } = input;
        expect(runFund(input).allocations).toEqual(runFund(withoutNav).allocations);
      }),
    );
  });
});
