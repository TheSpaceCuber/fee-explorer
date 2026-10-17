import fc from 'fast-check';
import { COMPOUNDINGS, type FeePeriod, type FundEvent, type FundInput, type ManagementFeeTerms, type Partner } from '../src/engine';

/**
 * Random but valid fund for property tests:
 *  - 1–4 LPs, optionally a GP commitment,
 *  - 1–12 events with sorted dates between 2020 and 2032; distributions may carry a cost sold,
 *  - any compounding, catch-up of 0 / 50% / 80% / 100% (carry is capped at 40% so all are valid),
 *  - optional NAV,
 *  - optional management fees: a commitment-basis period, then an invested-capital period, with an
 *    optional size discount (whole or marginal). LPs are spread over two fee classes.
 *
 * Rates are whole basis points and amounts are whole cents, not fc.double. fc.double deliberately
 * favours edge values (0, tiny numbers, min/max). That's good for finding crashes, but here it
 * made almost every hurdle and carry rate ≈ 0, so no generated fund ever paid a catch-up and the
 * catch-up properties passed without testing anything. The coverage test checks this.
 */
const rate = (maxBps: number) => fc.integer({ min: 0, max: maxBps }).map((bps) => bps / 10_000);
const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map((c) => c / 100);
const toDate = (offset: number) => new Date(Date.UTC(2020, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);

const feesArb: fc.Arbitrary<ManagementFeeTerms | undefined> = fc.option(
  fc
    .record({
      ipRate: rate(250),
      postRate: rate(200),
      ipYears: fc.integer({ min: 1, max: 6 }),
      postYears: fc.integer({ min: 0, max: 6 }),
      discount: fc.option(
        fc.record({ mode: fc.constantFrom('whole' as const, 'marginal' as const), min: fc.integer({ min: 1, max: 800 }), cut: rate(100) }),
        { nil: undefined },
      ),
    })
    .map(({ ipRate, postRate, ipYears, postYears, discount }) => {
      const ipEnd = `${2020 + ipYears}-01-01`;
      const periods: FeePeriod[] = [{ from: '2020-01-01', to: ipEnd, rate: ipRate, basis: 'commitment' }];
      if (postYears > 0) periods.push({ from: ipEnd, to: `${2020 + ipYears + postYears}-01-01`, rate: postRate, basis: 'invested_capital' });
      const standard = discount
        ? { periods, sizeDiscount: { mode: discount.mode, bands: [{ minCommitment: discount.min, rateReduction: discount.cut }] } }
        : { periods };
      // A side-letter class: same schedule at half the rate.
      const reduced = { periods: periods.map((p) => ({ ...p, rate: p.rate / 2 })) };
      return { start: '2020-01-01', classes: { standard, reduced } };
    }),
  { nil: undefined },
);

export const fundArb: fc.Arbitrary<FundInput> = fc
  .record({
    hurdleRate: rate(2000),
    carryRate: rate(4000),
    catchUpRate: fc.constantFrom(0, 0.5, 0.8, 1),
    compounding: fc.constantFrom(...COMPOUNDINGS),
    commitments: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 4 }),
    gpCommit: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
    rawEvents: fc.array(
      fc.record({
        isCall: fc.boolean(),
        dayOffset: fc.integer({ min: 0, max: 12 * 365 }),
        amount: cents(1000),
        costFraction: rate(10_000),
      }),
      { minLength: 1, maxLength: 12 },
    ),
    nav: fc.option(cents(1000), { nil: undefined }),
    fees: feesArb,
  })
  .map(({ hurdleRate, carryRate, catchUpRate, compounding, commitments, gpCommit, rawEvents, nav, fees }) => {
    const sorted = [...rawEvents].sort((a, b) => a.dayOffset - b.dayOffset);
    // Valid funds start with a capital call (validation rejects anything else).
    sorted[0]!.isCall = true;
    let invested = 0;
    const events: FundEvent[] = sorted.map((e, i) => {
      const date = toDate(e.dayOffset);
      if (e.isCall) {
        invested += e.amount;
        return { id: `e${i}`, kind: 'capital_call', date, investment: e.amount, fee: 0 };
      }
      // Cost sold: some fraction of what's still invested, so invested capital never goes negative.
      const costRealized = Math.round(invested * e.costFraction * 100) / 100;
      invested -= costRealized;
      return { id: `e${i}`, kind: 'distribution', date, amount: e.amount, costRealized };
    });

    const partners: Partner[] = commitments.map((c, i) => ({
      id: `LP-${i}`,
      role: 'LP',
      commitment: c,
      ...(fees ? { feeClassId: i % 2 === 0 ? 'standard' : 'reduced' } : {}),
    }));
    if (gpCommit !== undefined) partners.push({ id: 'GP', role: 'GP', commitment: gpCommit });

    return {
      terms: { structure: 'european', hurdleRate, compounding, catchUpRate, carryRate },
      partners,
      events,
      ...(nav === undefined ? {} : { nav: { date: toDate(sorted.at(-1)!.dayOffset + 30), amount: nav } }),
      ...(fees ? { fees } : {}),
    } satisfies FundInput;
  });
