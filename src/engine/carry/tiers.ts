import type { CarryTerms, Cumulative, PartnerLedger, Tier } from '../types';

/**
 * The waterfall tiers, one function each.
 *
 * Every tier has the same shape: it takes the cash still available and the ledger, takes what
 * it is owed, and returns
 *   - the LP and GP amounts it paid out,
 *   - what it was owed before paying (so the UI can draw a bucket and how full it got),
 *   - the cash it passes on to the next tier,
 *   - the updated ledger.
 *
 * Because they share a shape, the waterfall is just these functions run in order, passing the
 * remaining cash down.
 */
export interface TierOutcome {
  tier: Tier;
  available: number;
  owed: number | null;
  lp: number;
  gp: number;
  remaining: number;
  ledger: PartnerLedger;
  explanation: string;
}

const fmt = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 2 });
const pctOf = (x: number) => `${fmt(x * 100)}%`;

/** Add amounts to the running totals. */
const bump = (ledger: PartnerLedger, add: Partial<Cumulative>): PartnerLedger => {
  const c = { ...ledger.cumulative };
  for (const [k, v] of Object.entries(add) as [keyof Cumulative, number][]) c[k] += v;
  return { ...ledger, cumulative: c };
};

/** Profit paid out so far (LP and GP): everything except returned capital. */
export const profitPaid = (c: Cumulative) => c.pref + c.catchUpLp + c.catchUpGp + c.splitLp + c.splitGp;
/** Carry paid to the GP so far. */
export const carryPaid = (c: Cumulative) => c.catchUpGp + c.splitGp;

/** Tier 1: give the LP back the capital it put in, before anything else. */
export function returnOfCapital(available: number, ledger: PartnerLedger): TierOutcome {
  const owed = ledger.capitalOutstanding;
  // Math.min means we never pay more than is available or more than is owed.
  const paid = Math.min(available, owed);
  const stillOwed = owed - paid;
  return {
    tier: 'ROC',
    available,
    owed,
    lp: paid,
    gp: 0,
    remaining: available - paid,
    ledger: bump({ ...ledger, capitalOutstanding: stillOwed }, { roc: paid }),
    explanation:
      owed <= 0
        ? 'All contributed capital has already been returned, so nothing is paid here.'
        : `The LP is owed ${fmt(owed)} of contributed capital and gets back ${fmt(paid)}.` +
          (stillOwed > 1e-9 ? ` ${fmt(stillOwed)} is still owed and will come first next time.` : ' All capital is now returned.'),
  };
}

/** Tier 2: pay the LP the hurdle return accrued so far. */
export function preferredReturn(available: number, ledger: PartnerLedger, terms: CarryTerms): TierOutcome {
  const owed = ledger.prefAccrued;
  const paid = Math.min(available, owed);
  const stillOwed = owed - paid;
  const growing = terms.compounding === 'simple' ? 'is still owed (under simple interest it earns nothing more).' : 'is still owed and keeps compounding.';
  return {
    tier: 'PREF',
    available,
    owed,
    lp: paid,
    gp: 0,
    remaining: available - paid,
    ledger: bump({ ...ledger, prefAccrued: stillOwed }, { pref: paid }),
    explanation:
      available <= 0
        ? `No cash reached this tier. The LP is still owed ${fmt(owed)} of preferred return.`
        : `The LP has earned ${fmt(owed)} of preferred return (the ${pctOf(terms.hurdleRate)} hurdle) and gets ${fmt(paid)}.` +
          (stillOwed > 1e-9 ? ` ${fmt(stillOwed)} ${growing}` : ' The hurdle is now fully met.'),
  };
}

/**
 * Tier 3: GP catch-up.
 *
 * After the pref, the GP has received nothing but is entitled to `carryRate` (c) of ALL profit,
 * including the pref the LP just got. In this tier the GP takes `catchUpRate` (k) of each dollar,
 * and the LP takes 1 − k, until the GP has caught up:
 *
 *     G + k·x = c·(Π + x)   →   x* = (c·Π − G) / (k − c)
 *
 * Π = profit paid so far, G = carry paid so far, x = size of this tier.
 * k must be above c, or the GP never catches up: that's enforced in validate.ts.
 * x* can be negative when the GP is already at or above c. Then the tier pays nothing.
 */
export function catchUp(available: number, ledger: PartnerLedger, terms: CarryTerms): TierOutcome {
  const k = terms.catchUpRate;
  const c = terms.carryRate;
  if (k === 0) {
    return {
      tier: 'CATCHUP', available, owed: 0, lp: 0, gp: 0, remaining: available, ledger,
      explanation: 'These terms have no catch-up, so everything left goes straight to the profit split.',
    };
  }

  const profit = profitPaid(ledger.cumulative);
  const carry = carryPaid(ledger.cumulative);
  const target = Math.max(0, (c * profit - carry) / (k - c));
  const size = Math.min(available, target);
  const gp = size * k;
  const lp = size - gp;
  const gpShareNow = profit > 0 ? carry / profit : 0;

  let explanation: string;
  if (available <= 0) explanation = 'No cash reached this tier.';
  else if (target <= 1e-12) explanation = `The GP already has ${pctOf(c)} of the profit, so no catch-up is needed.`;
  else {
    explanation =
      `So far the GP has ${pctOf(gpShareNow)} of the ${fmt(profit)} profit paid out, but it is entitled to ${pctOf(c)}. ` +
      `The GP takes ${pctOf(k)} of each dollar here${k < 1 ? ` (the LP gets ${pctOf(1 - k)})` : ''}. ` +
      `It needs ${fmt(target)} to catch up and gets ${fmt(size)}.` +
      (size < target - 1e-9 ? ' The cash ran out first, so the fund ends in the catch-up zone.' : ` Now the GP has exactly ${pctOf(c)}.`);
  }

  return {
    tier: 'CATCHUP',
    available,
    owed: target,
    lp,
    gp,
    remaining: available - size,
    ledger: bump(ledger, { catchUpLp: lp, catchUpGp: gp }),
    explanation,
  };
}

/** Tier 4: everything left is profit above the hurdle, split between LP and GP. */
export function carrySplit(available: number, ledger: PartnerLedger, terms: CarryTerms): TierOutcome {
  const gp = available * terms.carryRate;
  const lp = available - gp; // subtract instead of multiplying by (1 − carry), so lp + gp is exactly `available`
  return {
    tier: 'SPLIT',
    available,
    owed: null,
    lp,
    gp,
    remaining: 0,
    ledger: bump(ledger, { splitLp: lp, splitGp: gp }),
    explanation:
      available <= 0
        ? 'Nothing is left for the profit split.'
        : `The remaining ${fmt(available)} is split: the GP takes ${pctOf(terms.carryRate)} as carry (${fmt(gp)}) ` +
          `and the LP keeps ${fmt(lp)}.`,
  };
}
