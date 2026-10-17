import { computeMetrics, lpCashFlows, runFund, xirr, type CarryTerms, type FeeClass, type FundEvent, type FundInput, type ISODate } from '../engine';
import { dayNumber } from '../engine/daycount';

/**
 * Calibration: rebuild a plausible GROSS fund from the NET figures an LP reports.
 *
 * Public pensions publish, per fund: commitment, capital contributed, capital distributed, remaining
 * value (NAV), net multiple and net IRR. Those are numbers AFTER the GP's fees and carry. They don't
 * include dated cash flows, the deals' own (gross) returns, or the fund's actual terms.
 *
 * So we assume a timing shape (when capital was called and returned) and a set of terms, then search
 * for the gross amounts that make the engine reproduce the reported net figures:
 *
 *   I  investment called       so that  investment + fees            = reported contributed
 *   s  gross distributions     so that  LP net distributions         = reported distributed
 *   N  gross NAV               so that  LP net NAV (after accrued carry) = reported remaining value
 *   d  timing shift (days)     so that  LP net IRR                   = reported IRR
 *
 * Each unknown is found by bisection (or a fixed point for I), and the four are cycled a few
 * times because they nudge each other slightly. The result is ONE gross story consistent with
 * the net facts. Change the assumed terms and you get a different one. That's the lesson of the
 * net-to-gross panel.
 */

export interface ReportedFund {
  name: string;
  vintage: number;
  asOf: ISODate;
  commitment: number;
  contributed: number;
  distributed: number;
  nav: number;
  tvpi: number;
  irr: number;
}

/** When money moved, as weights. Call weights sum to 1; distribution weights sum to 1. */
export interface Shape {
  calls: [ISODate, number][];
  dists: [ISODate, number][];
  /** Share of invested cost still held at the as-of date (0 for a fully realized fund). */
  costStillHeld: number;
}

export interface AssumedTerms {
  carry: CarryTerms;
  feeStart: ISODate;
  fees: FeeClass;
}

export interface Calibration {
  input: FundInput;
  /** What the calibrated fund reports, to compare with the published figures. */
  fit: { contributed: number; distributed: number; nav: number; tvpi: number | null; irr: number | null };
  /** The gross story behind it. */
  gross: { investment: number; distributions: number; nav: number; moic: number | null; irr: number | null; fees: number; carry: number };
  /** Days the distribution dates were moved to hit the IRR. */
  shiftDays: number;
}

const DAY = 86_400_000;
const shiftDate = (date: ISODate, days: number) => new Date((dayNumber(date) + Math.round(days)) * DAY).toISOString().slice(0, 10);

/** Bisection for an increasing function f on [lo, hi]: returns x with f(x) ≈ target. */
function solveIncreasing(f: (x: number) => number, target: number, lo: number, hi: number, iterations = 28): number {
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function buildInput(r: ReportedFund, shape: Shape, terms: AssumedTerms, I: number, s: number, N: number, d: number): FundInput {
  const events: FundEvent[] = [
    ...shape.calls.map(([date, w], i): FundEvent => ({ id: `call-${i + 1}`, kind: 'capital_call', date, investment: I * w, fee: 0, dealId: 'Portfolio' })),
    ...shape.dists.map(([date, w], i): FundEvent => ({
      id: `dist-${i + 1}`,
      kind: 'distribution',
      date: shiftDate(date, d),
      amount: s * w,
      costRealized: I * (1 - shape.costStillHeld) * w,
      dealId: 'Portfolio',
    })),
  ];
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    terms: terms.carry,
    partners: [{ id: 'Public pension (LP)', role: 'LP', commitment: r.commitment, feeClassId: 'standard' }],
    events,
    ...(N > 0 ? { nav: { date: r.asOf, amount: N } } : {}),
    fees: { start: terms.feeStart, classes: { standard: terms.fees } },
  };
}

export function calibrate(r: ReportedFund, shape: Shape, terms: AssumedTerms): Calibration {
  // Each solve only needs one number, so compute just that (full metrics run three IRR searches).
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const fees = (input: FundInput) => sum(runFund(input).fees.map((f) => f.amount));
  const distributedLp = (input: FundInput) => sum(runFund(input).partners.map((p) => p.ledger.distributedLp));
  const netNav = (input: FundInput) => sum(runFund(input).partners.flatMap((p) => p.liquidation?.steps.map((x) => x.lp) ?? []));
  const irr = (input: FundInput) => xirr(lpCashFlows(input, runFund(input))) ?? -1;

  // How far the distribution dates may move: not before the first call, not after the as-of date.
  const firstCall = dayNumber(shape.calls[0]![0]);
  const firstDist = dayNumber(shape.dists[0]![0]);
  const lastDist = dayNumber(shape.dists.at(-1)![0]);
  const dMin = firstCall + 30 - firstDist;
  const dMax = dayNumber(r.asOf) - 1 - lastDist;

  let I = r.contributed * 0.9;
  let s = r.distributed;
  let N = r.nav / 0.8;
  let d = 0;

  for (let pass = 0; pass < 3; pass++) {
    // I: investment + fees = contributed. Fees depend (a little) on I, so iterate to a fixed point.
    for (let k = 0; k < 3; k++) I = r.contributed - fees(buildInput(r, shape, terms, I, s, N, d));
    // s: LP net distributions rise with gross distributions.
    s = solveIncreasing((x) => distributedLp(buildInput(r, shape, terms, I, x, N, d)), r.distributed, 0, r.distributed * 5 + 1);
    // N: LP net NAV rises with gross NAV.
    N = r.nav > 0 ? solveIncreasing((x) => netNav(buildInput(r, shape, terms, I, s, x, d)), r.nav, 0, r.nav * 3 + 1) : 0;
    // d: later distributions → lower IRR, so solve on −d. 12 halvings of a ~10-year range ≈ 1 day.
    d = -solveIncreasing((x) => irr(buildInput(r, shape, terms, I, s, N, -x)), r.irr, -dMax, -dMin, 12);
  }
  // One last touch-up of the amounts after the final timing move.
  s = solveIncreasing((x) => distributedLp(buildInput(r, shape, terms, I, x, N, d)), r.distributed, 0, r.distributed * 5 + 1);

  const input = buildInput(r, shape, terms, I, s, N, d);
  const m = computeMetrics(input, runFund(input));
  return {
    input,
    fit: { contributed: m.paidIn, distributed: m.distributedLp, nav: m.netNav, tvpi: m.tvpi, irr: m.irr },
    gross: {
      investment: m.bridge.investment,
      distributions: m.bridge.distributions,
      nav: m.bridge.nav,
      moic: m.bridge.grossMoic,
      irr: m.bridge.grossIrr,
      fees: m.fees,
      carry: m.carryGp + m.accruedCarry,
    },
    shiftDays: Math.round(d),
  };
}

/**
 * Net-to-gross: hold the published NET figures fixed and re-solve the gross story under each set
 * of assumed terms. Every row reproduces the same net TVPI and IRR, yet needs a different gross
 * return. That's why gross performance can't be backed out of LP reports without the terms.
 */
export function solveGross(r: ReportedFund, shape: Shape, terms: AssumedTerms) {
  const c = calibrate(r, shape, terms);
  return {
    grossMoic: c.gross.moic,
    grossIrr: c.gross.irr,
    fees: c.gross.fees,
    carry: c.gross.carry,
    netTvpi: c.fit.tvpi,
    netIrr: c.fit.irr,
  };
}
