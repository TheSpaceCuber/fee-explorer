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
 * How the hurdle balance grows between events. See carry/hurdle.ts and docs/concepts.md.
 *  - simple:    only outstanding capital earns the hurdle; unpaid pref doesn't
 *  - annual:    (1 + r)^t, the IRR-equivalent convention
 *  - quarterly: (1 + r/4)^(4t)
 *  - daily:     (1 + r/365)^(365t)
 */
export type Compounding = 'simple' | 'annual' | 'quarterly' | 'daily';
export const COMPOUNDINGS: readonly Compounding[] = ['simple', 'annual', 'quarterly', 'daily'];

/**
 * Carried-interest terms. These are the waterfall parts of an LPA.
 * The types are deliberately narrow (e.g. structure is only 'european' until M4) so the
 * compiler stops us using features before they exist.
 */
export interface CarryTerms {
  structure: 'european';
  /** Preferred return ("hurdle"), e.g. 0.08 for 8% a year. */
  hurdleRate: number;
  compounding: Compounding;
  /**
   * GP share of each dollar inside the catch-up tier: 0 (no catch-up), or above carryRate up to 1.
   * 1 = "full" catch-up. The ILPA model LPA brackets 0.8.
   */
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

/** The waterfall tiers, in payment order. */
export type Tier = 'ROC' | 'PREF' | 'CATCHUP' | 'SPLIT';
export const TIERS: readonly Tier[] = ['ROC', 'PREF', 'CATCHUP', 'SPLIT'];

/** Running totals per tier. The catch-up tier needs them to know how far behind the GP is. */
export interface Cumulative {
  roc: number;
  pref: number;
  catchUpLp: number;
  catchUpGp: number;
  splitLp: number;
  splitGp: number;
}

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
  cumulative: Cumulative;
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
  /** What the tier was owed before paying (null for SPLIT, which takes everything left). */
  owed: number | null;
  lp: number;
  gp: number;
  /** Cash passed on to the next tier. */
  remaining: number;
  explanation: string;
}

/** How the hurdle account moved between the previous event and this one. */
export interface AccrualNote {
  /** Years since the previous event (ACT/365F). */
  years: number;
  compounding: Compounding;
  capital: number;
  prefBefore: number;
  prefAfter: number;
}

/** Everything that happened to one partner at one event: for step-through and debugging. */
export interface EventTrace {
  eventId: string;
  date: ISODate;
  kind: FundEvent['kind'] | 'liquidation';
  /** Call or distribution amount for this partner. */
  amount: number;
  accrual: AccrualNote;
  /** Tier steps (distributions only; empty for calls). */
  steps: TraceStep[];
  ledgerAfter: PartnerLedger;
}

export interface PartnerResult {
  partnerId: string;
  /** Share of each fund-level flow (commitment / total commitments). */
  share: number;
  allocations: TierAllocation[];
  trace: EventTrace[];
  ledger: PartnerLedger;
  /**
   * Hypothetical liquidation: what the waterfall would do if the NAV were paid out on its date.
   * Not a real event, so it isn't in `allocations` and doesn't change `ledger`.
   */
  liquidation: EventTrace | null;
}

export type FundAllocation = Omit<TierAllocation, 'partnerId'>;

export interface WaterfallResult {
  partners: PartnerResult[];
  /** Fund-level allocations: partner rows summed per (event, tier). Every tier is listed, zeros included. */
  allocations: FundAllocation[];
  /** Fund-level hypothetical liquidation of the NAV (null when there's no NAV). */
  liquidation: { lp: number; gp: number; allocations: FundAllocation[] } | null;
}
