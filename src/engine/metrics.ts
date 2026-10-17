import type { FundInput, WaterfallResult } from './types';
import { xirr, type DatedFlow } from './xirr';

/**
 * Fund performance from the LP's point of view (net of carry).
 *
 * - Paid-in: everything the LPs contributed (investment + fees).
 * - DPI (distributions / paid-in): cash actually back in LPs' pockets per $1 paid in. "Realized."
 * - TVPI (total value / paid-in): DPI plus the LPs' share of what the fund still holds.
 *   "Realized + unrealized." TVPI = DPI when there's no NAV left.
 * - Net IRR: XIRR of the LP cash flows, with net NAV treated as if paid out on its date.
 *
 * "Net NAV" = NAV minus accrued carry: the carry the GP would take if the NAV were sold today
 * (see the hypothetical liquidation in partners.ts). It's what an LP's capital account shows.
 */
export interface FundMetrics {
  paidIn: number;
  distributedLp: number;
  carryGp: number;
  /** NAV before accrued carry. */
  nav: number;
  /** Carry the GP would earn if the NAV were realized on its date. */
  accruedCarry: number;
  /** NAV after accrued carry: the LPs' share. */
  netNav: number;
  dpi: number | null;
  tvpi: number | null;
  irr: number | null;
  /**
   * GP share of total profit: (carry paid + accrued) / (all distributions + NAV − paid-in).
   * With a full catch-up this reaches the carry rate once the GP is caught up. Without one it
   * stays below. null when there is no profit.
   */
  gpShareOfProfit: number | null;
}

export function lpCashFlows(input: FundInput, result: WaterfallResult): DatedFlow[] {
  const flows: DatedFlow[] = [];
  for (const e of input.events) {
    if (e.kind === 'capital_call') {
      flows.push({ date: e.date, amount: -(e.investment + e.fee) });
    } else {
      const lp = result.allocations.filter((a) => a.eventId === e.id).reduce((s, a) => s + a.lp, 0);
      flows.push({ date: e.date, amount: lp });
    }
  }
  const netNav = result.liquidation?.lp ?? 0;
  if (input.nav && netNav > 0) flows.push({ date: input.nav.date, amount: netNav });
  return flows;
}

export function computeMetrics(input: FundInput, result: WaterfallResult): FundMetrics {
  const paidIn = input.events.reduce((s, e) => (e.kind === 'capital_call' ? s + e.investment + e.fee : s), 0);
  const distributedLp = result.allocations.reduce((s, a) => s + a.lp, 0);
  const carryGp = result.allocations.reduce((s, a) => s + a.gp, 0);
  const nav = input.nav?.amount ?? 0;
  const accruedCarry = result.liquidation?.gp ?? 0;
  const netNav = nav - accruedCarry;
  const profit = distributedLp + carryGp + nav - paidIn;
  return {
    paidIn,
    distributedLp,
    carryGp,
    nav,
    accruedCarry,
    netNav,
    dpi: paidIn > 0 ? distributedLp / paidIn : null,
    tvpi: paidIn > 0 ? (distributedLp + netNav) / paidIn : null,
    irr: xirr(lpCashFlows(input, result)),
    gpShareOfProfit: profit > 1e-9 ? (carryGp + accruedCarry) / profit : null,
  };
}
