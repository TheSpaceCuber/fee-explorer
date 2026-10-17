import type { DatedFlow, FundInput, PartnerResult, WaterfallResult } from './types';
import { xirr } from './xirr';

/**
 * Fund performance.
 *
 * LP metrics (what an LP's report shows) cover partners with role 'LP' only. The GP's own
 * commitment is left out, as in real LP reporting.
 *
 * - Paid-in: everything the LPs contributed, investment + management fees.
 * - DPI (distributions / paid-in): cash back per $1 paid in. "Realized."
 * - TVPI (total value / paid-in): DPI plus the LPs' share of the NAV, net of accrued carry.
 * - Net IRR: XIRR of the LPs' cash flows, with net NAV as a final flow. Net of fees and carry.
 *
 * The bridge (fund level, all partners) explains where the gross profit went:
 *
 *     gross profit  = distributions + NAV − investment called
 *   − management fees
 *   − carry paid
 *   − accrued carry (on the NAV)
 *   + clawback (American only: excess carry the GP pays back)
 *   = net profit to partners
 *
 * This always adds up, because every dollar of distributions goes either to partners or to carry,
 * and fees are money partners paid in on top of the investment. A property test checks it against
 * the partners' own ledgers.
 */
export interface Bridge {
  investment: number;
  distributions: number;
  nav: number;
  grossProfit: number;
  fees: number;
  carryPaid: number;
  accruedCarry: number;
  /** American only: carry the GP pays back at the end. */
  clawback: number;
  netProfit: number;
  /** (distributions + NAV) / investment: the deals' own multiple. */
  grossMoic: number | null;
  /** IRR of the deals: −investment calls, +distributions, +NAV. */
  grossIrr: number | null;
  /** IRR after fees but before carry: −(investment + fees), +distributions, +NAV. */
  irrAfterFees: number | null;
}

export interface FundMetrics {
  paidIn: number;
  fees: number;
  distributedLp: number;
  carryGp: number;
  /** NAV before accrued carry. */
  nav: number;
  /** Carry the GP would earn if the NAV were realized on its date. */
  accruedCarry: number;
  /** The LPs' share of the NAV, after accrued carry. */
  netNav: number;
  /**
   * American only: carry the GP pays back to the LPs at the end. Counted in DPI once the fund is
   * fully realized (no NAV); with NAV left it's an exposure, counted in TVPI only.
   */
  clawback: number;
  dpi: number | null;
  tvpi: number | null;
  irr: number | null;
  /**
   * GP share of the carry-bearing partners' profit (after fees): (carry paid + accrued) / profit.
   * Reaches the carry rate once the GP has fully caught up. null when there is no profit.
   */
  gpShareOfProfit: number | null;
  bridge: Bridge;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const liqLp = (p: PartnerResult) => sum(p.liquidation?.steps.map((s) => s.lp) ?? []);
const liqGp = (p: PartnerResult) => sum(p.liquidation?.steps.map((s) => s.gp) ?? []);

/** Cash flows of the given partners, with each one's net NAV as a final flow. */
export function partnersCashFlows(input: FundInput, partners: PartnerResult[]): DatedFlow[] {
  const flows = partners.flatMap((p) => p.flows);
  const netNav = sum(partners.map(liqLp));
  if (input.nav && netNav > 0) flows.push({ date: input.nav.date, amount: netNav });
  return flows;
}

/** LP investors' cash flows (GP commitment excluded). */
export function lpCashFlows(input: FundInput, result: WaterfallResult): DatedFlow[] {
  return partnersCashFlows(input, result.partners.filter((p) => p.role === 'LP'));
}

export function computeMetrics(input: FundInput, result: WaterfallResult): FundMetrics {
  const lps = result.partners.filter((p) => p.role === 'LP');
  const paidIn = sum(lps.map((p) => p.ledger.contributed));
  const distributedLp = sum(lps.map((p) => p.ledger.distributedLp));
  const netNav = sum(lps.map(liqLp));
  const nav = input.nav?.amount ?? 0;
  const carryGp = sum(result.partners.map((p) => p.ledger.distributedGp));
  const accruedCarry = sum(result.partners.map(liqGp));
  const clawback = sum(lps.map((p) => p.clawback));
  const realizedClawback = input.nav && input.nav.amount > 0 ? 0 : clawback;

  // GP share of profit, over the partners that pay carry.
  const profit = sum(lps.map((p) => p.ledger.distributedLp + p.ledger.distributedGp + p.share * nav - p.ledger.contributed));

  return {
    paidIn,
    fees: sum(lps.flatMap((p) => p.fees.map((f) => f.amount))),
    distributedLp,
    carryGp,
    nav,
    accruedCarry,
    netNav,
    clawback,
    dpi: paidIn > 0 ? (distributedLp + realizedClawback) / paidIn : null,
    tvpi: paidIn > 0 ? (distributedLp + netNav + clawback) / paidIn : null,
    irr: xirr(lpCashFlows(input, result)),
    gpShareOfProfit: profit > 1e-9 ? (carryGp + accruedCarry - clawback) / profit : null,
    bridge: computeBridge(input, result),
  };
}

export function computeBridge(input: FundInput, result: WaterfallResult): Bridge {
  const investmentFlows: DatedFlow[] = [];
  const outFlows: DatedFlow[] = [];
  for (const e of input.events) {
    if (e.kind === 'capital_call') investmentFlows.push({ date: e.date, amount: -e.investment });
    else outFlows.push({ date: e.date, amount: e.amount });
  }
  const nav = input.nav?.amount ?? 0;
  if (input.nav && nav > 0) outFlows.push({ date: input.nav.date, amount: nav });

  const investment = -sum(investmentFlows.map((f) => f.amount));
  const distributions = sum(input.events.map((e) => (e.kind === 'distribution' ? e.amount : 0)));
  const fees = sum(result.fees.map((f) => f.amount));
  const carryPaid = sum(result.allocations.map((a) => a.gp));
  const accruedCarry = result.liquidation?.gp ?? 0;
  const clawback = result.comparison?.clawback ?? 0;
  const grossProfit = distributions + nav - investment;
  const feeFlows = result.fees.map((f) => ({ date: f.date, amount: -f.amount }));

  return {
    investment,
    distributions,
    nav,
    grossProfit,
    fees,
    carryPaid,
    accruedCarry,
    clawback,
    netProfit: grossProfit - fees - carryPaid - accruedCarry + clawback,
    grossMoic: investment > 0 ? (distributions + nav) / investment : null,
    grossIrr: xirr([...investmentFlows, ...outFlows]),
    irrAfterFees: xirr([...investmentFlows, ...feeFlows, ...outFlows]),
  };
}
