import type { CarryTerms, PartnerLedger, Tier } from '../types';

/**
 * The waterfall tiers, one function each.
 *
 * Every tier has the same shape: it takes the cash still available and the ledger, takes what
 * it is owed, and returns
 *   - the LP and GP amounts it paid out,
 *   - the cash it passes on to the next tier,
 *   - the updated ledger.
 *
 * Because they share a shape, the waterfall is just these functions run in order, passing the
 * remaining cash down. M2 adds a catch-up tier between PREF and SPLIT without changing the others.
 */
export interface TierOutcome {
  tier: Tier;
  available: number;
  lp: number;
  gp: number;
  remaining: number;
  ledger: PartnerLedger;
  explanation: string;
}

const fmt = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Tier 1: give the LP back the capital it put in, before anything else. */
export function returnOfCapital(available: number, ledger: PartnerLedger): TierOutcome {
  // Math.min means we never pay more than is available or more than is owed.
  const paid = Math.min(available, ledger.capitalOutstanding);
  const stillOwed = ledger.capitalOutstanding - paid;
  return {
    tier: 'ROC',
    available,
    lp: paid,
    gp: 0,
    remaining: available - paid,
    ledger: { ...ledger, capitalOutstanding: stillOwed },
    explanation:
      paid === 0
        ? 'All contributed capital has already been returned, so nothing is paid here.'
        : `The LP gets back ${fmt(paid)} of contributed capital.` +
          (stillOwed > 0 ? ` ${fmt(stillOwed)} is still owed and will come first next time.` : ' All capital is now returned.'),
  };
}

/** Tier 2: pay the LP the hurdle return accrued so far. */
export function preferredReturn(available: number, ledger: PartnerLedger, terms: CarryTerms): TierOutcome {
  const paid = Math.min(available, ledger.prefAccrued);
  const stillOwed = ledger.prefAccrued - paid;
  const pct = `${fmt(terms.hurdleRate * 100)}%`;
  return {
    tier: 'PREF',
    available,
    lp: paid,
    gp: 0,
    remaining: available - paid,
    ledger: { ...ledger, prefAccrued: stillOwed },
    explanation:
      available === 0
        ? 'No cash reached this tier.'
        : `The LP gets ${fmt(paid)} of preferred return (the ${pct} hurdle accrued on its capital).` +
          (stillOwed > 0 ? ` ${fmt(stillOwed)} is still owed and keeps compounding.` : ' The hurdle is now fully met.'),
  };
}

/** Tier 3: everything left is profit above the hurdle, split between LP and GP. */
export function carrySplit(available: number, ledger: PartnerLedger, terms: CarryTerms): TierOutcome {
  const gp = available * terms.carryRate;
  const lp = available - gp; // subtract instead of multiplying by (1 − carry), so lp + gp is exactly `available`
  return {
    tier: 'SPLIT',
    available,
    lp,
    gp,
    remaining: 0,
    ledger,
    explanation:
      available === 0
        ? 'Nothing is left above the hurdle, so the GP earns no carry on this distribution.'
        : `The remaining ${fmt(available)} is profit above the hurdle. The GP takes ${fmt(terms.carryRate * 100)}% ` +
          `as carry (${fmt(gp)}) and the LP keeps ${fmt(lp)}.`,
  };
}
