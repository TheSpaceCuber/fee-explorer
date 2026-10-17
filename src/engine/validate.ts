import { dayNumber, isValidDate } from './daycount';
import { COMPOUNDINGS, type FundInput } from './types';

/**
 * Term and input validation.
 *
 * In a real system this is the "validation and approval" stage: terms are checked before any
 * calculation is allowed to use them. Here it runs at the start of every run, and returns every
 * problem it finds rather than stopping at the first.
 */

export interface ValidationIssue {
  /** Dotted path to the bad field, e.g. "terms.carryRate" or "events[2].date". */
  field: string;
  message: string;
}

export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join('; '));
    this.name = 'ValidationError';
  }
}

const isNonNegative = (x: number) => Number.isFinite(x) && x >= 0;

export function validate(input: FundInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const { terms, partners, events, nav } = input;

  // --- Terms ---
  if (terms.structure !== 'european' && terms.structure !== 'american') add('terms.structure', 'Must be european or american.');
  if (terms.lossRecovery !== undefined && terms.lossRecovery !== 'none' && terms.lossRecovery !== 'realized') {
    add('terms.lossRecovery', 'Must be none or realized.');
  }
  const american = terms.structure === 'american';
  if (!COMPOUNDINGS.includes(terms.compounding)) add('terms.compounding', `Must be one of: ${COMPOUNDINGS.join(', ')}.`);
  if (!isNonNegative(terms.hurdleRate)) add('terms.hurdleRate', 'Must be a number ≥ 0.');
  if (!(Number.isFinite(terms.carryRate) && terms.carryRate >= 0 && terms.carryRate < 1)) {
    add('terms.carryRate', 'Must be in [0, 1).');
  }
  // Catch-up: in that tier the GP takes k of each dollar while trying to reach c of ALL profit,
  // starting from 0%. If k ≤ c it can never get there, so the tier would never end.
  const k = terms.catchUpRate;
  if (!(Number.isFinite(k) && (k === 0 || (k > terms.carryRate && k <= 1)))) {
    add('terms.catchUpRate', `Must be 0 (no catch-up) or above the carry rate (${terms.carryRate}) and at most 1.`);
  }

  // --- Partners ---
  if (partners.length === 0) add('partners', 'At least one partner is required.');
  const ids = new Set<string>();
  partners.forEach((p, i) => {
    if (ids.has(p.id)) add(`partners[${i}].id`, `Duplicate partner id "${p.id}".`);
    ids.add(p.id);
    if (p.role !== 'LP' && p.role !== 'GP') add(`partners[${i}].role`, 'Must be LP or GP.');
    if (p.feeClassId !== undefined) {
      if (p.role === 'GP') add(`partners[${i}].feeClassId`, "The GP's own commitment pays no management fee.");
      else if (!input.fees) add(`partners[${i}].feeClassId`, 'Has a fee class but the fund has no fee terms.');
      else if (!(p.feeClassId in input.fees.classes)) add(`partners[${i}].feeClassId`, `Unknown fee class "${p.feeClassId}".`);
    }
    if (!(Number.isFinite(p.commitment) && p.commitment > 0)) add(`partners[${i}].commitment`, 'Must be > 0.');
  });

  // --- Events ---
  // We require date order instead of sorting quietly. Same-day order matters (a call and a
  // distribution on one day), so the caller has to decide it explicitly.
  const eventIds = new Set<string>();
  let lastDay = -Infinity;
  // Invested capital (investment called − cost sold) can't go negative: you can't sell more cost
  // than you bought. It's the fee basis after the investment period.
  let invested = 0;
  // American: the same check per deal, and every flow must say which deal it belongs to.
  const dealInvested = new Map<string, number>();
  // A distribution before any capital has been called would meet an empty hurdle account and
  // fall straight into the split, so the GP would earn carry on money no LP put in.
  let seenCall = false;
  events.forEach((e, i) => {
    const at = `events[${i}]`;
    if (eventIds.has(e.id)) add(`${at}.id`, `Duplicate event id "${e.id}".`);
    eventIds.add(e.id);
    if (!isValidDate(e.date)) {
      add(`${at}.date`, `Invalid date "${e.date}".`);
      return;
    }
    const day = dayNumber(e.date);
    if (day < lastDay) add(`${at}.date`, 'Events must be in date order.');
    lastDay = Math.max(lastDay, day);
    if (e.kind === 'capital_call') {
      seenCall = true;
      invested += e.investment;
      if (american) {
        // A call that names a deal registers it, even for 0. Investment with no deal is an error.
        if (e.dealId) dealInvested.set(e.dealId, (dealInvested.get(e.dealId) ?? 0) + e.investment);
        else if (e.investment > 0) add(`${at}.dealId`, 'American waterfalls need a deal on every investment call.');
      }
      if (!isNonNegative(e.investment)) add(`${at}.investment`, 'Must be ≥ 0.');
      if (!isNonNegative(e.fee)) add(`${at}.fee`, 'Must be ≥ 0.');
    } else {
      if (!isNonNegative(e.amount)) add(`${at}.amount`, 'Must be ≥ 0.');
      if (!seenCall) add(`${at}.date`, 'A distribution cannot come before the first capital call.');
      if (e.costRealized !== undefined) {
        if (!isNonNegative(e.costRealized)) add(`${at}.costRealized`, 'Must be ≥ 0.');
        invested -= e.costRealized;
        if (invested < -1e-9) add(`${at}.costRealized`, 'Total cost sold exceeds total investment called.');
      }
      if (american) {
        if (!e.dealId) add(`${at}.dealId`, 'American waterfalls need a deal on every distribution.');
        else if (!dealInvested.has(e.dealId)) add(`${at}.dealId`, `Deal "${e.dealId}" has no capital call before this date.`);
        else {
          const left = dealInvested.get(e.dealId)! - (e.costRealized ?? 0);
          if (left < -1e-9) add(`${at}.costRealized`, `More cost sold than was invested in deal "${e.dealId}".`);
          dealInvested.set(e.dealId, left);
        }
      }
    }
  });

  // --- NAV ---
  if (nav) {
    if (!isValidDate(nav.date)) add('nav.date', `Invalid date "${nav.date}".`);
    else if (dayNumber(nav.date) < lastDay) add('nav.date', 'NAV date must be on or after the last event.');
    if (!isNonNegative(nav.amount)) add('nav.amount', 'Must be ≥ 0.');
  }

  // --- Management fees ---
  if (input.fees) {
    const { fees } = input;
    if (!isValidDate(fees.start)) add('fees.start', `Invalid date "${fees.start}".`);
    for (const [name, cls] of Object.entries(fees.classes)) {
      const at = `fees.classes.${name}`;
      // Report problems by the index the caller wrote, so the message points at the right period.
      cls.periods.forEach((p, i) => {
        if (!isValidDate(p.from) || !isValidDate(p.to)) return add(`${at}.periods[${i}]`, 'Invalid date.');
        if (dayNumber(p.from) >= dayNumber(p.to)) add(`${at}.periods[${i}]`, '"from" must be before "to".');
        if (!(Number.isFinite(p.rate) && p.rate >= 0 && p.rate <= 0.1)) add(`${at}.periods[${i}].rate`, 'Must be between 0 and 10%.');
        if (p.basis !== 'commitment' && p.basis !== 'invested_capital') add(`${at}.periods[${i}].basis`, 'Must be commitment or invested_capital.');
      });
      // Overlaps: compare neighbours in date order.
      const ordered = cls.periods
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => isValidDate(p.from) && isValidDate(p.to))
        .sort((a, b) => dayNumber(a.p.from) - dayNumber(b.p.from));
      for (let k = 1; k < ordered.length; k++) {
        if (dayNumber(ordered[k]!.p.from) < dayNumber(ordered[k - 1]!.p.to)) {
          add(`${at}.periods[${ordered[k]!.i}]`, `Overlaps periods[${ordered[k - 1]!.i}].`);
        }
      }
      for (const [j, b] of (cls.sizeDiscount?.bands ?? []).entries()) {
        if (!isNonNegative(b.minCommitment) || !isNonNegative(b.rateReduction)) add(`${at}.sizeDiscount.bands[${j}]`, 'Must be ≥ 0.');
      }
    }
  }

  return issues;
}

export function assertValid(input: FundInput): void {
  const issues = validate(input);
  if (issues.length > 0) throw new ValidationError(issues);
}
