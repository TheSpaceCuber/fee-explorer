import type { CarryTerms, EventTrace, FundEvent, TierAllocation } from '../types';
import { applyAmerican } from './american';
import { applyEuropean, emptyLedger, type StepResult } from './european';

/** Pick the reducer for the structure. Everything else (tiers, accrual) is shared. */
export function applyEvent(
  terms: CarryTerms,
  partnerId: string,
  before: StepResult['ledger'],
  event: FundEvent,
  kind: EventTrace['kind'] = event.kind,
): StepResult {
  return terms.structure === 'american'
    ? applyAmerican(terms, partnerId, before, event, kind)
    : applyEuropean(terms, partnerId, before, event, kind);
}

export interface RunResult {
  ledger: StepResult['ledger'];
  allocations: TierAllocation[];
  trace: EventTrace[];
}

/** Run every event for one partner: `events.reduce(applyEvent, emptyLedger())`. */
export function runPartner(terms: CarryTerms, partnerId: string, events: FundEvent[]): RunResult {
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
