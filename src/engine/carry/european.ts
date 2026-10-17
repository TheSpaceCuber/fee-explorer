import type { CarryTerms, EventTrace, FundEvent, PartnerLedger, TierAllocation } from '../types';
import { accrue } from './hurdle';
import { carrySplit, catchUp, preferredReturn, returnOfCapital, type TierOutcome } from './tiers';

/**
 * European (whole-of-fund) waterfall for one partner.
 *
 * "European" means the GP earns no carry until the LP has got back ALL contributed capital plus
 * the hurdle on it, across the whole fund. Individual deals don't matter, only total cash in and
 * cash out. That's why one ledger per partner is enough.
 */

export const emptyLedger = (): PartnerLedger => ({
  asOf: null,
  capitalOutstanding: 0,
  prefAccrued: 0,
  contributed: 0,
  distributedLp: 0,
  distributedGp: 0,
  cumulative: { roc: 0, pref: 0, catchUpLp: 0, catchUpGp: 0, splitLp: 0, splitGp: 0 },
});

export interface StepResult {
  ledger: PartnerLedger;
  allocations: TierAllocation[];
  trace: EventTrace;
}

/** The tiers in payment order. Adding a tier means adding a line here. */
const TIER_STEPS: ((cash: number, l: PartnerLedger, t: CarryTerms) => TierOutcome)[] = [
  (cash, l) => returnOfCapital(cash, l),
  preferredReturn,
  catchUp,
  carrySplit,
];

/**
 * Apply one event (already scaled to this partner's share) to the ledger.
 *
 * This is a pure "reducer": (state, event) → new state + outputs. The whole run is
 * `events.reduce(applyEvent, emptyLedger())`. That same shape gives us:
 *   - step-through mode: show the trace for one event,
 *   - re-runs: same inputs always give the same outputs,
 *   - per-tier storage: the allocations are the rows,
 *   - hypothetical liquidation: apply a pretend distribution and look at the result.
 */
export function applyEvent(
  terms: CarryTerms,
  partnerId: string,
  before: PartnerLedger,
  event: FundEvent,
  kind: EventTrace['kind'] = event.kind,
): StepResult {
  // Always accrue up to the event date first. Pref depends on how long capital was out.
  const accrued = accrue(before, event.date, terms);
  let ledger = accrued.ledger;

  if (event.kind === 'capital_call') {
    const amount = event.investment + event.fee;
    ledger = {
      ...ledger,
      capitalOutstanding: ledger.capitalOutstanding + amount,
      contributed: ledger.contributed + amount,
    };
    return {
      ledger,
      allocations: [],
      trace: { eventId: event.id, date: event.date, kind, amount, accrual: accrued.note, steps: [], ledgerAfter: ledger },
    };
  }

  // Distribution: run the tiers in order, each taking what it's owed from what's left.
  const outcomes: TierOutcome[] = [];
  let cash = event.amount;
  for (const step of TIER_STEPS) {
    const out = step(cash, ledger, terms);
    outcomes.push(out);
    cash = out.remaining;
    ledger = out.ledger;
  }

  const lp = outcomes.reduce((s, o) => s + o.lp, 0);
  const gp = outcomes.reduce((s, o) => s + o.gp, 0);
  ledger = { ...ledger, distributedLp: ledger.distributedLp + lp, distributedGp: ledger.distributedGp + gp };

  return {
    ledger,
    allocations: outcomes.map((o) => ({ eventId: event.id, partnerId, tier: o.tier, lp: o.lp, gp: o.gp })),
    trace: {
      eventId: event.id,
      date: event.date,
      kind,
      amount: event.amount,
      accrual: accrued.note,
      ledgerAfter: ledger,
      steps: outcomes.map((o) => ({
        eventId: event.id,
        partnerId,
        tier: o.tier,
        available: o.available,
        owed: o.owed,
        lp: o.lp,
        gp: o.gp,
        remaining: o.remaining,
        explanation: o.explanation,
      })),
    },
  };
}

export interface RunResult {
  ledger: PartnerLedger;
  allocations: TierAllocation[];
  trace: EventTrace[];
}

/** Run every event for one partner. */
export function runEuropean(terms: CarryTerms, partnerId: string, events: FundEvent[]): RunResult {
  return events.reduce<RunResult>(
    (acc, event) => {
      const step = applyEvent(terms, partnerId, acc.ledger, event);
      return {
        ledger: step.ledger,
        allocations: acc.allocations.concat(step.allocations),
        trace: acc.trace.concat(step.trace),
      };
    },
    { ledger: emptyLedger(), allocations: [], trace: [] },
  );
}
