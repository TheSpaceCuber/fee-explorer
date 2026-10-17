import type {
  CarryTerms,
  FundEvent,
  PartnerLedger,
  TierAllocation,
  TraceStep,
} from '../types';
import { accrue } from './hurdle';
import { carrySplit, preferredReturn, returnOfCapital, type TierOutcome } from './tiers';

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
});

export interface StepResult {
  ledger: PartnerLedger;
  allocations: TierAllocation[];
  trace: TraceStep[];
}

/**
 * Apply one event (already scaled to this partner's share) to the ledger.
 *
 * This is a pure "reducer": (state, event) → new state + outputs. The whole run is
 * `events.reduce(applyEvent, emptyLedger())`. That same shape gives us:
 *   - step-through mode: show the trace for one event,
 *   - re-runs: same inputs always give the same outputs,
 *   - per-tier storage: the allocations are the rows.
 */
export function applyEvent(
  terms: CarryTerms,
  partnerId: string,
  before: PartnerLedger,
  event: FundEvent,
): StepResult {
  // Always accrue up to the event date first. Pref depends on how long capital was out.
  let ledger = accrue(before, event.date, terms);

  if (event.kind === 'capital_call') {
    const amount = event.investment + event.fee;
    ledger = {
      ...ledger,
      capitalOutstanding: ledger.capitalOutstanding + amount,
      contributed: ledger.contributed + amount,
    };
    return { ledger, allocations: [], trace: [] };
  }

  // Distribution: run the tiers in order, each taking what it's owed from what's left.
  const outcomes: TierOutcome[] = [];
  let cash = event.amount;
  const steps = [
    (c: number, l: PartnerLedger) => returnOfCapital(c, l),
    (c: number, l: PartnerLedger) => preferredReturn(c, l, terms),
    (c: number, l: PartnerLedger) => carrySplit(c, l, terms),
  ];
  for (const step of steps) {
    const out = step(cash, ledger);
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
    trace: outcomes.map((o) => ({
      eventId: event.id,
      partnerId,
      tier: o.tier,
      available: o.available,
      lp: o.lp,
      gp: o.gp,
      remaining: o.remaining,
      explanation: o.explanation,
    })),
  };
}

/** Run every event for one partner. */
export function runEuropean(terms: CarryTerms, partnerId: string, events: FundEvent[]): StepResult {
  return events.reduce<StepResult>(
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
