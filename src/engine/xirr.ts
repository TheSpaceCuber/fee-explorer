import { dayNumber } from './daycount';
import type { ISODate } from './types';

export interface DatedFlow {
  date: ISODate;
  /** Negative = money paid in (contributions). Positive = money received (distributions, NAV). */
  amount: number;
}

/**
 * XIRR: the annual rate r at which the present value of all dated cash flows is zero.
 *
 *     NPV(r) = Σ amount_i / (1 + r)^(t_i),   t_i = (date_i − date_0) / 365
 *
 * This matches Excel's XIRR (ACT/365F, measured from the first flow). There's no formula for r,
 * so we search for it numerically:
 *
 * 1. Newton's method: start from a guess and jump to where the tangent of NPV crosses zero.
 *    It's very fast near the answer, but it can overshoot to r ≤ −100% where NPV is undefined.
 * 2. Bisection as a fallback: find rates where NPV has opposite signs, then halve the interval
 *    until it's tiny. It's slower, but it can't fail once a sign change has been found.
 *
 * Returns null when there's no answer, e.g. all flows have the same sign.
 */
export function xirr(flows: DatedFlow[], guess = 0.1): number | null {
  const nonZero = flows.filter((f) => f.amount !== 0);
  if (!nonZero.some((f) => f.amount < 0) || !nonZero.some((f) => f.amount > 0)) return null;

  const d0 = Math.min(...nonZero.map((f) => dayNumber(f.date)));
  const ts = nonZero.map((f) => (dayNumber(f.date) - d0) / 365);
  const amounts = nonZero.map((f) => f.amount);

  const npv = (r: number) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + r, ts[i]!), 0);
  // Derivative of NPV with respect to r, needed by Newton.
  const dnpv = (r: number) => amounts.reduce((s, a, i) => s - (ts[i]! * a) / Math.pow(1 + r, ts[i]! + 1), 0);

  const TOL = 1e-12;

  // --- Newton ---
  let r = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(r);
    const df = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;
    const next = r - f / df;
    if (next <= -1 || !Number.isFinite(next)) break; // left the valid range, so use bisection
    if (Math.abs(next - r) < TOL) return next;
    r = next;
  }

  // --- Bisection ---
  let lo = -0.999999;
  let hi = 1;
  // Widen hi until NPV changes sign (very high IRRs happen with short holding periods).
  while (Math.sign(npv(lo)) === Math.sign(npv(hi)) && hi < 1e6) hi *= 2;
  if (Math.sign(npv(lo)) === Math.sign(npv(hi))) return null;
  for (let i = 0; i < 300 && hi - lo > TOL; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(npv(mid)) === Math.sign(npv(lo))) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
