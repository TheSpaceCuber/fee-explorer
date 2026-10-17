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

/**
 * A partner in the fund.
 *  - role 'LP': an investor. Pays management fees (per its fee class) and carry.
 *  - role 'GP': the manager's own commitment ("GP commit", typically 1–2%). It invests alongside the
 *    LPs but pays no fees and no carry on its own money, and it's left out of LP metrics.
 */
export interface Partner {
  id: string;
  role: 'LP' | 'GP';
  /** Commitment: the total the partner has promised to fund when called. */
  commitment: number;
  /** Key into ManagementFeeTerms.classes. No fee class → no management fee. */
  feeClassId?: string;
}

// ---------------------------------------------------------------------------
// Management fees (M3)
// ---------------------------------------------------------------------------

/**
 * What the fee rate is applied to.
 *  - commitment: the partner's full commitment, typical during the investment period.
 *  - invested_capital: investment called minus the cost of investments sold, typical after the
 *    investment period. It shrinks as the fund exits deals, so fees step down.
 */
export type FeeBasis = 'commitment' | 'invested_capital';

/** One stretch of the fee schedule: an annual rate on a basis, for billing dates in [from, to). */
export interface FeePeriod {
  from: ISODate;
  to: ISODate;
  rate: number;
  basis: FeeBasis;
}

/**
 * Discount for large commitments (a "size ratchet").
 *  - whole: the whole commitment gets the biggest reduction whose threshold it meets.
 *  - marginal: like tax brackets, each slice of commitment above a threshold gets that band's reduction.
 */
export interface SizeDiscount {
  mode: 'whole' | 'marginal';
  bands: { minCommitment: number; rateReduction: number }[];
}

/** A fee class: the terms shared by a group of LPs (e.g. "standard", or a side letter). */
export interface FeeClass {
  periods: FeePeriod[];
  sizeDiscount?: SizeDiscount;
}

/** Fees are billed quarterly in advance on start + 0, 3, 6, … months, as `rate / 4 × basis`. */
export interface ManagementFeeTerms {
  start: ISODate;
  classes: Record<string, FeeClass>;
}

/** One quarterly fee charge for one partner. */
export interface FeeLine {
  partnerId: string;
  /** Id of the capital call that funds it. */
  eventId: string;
  date: ISODate;
  periodIndex: number;
  basis: FeeBasis;
  basisAmount: number;
  /** Annual rate after any size discount. */
  rate: number;
  amount: number;
}

/** A dated cash flow from the partner's point of view: negative = paid in, positive = received. */
export interface DatedFlow {
  date: ISODate;
  amount: number;
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
  /**
   * Cost of the investments sold to produce this cash. It doesn't affect the waterfall, but it
   * reduces invested capital, which is the fee basis after the investment period.
   */
  costRealized?: number;
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
  /**
   * Fund-level events in date order. Each partner gets its commitment share. Capital calls here
   * are for investments. Fee calls are generated per partner from `fees`.
   */
  events: FundEvent[];
  nav?: NavMark;
  fees?: ManagementFeeTerms;
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
  /** Paid to the partner itself (an LP, or the GP on its own commitment). */
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
  role: Partner['role'];
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
  /** Management fees charged to this partner. */
  fees: FeeLine[];
  /** This partner's cash flows: calls (investment + fee) negative, distributions received positive. */
  flows: DatedFlow[];
}

export type FundAllocation = Omit<TierAllocation, 'partnerId'>;

export interface WaterfallResult {
  partners: PartnerResult[];
  /** Fund-level allocations: partner rows summed per (event, tier). Every tier is listed, zeros included. */
  allocations: FundAllocation[];
  /** Fund-level hypothetical liquidation of the NAV (null when there's no NAV). */
  liquidation: { lp: number; gp: number; allocations: FundAllocation[] } | null;
  /** Every fee line for every partner, in date order. */
  fees: FeeLine[];
}
