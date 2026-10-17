import fc from 'fast-check';
import { COMPOUNDINGS, type FundEvent, type FundInput } from '../src/engine';

/**
 * Random but valid fund: 1–4 LPs, 1–12 events with sorted dates between 2020 and 2032, any
 * compounding, and a catch-up of 0, 50%, 80% or 100% (carry is capped at 40% so all four are valid).
 *
 * Rates are whole basis points and amounts are whole cents, not fc.double. fc.double deliberately
 * favours edge values (0, tiny numbers, min/max). That's good for finding crashes, but here it
 * made almost every hurdle and carry rate ≈ 0, so no generated fund ever paid a catch-up and the
 * catch-up properties passed without testing anything. The coverage test checks this.
 */
const rate = (maxBps: number) => fc.integer({ min: 0, max: maxBps }).map((bps) => bps / 10_000);
const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map((c) => c / 100);

export const fundArb: fc.Arbitrary<FundInput> = fc
  .record({
    hurdleRate: rate(2000),
    carryRate: rate(4000),
    catchUpRate: fc.constantFrom(0, 0.5, 0.8, 1),
    compounding: fc.constantFrom(...COMPOUNDINGS),
    commitments: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 4 }),
    rawEvents: fc.array(
      fc.record({
        isCall: fc.boolean(),
        dayOffset: fc.integer({ min: 0, max: 12 * 365 }),
        amount: cents(1000),
      }),
      { minLength: 1, maxLength: 12 },
    ),
    nav: fc.option(cents(1000), { nil: undefined }),
  })
  .map(({ hurdleRate, carryRate, catchUpRate, compounding, commitments, rawEvents, nav }) => {
    const sorted = [...rawEvents].sort((a, b) => a.dayOffset - b.dayOffset);
    // Valid funds start with a capital call (validation rejects anything else).
    sorted[0]!.isCall = true;
    const toDate = (offset: number) => new Date(Date.UTC(2020, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
    const events: FundEvent[] = sorted.map((e, i) => {
      const date = toDate(e.dayOffset);
      return e.isCall
        ? { id: `e${i}`, kind: 'capital_call', date, investment: e.amount, fee: 0 }
        : { id: `e${i}`, kind: 'distribution', date, amount: e.amount };
    });
    return {
      terms: { structure: 'european', hurdleRate, compounding, catchUpRate, carryRate },
      partners: commitments.map((c, i) => ({ id: `LP-${i}`, role: 'LP', commitment: c })),
      events,
      ...(nav === undefined ? {} : { nav: { date: toDate(sorted.at(-1)!.dayOffset + 30), amount: nav } }),
    } satisfies FundInput;
  });

