/**
 * Engine data model.
 *
 * Everything here is plain JSON-shaped data: no classes, no Date objects (dates are ISO strings).
 * That keeps the engine pure and easy to mirror in another language (e.g. Python dataclasses).
 */

/** Calendar date as 'YYYY-MM-DD'. Time zones don't matter for fund cash flows. */
export type ISODate = string;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/**
 * Carried-interest terms. These are the waterfall parts of an LPA.
 * M1 supports only European, annual compounding and no catch-up. The types are deliberately
 * narrow so the compiler stops us using features before they exist. Later milestones widen them.
 */
export interface CarryTerms {
  structure: 'european';
  /** Preferred return ("hurdle"), e.g. 0.08 for 8% a year. */
  hurdleRate: number;
  compounding: 'annual';
  /** GP share of each dollar inside the catch-up tier. Must be 0 in M1. */
  catchUpRate: number;
  /** GP share of profits above the hurdle, e.g. 0.20. */
  carryRate: number;
}

export interface Partner {
  id: string;
  role: 'LP';
  /** Commitment: the total the partner has promised to fund when called. */
  commitment: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * A capital call: money flowing from LPs into the fund.
 * `investment` buys assets. `fee` pays the management fee (always 0 until M3).
 * Both count as contributed capital, so both come back to the LP in the ROC tier.
 */
export interface CapitalCall {
  id: string;
  kind: 'capital_call';
  date: ISODate;
  investment: number;
  fee: number;
}

/** A distribution: money flowing out of the fund, to be split by the waterfall. */
export interface Distribution {
  id: string;
  kind: 'distribution';
  date: ISODate;
  amount: number;
}

export type FundEvent = CapitalCall | Distribution;

/** Value of what the fund still holds on a date. Used for TVPI and as a final flow in IRR. */
export interface NavMark {
  date: ISODate;
  amount: number;
}

/** Everything the engine needs for one run. */
export interface FundInput {
  terms: CarryTerms;
  partners: Partner[];
  /** Fund-level events in date order. Each partner gets its commitment share. */
  events: FundEvent[];
  nav?: NavMark;
}

// ---------------------------------------------------------------------------
// State and outputs
// ---------------------------------------------------------------------------

/** The waterfall tiers, in payment order. CATCHUP is added in M2. */
export type Tier = 'ROC' | 'PREF' | 'SPLIT';
export const TIERS: readonly Tier[] = ['ROC', 'PREF', 'SPLIT'];

/**
 * What the waterfall must remember about one partner between events.
 *
 * capitalOutstanding + prefAccrued is the "hurdle account": how much the LP must still receive
 * before the GP shares in profit. See docs/concepts.md.
 */
export interface PartnerLedger {
  /** Date the ledger was last brought up to date (null before the first event). */
  asOf: ISODate | null;
  /** Contributed capital not yet returned. */
  capitalOutstanding: number;
  /** Hurdle return earned but not yet paid. */
  prefAccrued: number;
  /** Running totals, for reporting. */
  contributed: number;
  distributedLp: number;
  distributedGp: number;
}

/** One tier's share of one distribution, for one partner. This is what a database row stores. */
export interface TierAllocation {
  eventId: string;
  partnerId: string;
  tier: Tier;
  /** Paid to the LP. */
  lp: number;
  /** Paid to the GP as carry. */
  gp: number;
}

/** One line of the step-through: what a tier did and why. */
export interface TraceStep {
  eventId: string;
  partnerId: string;
  tier: Tier;
  /** Cash arriving at this tier. */
  available: number;
  lp: number;
  gp: number;
  /** Cash passed on to the next tier. */
  remaining: number;
  explanation: string;
}

export interface PartnerResult {
  partnerId: string;
  /** Share of each fund-level flow (commitment / total commitments). */
  share: number;
  allocations: TierAllocation[];
  trace: TraceStep[];
  ledger: PartnerLedger;
}

export interface WaterfallResult {
  partners: PartnerResult[];
  /** Fund-level allocations: partner rows summed per (event, tier). Every tier is listed, zeros included. */
  allocations: Omit<TierAllocation, 'partnerId'>[];
}
