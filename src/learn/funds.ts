import { addMonths, type CarryTerms, type FeeBasis, type FeeClass, type FundEvent, type FundInput, type Partner, type SizeDiscount } from '../engine';

/**
 * "Example Fund I": the one synthetic fund the early lessons share, so you meet the same numbers
 * again and again. $100m committed; $85m invested in four deals over 2020–22; four exits over
 * 2023–27; $10m of value still held at the end of 2027.
 *
 * Parts 1–2 switch carry off on purpose: the lessons are about cash flows and management fees.
 * Part 3 switches carry on (via `carry`) and fees off, so each part teaches one thing.
 */

export const FUND_NAME = 'Example Fund I';

const CALLS: [string, number, string][] = [
  ['2020-03-31', 25, 'A'],
  ['2020-12-31', 25, 'B'],
  ['2021-09-30', 20, 'C'],
  ['2022-06-30', 15, 'D'],
];
/** [date, amount, deal, cost of what was sold] */
const DISTS: [string, number, string, number][] = [
  ['2023-06-30', 20, 'D', 12],
  ['2024-12-31', 45, 'B', 25],
  ['2026-06-30', 60, 'A', 25],
  ['2027-12-31', 50, 'C', 20],
];
const NAV = { date: '2027-12-31', amount: 10 };

export interface FundOptions {
  /** Annual management fee during the investment period (0 = no fees). */
  feeRate?: number;
  /** Length of the investment period in years. Omit for one flat rate for the fund's whole life. */
  ipYears?: number;
  /** Rate after the investment period (default: two-thirds of feeRate). */
  postRate?: number;
  postBasis?: FeeBasis;
  /** Move every distribution (and the NAV date) this many years later. */
  delayYears?: number;
  /** Partners (default: one LP with the whole $100m). Their feeClassId picks a class from `feeClasses`. */
  partners?: Partner[];
  /** Extra fee classes; 'standard' is built from the options above. */
  feeClasses?: Record<string, FeeClass>;
  /** Size discount applied to the standard class. */
  sizeDiscount?: SizeDiscount;
  /** Carry terms (default: no carry). E.g. { carryRate: 0.2, hurdleRate: 0.08, catchUpRate: 1 }. */
  carry?: Partial<CarryTerms>;
  /** Value still held at the end (default $10m). */
  navAmount?: number;
}

/** No carry: what Parts 1–2 use. */
const NO_CARRY: CarryTerms = { structure: 'european', hurdleRate: 0, compounding: 'annual', catchUpRate: 0, carryRate: 0 };

export const DEFAULT_LP: Partner = { id: 'Pension LP', role: 'LP', commitment: 100, feeClassId: 'standard' };

export function standardFeeClass(o: FundOptions): FeeClass {
  const rate = o.feeRate ?? 0;
  const discount = o.sizeDiscount ? { sizeDiscount: o.sizeDiscount } : {};
  if (o.ipYears === undefined) return { periods: [{ from: '2020-01-01', to: '2030-01-01', rate, basis: 'commitment' }], ...discount };
  const ipEnd = `${2020 + o.ipYears}-01-01`;
  return {
    ...discount,
    periods: [
      { from: '2020-01-01', to: ipEnd, rate, basis: 'commitment' },
      { from: ipEnd, to: '2030-01-01', rate: o.postRate ?? Math.round(rate * (2 / 3) * 1e6) / 1e6, basis: o.postBasis ?? 'invested_capital' },
    ],
  };
}

export function exampleFund(o: FundOptions = {}): FundInput {
  const shift = (date: string) => (o.delayYears ? addMonths(date, Math.round(o.delayYears * 12)) : date);
  const events: FundEvent[] = [
    ...CALLS.map(([date, investment, dealId], i): FundEvent => ({ id: `call-${i + 1}`, kind: 'capital_call', date, investment, fee: 0, dealId })),
    ...DISTS.map(([date, amount, dealId, costRealized], i): FundEvent => ({ id: `dist-${i + 1}`, kind: 'distribution', date: shift(date), amount, dealId, costRealized })),
  ];
  const fees = (o.feeRate ?? 0) > 0;
  const partners = (o.partners ?? [DEFAULT_LP]).map((p) => {
    if (fees) return p;
    const { feeClassId: _, ...rest } = p;
    return rest;
  });
  return {
    terms: { ...NO_CARRY, ...(o.carry ?? {}) },
    partners,
    events,
    nav: { date: shift(NAV.date), amount: o.navAmount ?? NAV.amount },
    ...(fees ? { fees: { start: '2020-01-01', classes: { standard: standardFeeClass(o), ...(o.feeClasses ?? {}) } } } : {}),
  };
}
