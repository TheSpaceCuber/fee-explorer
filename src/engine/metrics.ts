import type { FundInput, WaterfallResult } from './types';
import { xirr, type DatedFlow } from './xirr';

/**
 * Fund performance from the LP's point of view (net of carry).
 *
 * - Paid-in: everything the LPs contributed (investment + fees).
 * - DPI (distributions / paid-in): cash actually back in LPs' pockets per $1 paid in. "Realized."
 * - TVPI (total value / paid-in): DPI plus what the LPs still hold (NAV) per $1 paid in.
 *   "Realized + unrealized." TVPI = DPI when there's no NAV left.
 * - Net IRR: XIRR of the LP cash flows, with NAV treated as if paid out on its date.
 *
 * M1 caveat: the NAV is gross. If it were sold today, part of it would go to the GP as carry.
 * M2 subtracts that "accrued carry" through a hypothetical liquidation.
 */
export interface FundMetrics {
  paidIn: number;
  distributedLp: number;
  carryGp: number;
  nav: number;
  dpi: number | null;
  tvpi: number | null;
  irr: number | null;
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
  if (input.nav && input.nav.amount > 0) flows.push({ date: input.nav.date, amount: input.nav.amount });
  return flows;
}

export function computeMetrics(input: FundInput, result: WaterfallResult): FundMetrics {
  const paidIn = input.events.reduce((s, e) => (e.kind === 'capital_call' ? s + e.investment + e.fee : s), 0);
  const distributedLp = result.allocations.reduce((s, a) => s + a.lp, 0);
  const carryGp = result.allocations.reduce((s, a) => s + a.gp, 0);
  const nav = input.nav?.amount ?? 0;
  return {
    paidIn,
    distributedLp,
    carryGp,
    nav,
    dpi: paidIn > 0 ? distributedLp / paidIn : null,
    tvpi: paidIn > 0 ? (distributedLp + nav) / paidIn : null,
    irr: xirr(lpCashFlows(input, result)),
  };
}
