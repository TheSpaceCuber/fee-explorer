import { addMonths, dayNumber } from '../daycount';
import type { CapitalCall, FeeClass, FeeLine, FundEvent, ISODate, ManagementFeeTerms, Partner, SizeDiscount } from '../types';

/**
 * Management fees: what the GP charges each year to run the fund, whether or not it makes money.
 *
 * A typical schedule (and what this module supports):
 *   - investment period (e.g. the first 5 years): ~2% a year on COMMITMENTS,
 *   - after that: a lower rate (e.g. 1.5%) on INVESTED CAPITAL, which falls as deals are sold,
 *   - billed quarterly in advance: on each billing date, rate / 4 × basis,
 *   - paid by calling capital from the LPs, so fees count as contributed capital. They come back
 *     to the LP through the ROC tier and earn pref, which is why fees reduce carry.
 *
 * Everything here is per partner, because fee terms can differ per partner (size discounts,
 * side letters). That's what makes per-partner waterfalls diverge.
 */

/** Billing dates: start + 0, 3, 6, … months, while before `until`. */
export function billingDates(start: ISODate, until: ISODate): ISODate[] {
  const dates: ISODate[] = [];
  const end = dayNumber(until);
  for (let k = 0; ; k++) {
    const d = addMonths(start, 3 * k);
    if (dayNumber(d) >= end) break;
    dates.push(d);
  }
  return dates;
}

/**
 * Annual rate after a size discount.
 *
 * Example: base 2%, one band "≥ 50 → −0.5%", commitment 60.
 *   whole:    the whole 60 qualifies → 1.5%
 *   marginal: 50 at 2% + 10 at 1.5% = 1.15 a year → blended 1.15 / 60 = 1.9167%
 */
export function discountedRate(baseRate: number, commitment: number, discount?: SizeDiscount): number {
  if (!discount || discount.bands.length === 0 || commitment <= 0) return baseRate;
  const bands = [...discount.bands].sort((a, b) => a.minCommitment - b.minCommitment);

  if (discount.mode === 'whole') {
    const met = bands.filter((b) => commitment >= b.minCommitment);
    const reduction = met.length ? Math.max(...met.map((b) => b.rateReduction)) : 0;
    return Math.max(0, baseRate - reduction);
  }

  // marginal: slice the commitment at each threshold.
  // [0, b1) at the base rate, [b1, b2) at base − b1.reduction, [b2, ∞) at base − b2.reduction, …
  let annualFee = 0;
  const edges = [0, ...bands.map((b) => b.minCommitment), Infinity];
  const reductions = [0, ...bands.map((b) => b.rateReduction)];
  for (let i = 0; i < reductions.length; i++) {
    const lo = edges[i]!;
    const hi = Math.min(edges[i + 1]!, commitment);
    if (hi > lo) annualFee += (hi - lo) * Math.max(0, baseRate - reductions[i]!);
  }
  return annualFee / commitment;
}

/**
 * Invested capital on a date, from this partner's (already scaled) events: investment called
 * minus the cost of investments sold, counting events dated on or before `date`.
 */
export function investedCapital(events: FundEvent[], date: ISODate): number {
  const day = dayNumber(date);
  let invested = 0;
  for (const e of events) {
    if (dayNumber(e.date) > day) break;
    if (e.kind === 'capital_call') invested += e.investment;
    else invested -= e.costRealized ?? 0;
  }
  return Math.max(0, invested);
}

/**
 * Every quarterly fee for one partner. Empty if the partner has no fee class.
 *
 * `asOf` (the NAV date, when there is one) caps the schedule: the NAV values the fund on that
 * date, so fees billed after it haven't happened yet. Without the cap, a fee call after the NAV
 * date would move the ledger's clock past the hypothetical liquidation. A property test found this.
 */
export function partnerFees(
  fees: ManagementFeeTerms | undefined,
  partner: Partner,
  events: FundEvent[],
  asOf?: ISODate,
): FeeLine[] {
  if (!fees || partner.feeClassId === undefined) return [];
  const cls: FeeClass = fees.classes[partner.feeClassId]!;
  if (cls.periods.length === 0) return [];

  const lastEnd = cls.periods.reduce((max, p) => (p.to > max ? p.to : max), cls.periods[0]!.to);
  const lines: FeeLine[] = [];
  for (const date of billingDates(fees.start, lastEnd)) {
    if (asOf !== undefined && date > asOf) break;
    const periodIndex = cls.periods.findIndex((p) => p.from <= date && date < p.to);
    if (periodIndex < 0) continue; // no period covers this date (a gap in the schedule)
    const period = cls.periods[periodIndex]!;
    const basisAmount = period.basis === 'commitment' ? partner.commitment : investedCapital(events, date);
    const rate = discountedRate(period.rate, partner.commitment, cls.sizeDiscount);
    const amount = (rate / 4) * basisAmount;
    if (amount <= 0) continue;
    lines.push({
      partnerId: partner.id,
      eventId: `fee:${partner.id}:${date}`,
      date,
      periodIndex,
      basis: period.basis,
      basisAmount,
      rate,
      amount,
    });
  }
  return lines;
}

/** Turn fee lines into capital calls (investment 0, fee = amount). */
export function feeCalls(lines: FeeLine[]): CapitalCall[] {
  return lines.map((l) => ({ id: l.eventId, kind: 'capital_call', date: l.date, investment: 0, fee: l.amount }));
}

/**
 * Merge fee calls into the partner's events, keeping date order. On the same date fee calls go
 * first: the fee is billed at the start of the quarter, before that day's other activity.
 */
export function mergeFeeCalls(events: FundEvent[], calls: CapitalCall[]): FundEvent[] {
  const out: FundEvent[] = [];
  let i = 0;
  for (const e of events) {
    while (i < calls.length && calls[i]!.date <= e.date) out.push(calls[i++]!);
    out.push(e);
  }
  while (i < calls.length) out.push(calls[i++]!);
  return out;
}
